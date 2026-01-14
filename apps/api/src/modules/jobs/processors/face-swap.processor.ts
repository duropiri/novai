import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queues.constants';
import { JobsService } from '../jobs.service';
import { FalService } from '../../../services/fal.service';
import { GeminiService } from '../../../services/gemini.service';
import { KlingService } from '../../../services/kling.service';
import { LocalAIService } from '../../../services/local-ai.service';
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
  videoModel: 'kling' | 'kling-2.5' | 'kling-2.6' | 'luma' | 'sora2pro' | 'wan';
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
    private readonly klingService: KlingService,
    private readonly localAIService: LocalAIService,
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
    let engineUsed: 'gemini' | 'local' | 'fal.ai' | 'none' = 'none';

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

      // Initialize with first frame as fallback (will be replaced if processing succeeds)
      let primaryFrameUrl: string = firstFrameUrl;

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
        engineUsed = 'gemini';
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

        // ========================================
        // FALLBACK 1: Try Local AI (Automatic1111)
        // ========================================
        if (this.localAIService.isEnabled()) {
          await this.updateProgress(jobId, 25, 'Gemini blocked. Trying local AI fallback...');
          this.logger.log(`[${jobId}] Attempting local AI fallback (Automatic1111)...`);

          const localAvailable = await this.localAIService.isAvailable();
          if (localAvailable) {
            try {
              // Use local face swap with ReActor
              const localSwapUrl = await this.localAIService.faceSwap({
                baseImageUrl: firstFrameUrl,
                faceImageUrl: targetFaceUrl,
                faceRestorerVisibility: 1,
              });

              primaryFrameUrl = localSwapUrl;
              engineUsed = 'local';
              this.logger.log(`[${jobId}] Local AI face swap successful`);
              await this.updateProgress(jobId, 40, 'Local AI face swap complete');

              // Update payload with engine info
              const jobAfterLocal = await this.supabase.getJob(jobId);
              const payloadAfterLocal = (jobAfterLocal?.output_payload as Record<string, unknown>) || {};
              await this.supabase.updateJob(jobId, {
                output_payload: {
                  ...payloadAfterLocal,
                  engineUsed: 'local',
                  localAIUsed: true,
                },
              });
            } catch (localError) {
              const localErrorMsg = localError instanceof Error ? localError.message : 'Unknown error';
              this.logger.warn(`[${jobId}] Local AI fallback failed: ${localErrorMsg}`);
              // Continue to fal.ai fallback
            }
          } else {
            this.logger.warn(`[${jobId}] Local AI enabled but not available`);
          }
        }

        // ========================================
        // FALLBACK 2: fal.ai Face Swap
        // ========================================
        if (engineUsed === 'none') {
          await this.updateProgress(jobId, 25, 'Using fal.ai face swap fallback...');
          this.logger.log(`[${jobId}] Using fal.ai face swap fallback...`);

          try {
            const faceSwapResult = await this.falService.runFaceSwap({
              base_image_url: firstFrameUrl,
              swap_image_url: targetFaceUrl,
            });

            primaryFrameUrl = faceSwapResult.image?.url || firstFrameUrl;
            engineUsed = 'fal.ai';
            this.logger.log(`[${jobId}] fal.ai face swap complete`);
          } catch (faceSwapError) {
            // If even basic face swap fails, use original frame
            this.logger.warn(`[${jobId}] fal.ai face swap also failed, using original frame`);
            primaryFrameUrl = firstFrameUrl;
            engineUsed = 'none';
          }

          await this.updateProgress(jobId, 40, 'Face swap fallback complete');
        }
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

      // Track the actual model being called (may differ from selection if using placeholder)
      let actualModelUsed = videoModel;

      // Progress callback for fal.ai status updates
      const onFalProgress = async (status: { status: string; logs?: Array<{ message: string }> }) => {
        await this.addLog(jobId, `[${actualModelUsed.toUpperCase()}] Status: ${status.status}`);
        if (status.logs?.length) {
          for (const log of status.logs.slice(-2)) {
            await this.addLog(jobId, `[fal.ai] ${log.message}`);
          }
        }
      };

      switch (videoModel) {
        case 'wan':
          actualModelUsed = 'wan';
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
          actualModelUsed = 'luma';
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
          // Sora 2 Pro uses OpenAI's Sora API
          actualModelUsed = 'sora2pro';
          await this.addLog(jobId, `Starting OpenAI Sora video generation...`);
          videoResult = await Promise.race([
            this.falService.runSora2ProVideoGeneration({
              image_url: primaryFrameUrl,
              video_url: videoUrl,
              onProgress: onFalProgress,
            }),
            timeoutPromise,
          ]);
          break;
        case 'kling-2.5':
          // Kling 2.5 - Higher quality, cinematic
          // Try direct API first, fall back to fal.ai on failure
          if (this.klingService.isEnabled()) {
            try {
              actualModelUsed = 'kling-2.5';
              await this.addLog(jobId, `Starting Direct Kling v2.5 (50% cheaper than fal.ai)...`);
              videoResult = await Promise.race([
                this.klingService.generateVideoWithMotion({
                  imageUrl: primaryFrameUrl,
                  motionVideoUrl: videoUrl,
                  model: 'kling-v2-5',
                  duration: durationSeconds >= 10 ? '10' : '5',
                  onProgress: async (status) => {
                    await this.addLog(jobId, `[KLING-2.5] ${status.status} (${status.progress || 0}%)`);
                  },
                }),
                timeoutPromise,
              ]);
            } catch (directKlingError) {
              const errMsg = directKlingError instanceof Error ? directKlingError.message : String(directKlingError);
              this.logger.warn(`[${jobId}] Direct Kling failed: ${errMsg}, falling back to fal.ai`);
              await this.addLog(jobId, `Direct Kling failed (${errMsg}), using fal.ai fallback...`);
              actualModelUsed = 'kling';
              videoResult = await Promise.race([
                this.falService.runKlingMotionControl({
                  image_url: primaryFrameUrl,
                  video_url: videoUrl,
                  character_orientation: 'video',
                  onProgress: onFalProgress,
                }),
                timeoutPromise,
              ]);
            }
          } else {
            // Direct API not configured, use fal.ai
            actualModelUsed = 'kling';
            await this.addLog(jobId, `Starting Kling via fal.ai (direct API not configured)...`);
            videoResult = await Promise.race([
              this.falService.runKlingMotionControl({
                image_url: primaryFrameUrl,
                video_url: videoUrl,
                character_orientation: 'video',
                onProgress: onFalProgress,
              }),
              timeoutPromise,
            ]);
          }
          break;
        case 'kling-2.6':
          // Kling 2.6 - Includes audio generation!
          // Try direct API first, fall back to fal.ai on failure
          if (this.klingService.isEnabled()) {
            try {
              actualModelUsed = 'kling-2.6';
              await this.addLog(jobId, `Starting Direct Kling v2.6 with audio generation...`);
              videoResult = await Promise.race([
                this.klingService.generateVideoWithMotion({
                  imageUrl: primaryFrameUrl,
                  motionVideoUrl: videoUrl,
                  model: 'kling-v2-6',
                  duration: durationSeconds >= 10 ? '10' : '5',
                  onProgress: async (status) => {
                    await this.addLog(jobId, `[KLING-2.6] ${status.status} (${status.progress || 0}%)`);
                  },
                }),
                timeoutPromise,
              ]);
            } catch (directKlingError) {
              const errMsg = directKlingError instanceof Error ? directKlingError.message : String(directKlingError);
              this.logger.warn(`[${jobId}] Direct Kling failed: ${errMsg}, falling back to fal.ai`);
              await this.addLog(jobId, `Direct Kling failed (${errMsg}), using fal.ai fallback...`);
              actualModelUsed = 'kling';
              videoResult = await Promise.race([
                this.falService.runKlingMotionControl({
                  image_url: primaryFrameUrl,
                  video_url: videoUrl,
                  character_orientation: 'video',
                  onProgress: onFalProgress,
                }),
                timeoutPromise,
              ]);
            }
          } else {
            // Direct API not configured, use fal.ai
            actualModelUsed = 'kling';
            await this.addLog(jobId, `Starting Kling via fal.ai (direct API not configured)...`);
            videoResult = await Promise.race([
              this.falService.runKlingMotionControl({
                image_url: primaryFrameUrl,
                video_url: videoUrl,
                character_orientation: 'video',
                onProgress: onFalProgress,
              }),
              timeoutPromise,
            ]);
          }
          break;
        case 'kling':
        default:
          // Kling 1.6 - Best balance of quality and cost
          // Try direct API first, fall back to fal.ai on failure
          if (this.klingService.isEnabled()) {
            try {
              actualModelUsed = 'kling';
              await this.addLog(jobId, `Starting Direct Kling v1.6 (50% cheaper than fal.ai)...`);
              videoResult = await Promise.race([
                this.klingService.generateVideoWithMotion({
                  imageUrl: primaryFrameUrl,
                  motionVideoUrl: videoUrl,
                  model: 'kling-v1-6',
                  duration: durationSeconds >= 10 ? '10' : '5',
                  onProgress: async (status) => {
                    await this.addLog(jobId, `[KLING] ${status.status} (${status.progress || 0}%)`);
                  },
                }),
                timeoutPromise,
              ]);
            } catch (directKlingError) {
              const errMsg = directKlingError instanceof Error ? directKlingError.message : String(directKlingError);
              this.logger.warn(`[${jobId}] Direct Kling failed: ${errMsg}, falling back to fal.ai`);
              await this.addLog(jobId, `Direct Kling failed (${errMsg}), using fal.ai fallback...`);
              actualModelUsed = 'kling';
              videoResult = await Promise.race([
                this.falService.runKlingMotionControl({
                  image_url: primaryFrameUrl,
                  video_url: videoUrl,
                  character_orientation: 'video',
                  onProgress: onFalProgress,
                }),
                timeoutPromise,
              ]);
            }
          } else {
            // Direct API not configured, use fal.ai
            actualModelUsed = 'kling';
            await this.addLog(jobId, `Starting Kling via fal.ai...`);
            videoResult = await Promise.race([
              this.falService.runKlingMotionControl({
                image_url: primaryFrameUrl,
                video_url: videoUrl,
                character_orientation: 'video',
                onProgress: onFalProgress,
              }),
              timeoutPromise,
            ]);
          }
          break;
      }

      // Update output_payload with the actual model used
      const jobAfterGen = await this.supabase.getJob(jobId);
      const payloadAfterGen = (jobAfterGen?.output_payload as Record<string, unknown>) || {};
      await this.supabase.updateJob(jobId, {
        output_payload: {
          ...payloadAfterGen,
          actualModelUsed,
        },
      });

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
        await this.updateProgress(jobId, 90, 'Upscaling complete');
      } else {
        await this.updateProgress(jobId, 90, 'Skipping upscaling');
      }

      // ========================================
      // STAGE 4.5: Merge Original Audio (90-95%)
      // ========================================
      await this.updateProgress(jobId, 91, 'Extracting audio from original video...');
      this.logger.log(`[${jobId}] Stage 4.5: Merging original audio`);

      try {
        // Download original video to extract audio
        const originalVideoBuffer = await this.downloadBuffer(videoUrl);
        const originalVideoPath = path.join(tempDir, 'original_video.mp4');
        const extractedAudioPath = path.join(tempDir, 'extracted_audio.aac');
        const generatedVideoPath = path.join(tempDir, 'generated_video.mp4');
        const mergedVideoPath = path.join(tempDir, 'merged_with_audio.mp4');

        await fs.writeFile(originalVideoPath, originalVideoBuffer);

        // Check if original video has audio
        const { stdout: audioCheck } = await execAsync(
          `ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of csv=p=0 "${originalVideoPath}"`,
        ).catch(() => ({ stdout: '' }));

        const hasAudio = audioCheck.trim() === 'audio';
        this.logger.log(`[${jobId}] Original video has audio: ${hasAudio}`);

        if (hasAudio) {
          await this.updateProgress(jobId, 92, 'Merging audio with generated video...');

          // Extract audio from original video
          await execAsync(
            `ffmpeg -i "${originalVideoPath}" -vn -acodec aac -b:a 128k -y "${extractedAudioPath}"`,
          );
          this.logger.log(`[${jobId}] Audio extracted successfully`);

          // Download generated video
          const generatedVideoBuffer = await this.downloadBuffer(finalVideoUrl);
          await fs.writeFile(generatedVideoPath, generatedVideoBuffer);

          // Get durations to handle length mismatch
          const { stdout: genDuration } = await execAsync(
            `ffprobe -v error -show_entries format=duration -of csv=p=0 "${generatedVideoPath}"`,
          );
          const { stdout: audioDuration } = await execAsync(
            `ffprobe -v error -show_entries format=duration -of csv=p=0 "${extractedAudioPath}"`,
          );

          const genDur = parseFloat(genDuration.trim()) || 5;
          const audDur = parseFloat(audioDuration.trim()) || 5;
          this.logger.log(`[${jobId}] Generated video duration: ${genDur}s, Audio duration: ${audDur}s`);

          // Merge audio with generated video
          // Use -shortest to cut audio if longer than video
          // Use -t to limit to generated video duration
          await execAsync(
            `ffmpeg -i "${generatedVideoPath}" -i "${extractedAudioPath}" -c:v copy -c:a aac -b:a 128k -map 0:v:0 -map 1:a:0 -shortest -t ${genDur} -y "${mergedVideoPath}"`,
          );

          // Update finalVideoUrl to point to local merged file
          const mergedBuffer = await fs.readFile(mergedVideoPath);

          // Upload merged video temporarily to get URL
          const mergedPath = `${videoId}/merged_${Date.now()}.mp4`;
          const { url: mergedUrl } = await this.supabase.uploadFile(
            'processed-videos',
            mergedPath,
            mergedBuffer,
            'video/mp4',
          );

          finalVideoUrl = mergedUrl;
          this.logger.log(`[${jobId}] Audio merged successfully: ${finalVideoUrl}`);
          await this.addLog(jobId, 'Original audio merged with generated video');
        } else {
          this.logger.log(`[${jobId}] No audio in original video, skipping audio merge`);
          await this.addLog(jobId, 'No audio in original video');
        }
      } catch (audioError) {
        const audioErrorMsg = audioError instanceof Error ? audioError.message : String(audioError);
        this.logger.warn(`[${jobId}] Audio merge failed (continuing without audio): ${audioErrorMsg}`);
        await this.addLog(jobId, `Audio merge skipped: ${audioErrorMsg}`);
        // Continue without audio - don't fail the job
      }

      await this.updateProgress(jobId, 95, 'Audio processing complete');

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

      // Mark job completed with skip info and engine used
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
          actualModelUsed,
          upscaleMethod,
          upscaleResolution,
          engineUsed,
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
   * Consolidates similar/duplicate messages to keep logs clean
   */
  private async addLog(jobId: string, message: string): Promise<void> {
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `[${timestamp}] ${message}`;

    const currentJob = await this.supabase.getJob(jobId);
    const existingPayload = (currentJob?.output_payload as Record<string, unknown>) || {};
    const existingLogs = (existingPayload.logs as string[]) || [];

    // Extract base message pattern for consolidation
    // Matches patterns like "[KLING] submitted (50%)" -> "[KLING] submitted"
    // Or "Status: IN_PROGRESS" type messages
    const getBasePattern = (msg: string): string => {
      // Remove timestamp prefix
      const withoutTimestamp = msg.replace(/^\[\d{1,2}:\d{2}:\d{2}\s*(AM|PM)?\]\s*/i, '');
      // Remove percentage patterns like "(50%)" or "50%"
      const withoutPercent = withoutTimestamp.replace(/\s*\(?\d+%\)?/g, '');
      // Remove "Poll X:" patterns
      const withoutPoll = withoutPercent.replace(/Poll \d+:\s*/g, '');
      return withoutPoll.trim();
    };

    const newBasePattern = getBasePattern(logMessage);
    let updatedLogs = [...existingLogs];
    let shouldAdd = true;

    // Check if this is a status update that should consolidate with the last similar message
    if (existingLogs.length > 0) {
      const lastLog = existingLogs[existingLogs.length - 1];
      const lastBasePattern = getBasePattern(lastLog);

      // If same base pattern, update the last entry instead of adding new
      if (lastBasePattern === newBasePattern && newBasePattern.length > 5) {
        // Check if this is a progress update (contains percentage)
        const hasProgress = /\d+%/.test(message);
        if (hasProgress) {
          // Update the last log with new progress
          updatedLogs[updatedLogs.length - 1] = logMessage;
          shouldAdd = false;
        }
      }

      // Also consolidate exact duplicates (ignoring timestamp)
      const messageWithoutTime = logMessage.replace(/^\[\d{1,2}:\d{2}:\d{2}\s*(AM|PM)?\]\s*/i, '');
      const lastWithoutTime = lastLog.replace(/^\[\d{1,2}:\d{2}:\d{2}\s*(AM|PM)?\]\s*/i, '');
      if (messageWithoutTime === lastWithoutTime) {
        shouldAdd = false; // Skip exact duplicate
      }
    }

    if (shouldAdd) {
      updatedLogs.push(logMessage);
    }

    // Keep only last 50 logs to prevent payload from growing too large
    if (updatedLogs.length > 50) {
      updatedLogs = updatedLogs.slice(-50);
    }

    await this.supabase.updateJob(jobId, {
      output_payload: {
        ...existingPayload,
        logs: updatedLogs,
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
