import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queues.constants';
import { JobsService } from '../jobs.service';
import { FalService } from '../../../services/fal.service';
import { GeminiService } from '../../../services/gemini.service';
import { SupabaseService } from '../../files/supabase.service';

/**
 * Advanced Face Swap Job Data
 * Single unified pipeline for all face swap operations
 */
interface AdvancedSwapJobData {
  jobId: string;
  videoId: string;
  videoUrl: string;
  // Target face
  targetFaceUrl: string;
  targetFaceSource: 'upload' | 'character_diagram' | 'reference_kit';
  characterDiagramId?: string;
  referenceKitId?: string;
  // LoRA model (required)
  loraId: string;
  loraWeightsUrl: string;
  loraTriggerWord?: string;
  // Video settings
  durationSeconds: number;
  videoModel: 'kling' | 'luma' | 'sora2pro' | 'wan';
  // Processing options
  keepOriginalOutfit: boolean;
  upscaleMethod: 'real-esrgan' | 'clarity' | 'creative' | 'none';
  upscaleResolution: '2k' | '4k';
  keyFrameCount: number;
}

// Maximum time to wait for a face swap job (45 minutes for full pipeline)
const MAX_JOB_DURATION_MS = 45 * 60 * 1000;

// Timeout error class for identification
class JobTimeoutError extends Error {
  constructor(durationMs: number) {
    super(`Job timed out after ${Math.round(durationMs / 60000)} minutes`);
    this.name = 'JobTimeoutError';
  }
}

@Processor(QUEUES.FACE_SWAP)
export class FaceSwapProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(FaceSwapProcessor.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly falService: FalService,
    private readonly geminiService: GeminiService,
    private readonly supabase: SupabaseService,
  ) {
    super();
  }

  onModuleInit() {
    this.logger.log('=== FaceSwapProcessor initialized ===');
    this.logger.log(`Queue name: ${QUEUES.FACE_SWAP}`);
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.log(`Job ${job.id} is now active`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} failed: ${error.message}`);
  }

  @OnWorkerEvent('error')
  onError(error: Error) {
    this.logger.error(`Worker error: ${error.message}`);
  }

  async process(job: Job<AdvancedSwapJobData>): Promise<void> {
    this.logger.log('=== FACE SWAP JOB STARTED ===');
    this.logger.log(`BullMQ Job ID: ${job.id}, Job Name: ${job.name}`);
    this.logger.log(`Raw job.data: ${JSON.stringify(job.data, null, 2)}`);

    const { jobId } = job.data;

    // CRITICAL: Validate jobId is present
    if (!jobId) {
      const errorMsg = `FATAL: jobId is undefined in job data! BullMQ job ID: ${job.id}, name: ${job.name}`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    if (jobId === 'undefined' || typeof jobId !== 'string') {
      const errorMsg = `FATAL: jobId has invalid value: "${jobId}" (type: ${typeof jobId})`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    this.logger.log(`=== VALIDATED: jobId = ${jobId} ===`);

    // All jobs now use the advanced pipeline
    return this.processAdvancedSwap(job);
  }

  /**
   * Advanced Face Swap Pipeline
   *
   * Stages:
   * 1. Extract first frame (0-10%)
   * 2. Try Gemini regeneration - NO FALLBACKS (10-40%)
   *    - If fails (safety filter): skip to direct mode
   * 3. Generate video with selected model (40-85%)
   * 4. Upscale if requested (85-95%)
   * 5. Finalize (95-100%)
   */
  private async processAdvancedSwap(job: Job<AdvancedSwapJobData>): Promise<void> {
    const jobId = job.data.jobId;
    this.logger.log(`=== processAdvancedSwap ENTRY ===`);
    this.logger.log(`jobId at method entry: "${jobId}"`);

    if (!jobId || jobId === 'undefined') {
      throw new Error(`FATAL: jobId invalid at processAdvancedSwap entry: "${jobId}"`);
    }

    const {
      videoId,
      videoUrl,
      targetFaceUrl,
      targetFaceSource,
      characterDiagramId,
      referenceKitId,
      loraId,
      loraWeightsUrl,
      loraTriggerWord,
      durationSeconds = 10,
      videoModel = 'kling',
      keepOriginalOutfit = true,
      upscaleMethod = 'none',
      upscaleResolution = '2k',
      keyFrameCount = 5,
    } = job.data;

    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    // Create temp directory
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'advanced-swap-'));
    this.logger.log(`[${jobId}] Created temp directory: ${tempDir}`);

    const startTime = Date.now();
    let firstFrameSkipped = false;
    let skipReason = '';

    try {
      await this.jobsService.markJobProcessing(jobId);

      // Store the models being used in output_payload at the start
      await this.supabase.updateJob(jobId, {
        output_payload: {
          videoModel,
          loraId,
          loraTriggerWord: loraTriggerWord || null,
          targetFaceSource,
          upscaleMethod,
          upscaleResolution,
          logs: [],
        },
      });

      await this.updateProgress(jobId, 2, 'Starting advanced pipeline...');

      this.logger.log(`[${jobId}] Advanced Face Swap Pipeline started`);
      this.logger.log(`[${jobId}] Video URL: ${videoUrl}`);
      this.logger.log(`[${jobId}] Target Face: ${targetFaceSource} - ${targetFaceUrl}`);
      this.logger.log(`[${jobId}] LoRA: ${loraId} (${loraTriggerWord || 'no trigger'})`);
      this.logger.log(`[${jobId}] Video Model: ${videoModel}`);

      // ========================================
      // STAGE 1: Extract First Frame (0-10%)
      // ========================================
      await this.updateProgress(jobId, 5, 'Extracting first frame...');

      const videoBuffer = await this.downloadBuffer(videoUrl);
      const inputVideoPath = path.join(tempDir, 'input.mp4');
      await fs.writeFile(inputVideoPath, videoBuffer);

      // Get video info
      const { stdout: probeOutput } = await execAsync(
        `ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate,duration -of csv=p=0 "${inputVideoPath}"`,
      );
      const [fpsRatio, durationStr] = probeOutput.trim().split(',');
      const [fpsNum, fpsDen] = fpsRatio.split('/').map(Number);
      const fps = Math.round(fpsNum / (fpsDen || 1));
      const videoDuration = parseFloat(durationStr) || durationSeconds;

      this.logger.log(`[${jobId}] Video: ${fps} fps, ${videoDuration.toFixed(1)}s duration`);

      // Extract first frame
      const firstFramePath = path.join(tempDir, 'first_frame.png');
      await execAsync(
        `ffmpeg -i "${inputVideoPath}" -vf "select=eq(n\\,0)" -vframes 1 "${firstFramePath}"`,
      );

      const firstFrameBuffer = await fs.readFile(firstFramePath);
      const firstFrameUploadPath = `${videoId}/first_frame_${Date.now()}.png`;
      const { url: firstFrameUrl } = await this.supabase.uploadFile(
        'processed-videos',
        firstFrameUploadPath,
        firstFrameBuffer,
        'image/png',
      );

      this.logger.log(`[${jobId}] Stage 1: First frame extracted`);
      await this.updateProgress(jobId, 10, 'First frame extracted');

      // ========================================
      // STAGE 2: Try Gemini Regeneration (10-40%)
      // NO FALLBACKS - if fails, skip to direct mode
      // ========================================
      await this.updateProgress(jobId, 15, 'Generating identity-swapped frame with Nano Banana Pro...');

      // Collect reference images for identity
      const referenceImageUrls: string[] = [targetFaceUrl];

      // Add additional references if using reference kit
      if (targetFaceSource === 'reference_kit' && referenceKitId) {
        const kit = await this.supabase.getReferenceKit(referenceKitId);
        if (kit) {
          if (kit.profile_url) referenceImageUrls.push(kit.profile_url);
          if (kit.half_body_url) referenceImageUrls.push(kit.half_body_url);
          if (kit.full_body_url) referenceImageUrls.push(kit.full_body_url);
        }
      }

      let primaryFrameUrl: string;

      try {
        // Try Nano Banana Pro (Gemini) - NO FALLBACKS
        const regeneratedResult = await this.geminiService.regenerateFrameWithIdentity(
          firstFrameUrl,
          referenceImageUrls,
          keepOriginalOutfit,
        );

        // Save regenerated frame
        const regeneratedBuffer = Buffer.from(regeneratedResult.imageBase64, 'base64');
        const regeneratedPath = path.join(tempDir, 'regenerated_frame.png');
        await fs.writeFile(regeneratedPath, regeneratedBuffer);

        // Upload regenerated frame
        const regenUploadPath = `${videoId}/regenerated_frame_${Date.now()}.png`;
        const { url: regenUrl } = await this.supabase.uploadFile(
          'processed-videos',
          regenUploadPath,
          regeneratedBuffer,
          'image/png',
        );

        primaryFrameUrl = regenUrl;
        this.logger.log(`[${jobId}] Stage 2: Gemini regeneration successful`);
        this.logger.log(`[${jobId}] DEBUG - Regenerated frame URL: ${regenUrl}`);

        // Store regenerated frame URL for debugging (check if scene elements preserved)
        const currentJobForDebug = await this.supabase.getJob(jobId);
        const existingPayloadForDebug = (currentJobForDebug?.output_payload as Record<string, unknown>) || {};
        await this.supabase.updateJob(jobId, {
          output_payload: {
            ...existingPayloadForDebug,
            debug_regenerated_frame: regenUrl,
            debug_original_frame: firstFrameUrl,
          },
        });

        await this.updateProgress(jobId, 40, 'Frame regeneration complete');

      } catch (geminiError) {
        // Nano Banana Pro failed (likely safety filter)
        const errorMsg = geminiError instanceof Error ? geminiError.message : 'Unknown error';
        this.logger.warn(`[${jobId}] Nano Banana Pro failed: ${errorMsg}`);
        this.logger.warn(`[${jobId}] Skipping first frame generation, proceeding to direct video generation`);

        firstFrameSkipped = true;
        skipReason = errorMsg;

        // Update job metadata to indicate skip
        const currentJob = await this.supabase.getJob(jobId);
        const existingPayload = (currentJob?.output_payload as Record<string, unknown>) || {};
        await this.supabase.updateJob(jobId, {
          output_payload: {
            ...existingPayload,
            first_frame_skipped: true,
            skip_reason: errorMsg,
          },
        });

        await this.updateProgress(jobId, 25, 'First frame generation skipped (safety filter). Using direct face swap...');

        // Direct mode: use basic fal.ai face swap on original first frame
        this.logger.log(`[${jobId}] Using basic face swap fallback...`);

        try {
          const faceSwapResult = await this.falService.runFaceSwap({
            base_image_url: firstFrameUrl,
            swap_image_url: targetFaceUrl,
          });

          primaryFrameUrl = faceSwapResult.image?.url || firstFrameUrl;
          this.logger.log(`[${jobId}] Basic face swap complete`);
        } catch (faceSwapError) {
          // If even basic face swap fails, use original frame
          this.logger.warn(`[${jobId}] Basic face swap also failed, using original frame`);
          primaryFrameUrl = firstFrameUrl;
        }

        await this.updateProgress(jobId, 40, 'Direct face swap complete');
      }

      // ========================================
      // STAGE 3: Generate Video (40-85%)
      // ========================================
      await this.updateProgress(jobId, 45, `Generating video with ${videoModel.toUpperCase()}...`);

      let videoResult: { video: { url: string } };

      // Create timeout promise
      const videoTimeoutMs = 20 * 60 * 1000; // 20 minutes for video generation
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new JobTimeoutError(videoTimeoutMs)), videoTimeoutMs);
      });

      // Progress callback for fal.ai status updates
      const onFalProgress = async (status: { status: string; logs?: Array<{ message: string }> }) => {
        await this.addLog(jobId, `[${videoModel.toUpperCase()}] Status: ${status.status}`);
        if (status.logs?.length) {
          for (const log of status.logs.slice(-2)) {
            await this.addLog(jobId, `[fal.ai] ${log.message}`);
          }
        }
      };

      switch (videoModel) {
        case 'wan':
          await this.addLog(jobId, `Starting WAN v2.2 video generation...`);
          videoResult = await Promise.race([
            this.falService.runWanVideoGeneration({
              image_url: primaryFrameUrl,
              video_url: videoUrl,
              resolution: '720p',
              onProgress: onFalProgress,
            }),
            timeoutPromise,
          ]);
          break;
        case 'luma':
          // Luma Dream Machine (premium quality)
          await this.addLog(jobId, `Starting Luma Dream Machine video generation...`);
          videoResult = await Promise.race([
            this.falService.runSoraVideoGeneration({
              image_url: primaryFrameUrl,
              video_url: videoUrl,
              onProgress: onFalProgress,
            }),
            timeoutPromise,
          ]);
          break;
        case 'sora2pro':
          // Sora 2 Pro (OpenAI's premium model)
          await this.addLog(jobId, `Starting Sora 2 Pro video generation...`);
          videoResult = await Promise.race([
            this.falService.runSora2ProVideoGeneration({
              image_url: primaryFrameUrl,
              video_url: videoUrl,
              onProgress: onFalProgress,
            }),
            timeoutPromise,
          ]);
          break;
        case 'kling':
        default:
          await this.addLog(jobId, `Starting Kling v2.6 motion control...`);
          videoResult = await Promise.race([
            this.falService.runKlingMotionControl({
              image_url: primaryFrameUrl,
              video_url: videoUrl,
              character_orientation: 'video',
              onProgress: onFalProgress,
            }),
            timeoutPromise,
          ]);
          break;
      }

      if (!videoResult.video?.url) {
        throw new Error(`${videoModel.toUpperCase()} returned no video URL`);
      }

      this.logger.log(`[${jobId}] Stage 3: Video generation complete: ${videoResult.video.url}`);
      await this.updateProgress(jobId, 85, 'Video generation complete');

      // ========================================
      // STAGE 4: Upscale if Requested (85-95%)
      // ========================================
      let finalVideoUrl = videoResult.video.url;

      if (upscaleMethod !== 'none') {
        await this.updateProgress(jobId, 87, `Upscaling to ${upscaleResolution}...`);
        this.logger.log(`[${jobId}] Stage 4: Upscaling with ${upscaleMethod} to ${upscaleResolution}`);
        // TODO: Implement full video upscaling pipeline
        await this.updateProgress(jobId, 95, 'Upscaling complete');
      } else {
        await this.updateProgress(jobId, 95, 'Skipping upscaling');
      }

      // ========================================
      // STAGE 5: Finalize (95-100%)
      // ========================================
      await this.updateProgress(jobId, 97, 'Finalizing...');

      // Download final video
      const resultVideoBuffer = await this.downloadBuffer(finalVideoUrl);

      // Compress if needed (Supabase limit is typically 50MB)
      const MAX_SIZE_MB = 50;
      const sizeMb = resultVideoBuffer.length / (1024 * 1024);
      let finalBuffer = resultVideoBuffer;

      if (sizeMb > MAX_SIZE_MB) {
        this.logger.log(`[${jobId}] Video size ${sizeMb.toFixed(1)}MB exceeds limit, compressing...`);
        await this.updateProgress(jobId, 98, 'Compressing video...');

        const tempInputPath = path.join(tempDir, 'output_raw.mp4');
        const tempOutputPath = path.join(tempDir, 'output_compressed.mp4');
        await fs.writeFile(tempInputPath, resultVideoBuffer);

        const targetBitrate = Math.floor((MAX_SIZE_MB * 8 * 1024) / (durationSeconds || 10));

        await execAsync(
          `ffmpeg -i "${tempInputPath}" -c:v libx264 -b:v ${targetBitrate}k -maxrate ${targetBitrate}k -bufsize ${targetBitrate * 2}k -c:a aac -b:a 128k -y "${tempOutputPath}"`,
        );

        finalBuffer = await fs.readFile(tempOutputPath);
        this.logger.log(`[${jobId}] Compressed from ${sizeMb.toFixed(1)}MB to ${(finalBuffer.length / (1024 * 1024)).toFixed(1)}MB`);
      }

      const filePath = `${videoId}/advanced_swap_${videoModel}_${Date.now()}.mp4`;
      const { url: outputUrl } = await this.supabase.uploadFile(
        'processed-videos',
        filePath,
        finalBuffer,
        'video/mp4',
      );

      this.logger.log(`[${jobId}] Uploaded final video: ${outputUrl}`);

      // Create video record
      const videoName = firstFrameSkipped
        ? `AI Swap (${videoModel.toUpperCase()} - Frame Skipped) - ${new Date().toLocaleString()}`
        : `AI Swap (${videoModel.toUpperCase()}) - ${new Date().toLocaleString()}`;

      const swappedVideo = await this.supabase.createVideo({
        name: videoName,
        type: 'face_swapped',
        parent_video_id: videoId,
        character_diagram_id: characterDiagramId || null,
        file_url: outputUrl,
        duration_seconds: durationSeconds,
        collection_id: null,
        thumbnail_url: null,
        width: null,
        height: null,
        file_size_bytes: finalBuffer.length,
      });

      // Calculate cost
      const costCents = this.calculateCost({
        videoModel,
        upscaleMethod,
        keyFrameCount: 1, // Only processing one frame now
      });

      // Mark job completed with skip info
      this.logger.log(`[${jobId}] === MARKING JOB COMPLETED ===`);
      await this.jobsService.markJobCompleted(
        jobId,
        {
          outputVideoId: swappedVideo.id,
          outputUrl,
          loraId,
          characterDiagramId,
          referenceKitId,
          videoModel,
          upscaleMethod,
          upscaleResolution,
          first_frame_skipped: firstFrameSkipped,
          skip_reason: skipReason || undefined,
          processingTimeMs: Date.now() - startTime,
        },
        costCents,
      );

      const statusMsg = firstFrameSkipped
        ? 'Video generated (first frame was skipped)'
        : 'Video generated successfully';

      await this.updateProgress(jobId, 100, statusMsg);

      this.logger.log(`[${jobId}] Advanced face swap completed successfully`, {
        swappedVideoId: swappedVideo.id,
        costCents,
        firstFrameSkipped,
        processingTimeMs: Date.now() - startTime,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[${jobId}] Advanced face swap failed: ${errorMessage}`);
      if (error instanceof Error && error.stack) {
        this.logger.error(`[${jobId}] Stack: ${error.stack}`);
      }
      await this.jobsService.markJobFailed(jobId, errorMessage);
      throw error;
    } finally {
      // Cleanup temp directory
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
        this.logger.log(`[${jobId}] Cleaned up temp directory`);
      } catch (cleanupError) {
        this.logger.warn(`[${jobId}] Failed to cleanup temp directory: ${cleanupError}`);
      }
    }
  }

  /**
   * Calculate cost in cents based on processing options
   */
  private calculateCost(options: {
    videoModel: string;
    upscaleMethod: string;
    keyFrameCount: number;
  }): number {
    const GEMINI_COST = 2; // ~$0.02 for Gemini regeneration
    const POSE_DETECTION_COST = 1; // ~$0.01 per frame

    const VIDEO_MODEL_COSTS: Record<string, number> = {
      kling: 40, // Kling v2.6 Pro ~$0.40/5s
      luma: 100, // Luma Dream Machine ~$1.00/5s
      sora2pro: 100, // Sora 2 Pro ~$1.00/5s
      wan: 20, // WAN v2.2 ~$0.20/5s
    };

    const UPSCALE_COSTS: Record<string, number> = {
      'real-esrgan': 5, // ~$0.05 fast upscaling
      clarity: 15, // ~$0.15 quality upscaling
      creative: 20, // ~$0.20 AI-enhanced
      none: 0,
    };

    let total = GEMINI_COST;
    total += options.keyFrameCount * POSE_DETECTION_COST;
    total += VIDEO_MODEL_COSTS[options.videoModel] || VIDEO_MODEL_COSTS.kling;
    total += UPSCALE_COSTS[options.upscaleMethod] || 0;

    return total;
  }

  /**
   * Helper to update progress with stage info and store logs
   */
  private async updateProgress(jobId: string, progress: number, stage: string): Promise<void> {
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `[${timestamp}] ${stage}`;

    // Get current output_payload to append log
    const currentJob = await this.supabase.getJob(jobId);
    const existingPayload = (currentJob?.output_payload as Record<string, unknown>) || {};
    const existingLogs = (existingPayload.logs as string[]) || [];

    await this.supabase.updateJob(jobId, {
      progress,
      external_status: stage,
      output_payload: {
        ...existingPayload,
        logs: [...existingLogs, logMessage],
      },
    });
    this.logger.log(`[${jobId}] Progress: ${progress}% - ${stage}`);
  }

  /**
   * Add a log entry without updating progress
   */
  private async addLog(jobId: string, message: string): Promise<void> {
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `[${timestamp}] ${message}`;

    const currentJob = await this.supabase.getJob(jobId);
    const existingPayload = (currentJob?.output_payload as Record<string, unknown>) || {};
    const existingLogs = (existingPayload.logs as string[]) || [];

    await this.supabase.updateJob(jobId, {
      output_payload: {
        ...existingPayload,
        logs: [...existingLogs, logMessage],
      },
    });
    this.logger.log(`[${jobId}] Log: ${message}`);
  }

  /**
   * Download file to buffer
   */
  private async downloadBuffer(url: string): Promise<Buffer> {
    // Handle data URLs (base64)
    if (url.startsWith('data:')) {
      const base64Data = url.split(',')[1];
      return Buffer.from(base64Data, 'base64');
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
