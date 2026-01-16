import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queues.constants';
import { JobsService } from '../jobs.service';
import { FalService } from '../../../services/fal.service';
import { GeminiService } from '../../../services/gemini.service';
import { KlingService } from '../../../services/kling.service';
import { LocalAIService } from '../../../services/local-ai.service';
import { FFmpegService } from '../../../services/ffmpeg.service';
import { SupabaseService } from '../../files/supabase.service';
import { VideoStrategy, VideoModel, UpscaleMethod } from '@novai/shared';

/**
 * Unified Face Swap Job Data
 * Supports all video generation strategies
 */
interface FaceSwapJobData {
  jobId: string;
  strategy: VideoStrategy;
  videoId: string;
  videoUrl: string;
  // Target face
  targetFaceUrl: string;
  targetFaceSource: 'upload' | 'character_diagram' | 'reference_kit';
  characterDiagramId?: string;
  referenceKitId?: string;
  // Additional reference images (for multi-image support)
  additionalReferenceUrls?: string[];
  // LoRA model (optional for face_swap strategy, required for lora_generate/hybrid)
  loraId?: string | null;
  loraWeightsUrl?: string | null;
  loraTriggerWord?: string | null;
  // Video settings
  durationSeconds: number;
  videoModel: VideoModel;
  // Processing options
  keepOriginalOutfit: boolean;
  upscaleMethod: UpscaleMethod;
  upscaleResolution: '2k' | '4k';
  // Strategy-specific options
  keyFrameCount: number;
  refinementStrength: number;
}

// Legacy interface for backward compatibility
interface AdvancedSwapJobData extends Omit<FaceSwapJobData, 'strategy' | 'refinementStrength'> {
  loraId: string;
  loraWeightsUrl: string;
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

@Processor(QUEUES.FACE_SWAP, {
  // Long-running jobs need extended lock duration (5 minutes)
  // Default is 30 seconds, which is too short for frame uploads
  lockDuration: 300000,
  // Renew lock every 2.5 minutes to prevent expiration during long operations
  lockRenewTime: 150000,
})
export class FaceSwapProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(FaceSwapProcessor.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly falService: FalService,
    private readonly geminiService: GeminiService,
    private readonly klingService: KlingService,
    private readonly localAIService: LocalAIService,
    private readonly ffmpegService: FFmpegService,
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

  async process(job: Job<FaceSwapJobData>): Promise<void> {
    this.logger.log('=== FACE SWAP JOB STARTED ===');
    this.logger.log(`BullMQ Job ID: ${job.id}, Job Name: ${job.name}`);
    this.logger.log(`Strategy: ${job.data.strategy || 'lora_generate (legacy)'}`);

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

    // Route based on job name (strategy)
    switch (job.name) {
      case 'direct-face-swap':
        return this.processDirectFaceSwap(job);
      case 'video-lora-swap':
        return this.processVideoLoraSwap(job);
      case 'hybrid-swap':
        return this.processHybridSwap(job);
      case 'advanced-swap':
      default:
        // Default to lora_generate (advanced swap)
        return this.processAdvancedSwap(job as Job<AdvancedSwapJobData>);
    }
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

      // Add any additional reference URLs passed directly
      if (job.data.additionalReferenceUrls?.length) {
        referenceImageUrls.push(...job.data.additionalReferenceUrls);
        this.logger.log(`[${jobId}] Added ${job.data.additionalReferenceUrls.length} additional reference images from job data`);
      }

      // Add additional references from character diagram (multi-image support)
      if (targetFaceSource === 'character_diagram' && characterDiagramId) {
        try {
          const { data: diagramImages } = await this.supabase.getClient()
            .from('character_diagram_images')
            .select('image_url')
            .eq('character_diagram_id', characterDiagramId)
            .order('sort_order', { ascending: true });

          if (diagramImages?.length) {
            // Add all images except the primary (which is already targetFaceUrl)
            for (const img of diagramImages) {
              if (img.image_url && img.image_url !== targetFaceUrl && !referenceImageUrls.includes(img.image_url)) {
                referenceImageUrls.push(img.image_url);
              }
            }
            this.logger.log(`[${jobId}] Added ${diagramImages.length} reference images from character diagram`);
          }
        } catch (diagramError) {
          this.logger.warn(`[${jobId}] Failed to fetch diagram images: ${diagramError}`);
        }
      }

      // Add additional references if using reference kit
      if (targetFaceSource === 'reference_kit' && referenceKitId) {
        const kit = await this.supabase.getReferenceKit(referenceKitId);
        if (kit) {
          if (kit.profile_url) referenceImageUrls.push(kit.profile_url);
          if (kit.half_body_url) referenceImageUrls.push(kit.half_body_url);
          if (kit.full_body_url) referenceImageUrls.push(kit.full_body_url);
        }

        // Also fetch source images from reference_kit_sources table
        try {
          const { data: kitSources } = await this.supabase.getClient()
            .from('reference_kit_sources')
            .select('image_url')
            .eq('reference_kit_id', referenceKitId)
            .order('sort_order', { ascending: true });

          if (kitSources?.length) {
            for (const src of kitSources) {
              if (src.image_url && !referenceImageUrls.includes(src.image_url)) {
                referenceImageUrls.push(src.image_url);
              }
            }
            this.logger.log(`[${jobId}] Added ${kitSources.length} source images from reference kit`);
          }
        } catch (kitError) {
          this.logger.warn(`[${jobId}] Failed to fetch reference kit sources: ${kitError}`);
        }
      }

      this.logger.log(`[${jobId}] Total reference images for identity: ${referenceImageUrls.length}`);
      await this.addLog(jobId, `Using ${referenceImageUrls.length} reference image(s) for identity`);

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

      // Use the already-downloaded video from Stage 1 (inputVideoPath) to check for audio
      // This is more reliable than re-downloading
      try {
        // Check if original video has audio using the file we already have
        const { stdout: audioCheck } = await execAsync(
          `ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of csv=p=0 "${inputVideoPath}"`,
        ).catch((err) => {
          this.logger.warn(`[${jobId}] ffprobe audio check failed: ${err.message}`);
          return { stdout: '' };
        });

        const hasAudio = audioCheck.trim() === 'audio';
        this.logger.log(`[${jobId}] Original video has audio: ${hasAudio}`);
        await this.addLog(jobId, `Original video audio detected: ${hasAudio}`);

        if (hasAudio) {
          await this.updateProgress(jobId, 92, 'Extracting audio track...');

          // Extract audio from original video
          const extractedAudioPath = path.join(tempDir, 'extracted_audio.aac');
          try {
            await execAsync(
              `ffmpeg -i "${inputVideoPath}" -vn -acodec aac -b:a 128k -y "${extractedAudioPath}"`,
            );
            this.logger.log(`[${jobId}] Audio extracted to: ${extractedAudioPath}`);
          } catch (extractError) {
            const extractMsg = extractError instanceof Error ? extractError.message : String(extractError);
            this.logger.error(`[${jobId}] Audio extraction failed: ${extractMsg}`);
            await this.addLog(jobId, `Audio extraction failed: ${extractMsg}`);
            throw extractError;
          }

          // Verify the extracted audio file exists and has content
          const audioStats = await fs.stat(extractedAudioPath).catch(() => null);
          if (!audioStats || audioStats.size === 0) {
            this.logger.warn(`[${jobId}] Extracted audio file is empty or missing`);
            await this.addLog(jobId, 'Extracted audio file is empty');
          } else {
            this.logger.log(`[${jobId}] Extracted audio size: ${audioStats.size} bytes`);

            await this.updateProgress(jobId, 93, 'Merging audio with generated video...');

            // Download generated video
            const generatedVideoPath = path.join(tempDir, 'generated_video.mp4');
            const generatedVideoBuffer = await this.downloadBuffer(finalVideoUrl);
            await fs.writeFile(generatedVideoPath, generatedVideoBuffer);
            this.logger.log(`[${jobId}] Downloaded generated video: ${generatedVideoBuffer.length} bytes`);

            // Get durations for logging
            const { stdout: genDuration } = await execAsync(
              `ffprobe -v error -show_entries format=duration -of csv=p=0 "${generatedVideoPath}"`,
            ).catch(() => ({ stdout: '5' }));
            const { stdout: audioDuration } = await execAsync(
              `ffprobe -v error -show_entries format=duration -of csv=p=0 "${extractedAudioPath}"`,
            ).catch(() => ({ stdout: '5' }));

            const genDur = parseFloat(genDuration.trim()) || 5;
            const audDur = parseFloat(audioDuration.trim()) || 5;
            this.logger.log(`[${jobId}] Generated video: ${genDur.toFixed(2)}s, Audio: ${audDur.toFixed(2)}s`);
            await this.addLog(jobId, `Video duration: ${genDur.toFixed(1)}s, Audio: ${audDur.toFixed(1)}s`);

            // Merge audio with generated video
            const mergedVideoPath = path.join(tempDir, 'merged_with_audio.mp4');
            try {
              // Use -shortest to handle duration mismatch, -map to explicitly select streams
              await execAsync(
                `ffmpeg -i "${generatedVideoPath}" -i "${extractedAudioPath}" -c:v copy -c:a aac -b:a 128k -map 0:v:0 -map 1:a:0 -shortest -y "${mergedVideoPath}"`,
              );
              this.logger.log(`[${jobId}] Audio merge command completed`);
            } catch (mergeError) {
              const mergeMsg = mergeError instanceof Error ? mergeError.message : String(mergeError);
              this.logger.error(`[${jobId}] FFmpeg merge failed: ${mergeMsg}`);
              await this.addLog(jobId, `Audio merge failed: ${mergeMsg}`);
              throw mergeError;
            }

            // Verify merged video has audio
            const { stdout: mergedAudioCheck } = await execAsync(
              `ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of csv=p=0 "${mergedVideoPath}"`,
            ).catch(() => ({ stdout: '' }));

            if (mergedAudioCheck.trim() === 'audio') {
              // Read merged video and upload
              const mergedBuffer = await fs.readFile(mergedVideoPath);
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
              this.logger.warn(`[${jobId}] Merged video does not have audio track`);
              await this.addLog(jobId, 'Warning: Merged video missing audio track');
            }
          }
        } else {
          this.logger.log(`[${jobId}] No audio in original video, skipping audio merge`);
          await this.addLog(jobId, 'No audio in original video');
        }
      } catch (audioError) {
        const audioErrorMsg = audioError instanceof Error ? audioError.message : String(audioError);
        this.logger.error(`[${jobId}] Audio processing failed: ${audioErrorMsg}`);
        await this.addLog(jobId, `Audio processing error: ${audioErrorMsg}`);
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

  /**
   * Strategy A: Direct Face Swap
   * Fastest option - extracts frames, applies face swap to each, reassembles
   */
  private async processDirectFaceSwap(job: Job<FaceSwapJobData>): Promise<void> {
    const {
      jobId,
      videoId,
      videoUrl,
      targetFaceUrl,
      targetFaceSource,
      characterDiagramId,
      referenceKitId,
      durationSeconds = 10,
      upscaleMethod = 'none',
    } = job.data;

    const startTime = Date.now();
    const uploadPrefix = `${videoId}/direct_swap_${Date.now()}`;

    try {
      await this.jobsService.markJobProcessing(jobId);
      await this.updateProgress(jobId, 2, 'Starting direct face swap...');

      this.logger.log(`[${jobId}] Direct Face Swap Pipeline started`);
      this.logger.log(`[${jobId}] Video URL: ${videoUrl}`);
      this.logger.log(`[${jobId}] Target Face: ${targetFaceSource} - ${targetFaceUrl}`);

      // ========================================
      // STAGE 1: Get Video Info (0-5%)
      // ========================================
      await this.updateProgress(jobId, 5, 'Analyzing video...');
      const videoInfo = await this.ffmpegService.getVideoInfo(videoUrl);
      this.logger.log(`[${jobId}] Video info: ${videoInfo.fps}fps, ${videoInfo.duration}s, ${videoInfo.frameCount} frames`);

      // ========================================
      // STAGE 2: Extract Audio (5-10%)
      // ========================================
      await this.updateProgress(jobId, 8, 'Extracting audio...');
      const audioUrl = await this.ffmpegService.extractAudio(videoUrl, uploadPrefix);
      this.logger.log(`[${jobId}] Audio extracted: ${audioUrl || 'no audio'}`);

      // ========================================
      // STAGE 3: Extract Frames (10-30%)
      // ========================================
      await this.updateProgress(jobId, 10, 'Extracting video frames...');

      // Extract every frame for best quality
      const frameUrls = await this.ffmpegService.extractFrames(
        videoUrl,
        { interval: 1 },
        uploadPrefix,
      );
      this.logger.log(`[${jobId}] Extracted ${frameUrls.length} frames`);
      await this.updateProgress(jobId, 30, `Extracted ${frameUrls.length} frames`);

      // ========================================
      // STAGE 4: Face Swap Each Frame (30-85%)
      // ========================================
      await this.updateProgress(jobId, 32, 'Applying face swap to frames...');

      const swappedFrameUrls: string[] = [];
      const BATCH_SIZE = 5; // Process 5 frames in parallel for speed

      for (let i = 0; i < frameUrls.length; i += BATCH_SIZE) {
        const batch = frameUrls.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(frameUrls.length / BATCH_SIZE);

        // Process batch in parallel
        const results = await Promise.all(
          batch.map(async (frameUrl) => {
            try {
              const result = await this.falService.runFaceSwap({
                base_image_url: frameUrl,
                swap_image_url: targetFaceUrl,
              });
              return result.image?.url || frameUrl; // Fallback to original if swap fails
            } catch (error) {
              this.logger.warn(`[${jobId}] Face swap failed for frame, using original`);
              return frameUrl; // Use original frame on error
            }
          }),
        );

        swappedFrameUrls.push(...results);

        // Update progress
        const progress = 32 + Math.round((i / frameUrls.length) * 53);
        await this.updateProgress(jobId, progress, `Processing batch ${batchNum}/${totalBatches}...`);
      }

      this.logger.log(`[${jobId}] Face swap complete for ${swappedFrameUrls.length} frames`);
      await this.updateProgress(jobId, 85, 'Face swap complete');

      // ========================================
      // STAGE 5: Reassemble Video (85-95%)
      // ========================================
      await this.updateProgress(jobId, 87, 'Reassembling video...');

      const assembledVideoUrl = await this.ffmpegService.assembleFrames(
        swappedFrameUrls,
        { fps: videoInfo.fps, audioUrl: audioUrl || undefined },
        uploadPrefix,
      );

      this.logger.log(`[${jobId}] Video reassembled: ${assembledVideoUrl}`);
      await this.updateProgress(jobId, 95, 'Video assembled');

      // ========================================
      // STAGE 6: Finalize (95-100%)
      // ========================================
      await this.updateProgress(jobId, 97, 'Finalizing...');

      // Create video record
      const videoName = `Face Swap (Direct) - ${new Date().toLocaleString()}`;
      const resultBuffer = await this.downloadBuffer(assembledVideoUrl);

      const swappedVideo = await this.supabase.createVideo({
        name: videoName,
        type: 'face_swapped',
        parent_video_id: videoId,
        character_diagram_id: characterDiagramId || null,
        file_url: assembledVideoUrl,
        duration_seconds: durationSeconds,
        collection_id: null,
        thumbnail_url: null,
        width: videoInfo.width || null,
        height: videoInfo.height || null,
        file_size_bytes: resultBuffer.length,
      });

      // Calculate cost: ~$0.003 per frame
      const costCents = Math.round(frameUrls.length * 0.3);

      await this.jobsService.markJobCompleted(
        jobId,
        {
          outputVideoId: swappedVideo.id,
          outputUrl: assembledVideoUrl,
          strategy: 'face_swap',
          framesProcessed: frameUrls.length,
          processingTimeMs: Date.now() - startTime,
        },
        costCents,
      );

      await this.updateProgress(jobId, 100, 'Complete');
      this.logger.log(`[${jobId}] Direct face swap completed in ${(Date.now() - startTime) / 1000}s`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[${jobId}] Direct face swap failed: ${errorMessage}`);
      await this.jobsService.markJobFailed(jobId, errorMessage);
      throw error;
    }
  }

  /**
   * Strategy C: Video-Trained LoRA
   * Best quality - trains a LoRA on video frames, then generates
   */
  private async processVideoLoraSwap(job: Job<FaceSwapJobData>): Promise<void> {
    const {
      jobId,
      videoId,
      videoUrl,
      targetFaceUrl,
      targetFaceSource,
      characterDiagramId,
      referenceKitId,
      durationSeconds = 10,
      videoModel = 'kling',
      keyFrameCount = 10,
      upscaleMethod = 'none',
    } = job.data;

    const startTime = Date.now();
    const uploadPrefix = `${videoId}/video_lora_${Date.now()}`;

    try {
      await this.jobsService.markJobProcessing(jobId);
      await this.updateProgress(jobId, 2, 'Starting video-trained LoRA pipeline...');

      this.logger.log(`[${jobId}] Video-Trained LoRA Pipeline started`);

      // ========================================
      // STAGE 1: Extract Key Frames (0-15%)
      // ========================================
      await this.updateProgress(jobId, 5, `Extracting ${keyFrameCount} key frames...`);

      const keyFrameUrls = await this.ffmpegService.extractFrames(
        videoUrl,
        { count: keyFrameCount },
        uploadPrefix,
      );

      this.logger.log(`[${jobId}] Extracted ${keyFrameUrls.length} key frames for training`);
      await this.updateProgress(jobId, 15, 'Key frames extracted');

      // ========================================
      // STAGE 2: Create Training ZIP (15-20%)
      // ========================================
      await this.updateProgress(jobId, 17, 'Creating training dataset...');

      const trainingZipUrl = await this.ffmpegService.createTrainingZip(
        keyFrameUrls,
        uploadPrefix,
      );

      this.logger.log(`[${jobId}] Training ZIP created: ${trainingZipUrl}`);
      await this.updateProgress(jobId, 20, 'Training dataset ready');

      // ========================================
      // STAGE 3: Train Video-Specific LoRA (20-60%)
      // ========================================
      await this.updateProgress(jobId, 22, 'Training video-specific LoRA...');
      await this.addLog(jobId, 'This may take 10-15 minutes...');

      const triggerWord = `person_${videoId.slice(0, 8)}`;

      const loraResult = await this.falService.runWan22Training(
        {
          training_data_url: trainingZipUrl,
          trigger_phrase: triggerWord,
          steps: 500, // Fewer steps for video-specific training
          is_style: false,
          use_face_detection: true,
          use_face_cropping: true,
        },
        {
          onQueueUpdate: async (update) => {
            await this.addLog(jobId, `[TRAINING] ${update.status}`);
          },
        },
      );

      const trainedLoraUrl = loraResult.high_noise_lora?.url;
      if (!trainedLoraUrl) {
        throw new Error('LoRA training did not produce weights');
      }

      this.logger.log(`[${jobId}] Video LoRA trained: ${trainedLoraUrl}`);
      await this.updateProgress(jobId, 60, 'LoRA training complete');

      // ========================================
      // STAGE 4: Generate Video with Trained LoRA (60-90%)
      // ========================================
      await this.updateProgress(jobId, 62, 'Generating video with trained LoRA...');

      // Extract first frame for video generation
      const firstFrameUrls = await this.ffmpegService.extractFrames(
        videoUrl,
        { count: 1 },
        `${uploadPrefix}/first_frame`,
      );
      const firstFrameUrl = firstFrameUrls[0];

      // Generate video (simplified - would use the trained LoRA)
      // For now, we'll use the motion control approach
      const videoTimeoutMs = 20 * 60 * 1000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new JobTimeoutError(videoTimeoutMs)), videoTimeoutMs);
      });

      const videoResult = await Promise.race([
        this.falService.runKlingMotionControl({
          image_url: firstFrameUrl,
          video_url: videoUrl,
          character_orientation: 'video',
          onProgress: async (status) => {
            await this.addLog(jobId, `[VIDEO] ${status.status}`);
          },
        }),
        timeoutPromise,
      ]);

      if (!videoResult.video?.url) {
        throw new Error('Video generation failed');
      }

      this.logger.log(`[${jobId}] Video generated: ${videoResult.video.url}`);
      await this.updateProgress(jobId, 90, 'Video generation complete');

      // ========================================
      // STAGE 5: Finalize (90-100%)
      // ========================================
      await this.updateProgress(jobId, 95, 'Finalizing...');

      const resultBuffer = await this.downloadBuffer(videoResult.video.url);
      const videoName = `Video LoRA - ${new Date().toLocaleString()}`;

      const swappedVideo = await this.supabase.createVideo({
        name: videoName,
        type: 'face_swapped',
        parent_video_id: videoId,
        character_diagram_id: characterDiagramId || null,
        file_url: videoResult.video.url,
        duration_seconds: durationSeconds,
        collection_id: null,
        thumbnail_url: null,
        width: null,
        height: null,
        file_size_bytes: resultBuffer.length,
      });

      // Cost: LoRA training (~$1.50) + video generation
      const costCents = 150 + (VIDEO_MODEL_COSTS[videoModel] || 8);

      await this.jobsService.markJobCompleted(
        jobId,
        {
          outputVideoId: swappedVideo.id,
          outputUrl: videoResult.video.url,
          strategy: 'video_lora',
          trainedLoraUrl,
          triggerWord,
          processingTimeMs: Date.now() - startTime,
        },
        costCents,
      );

      await this.updateProgress(jobId, 100, 'Complete');
      this.logger.log(`[${jobId}] Video-trained LoRA completed in ${(Date.now() - startTime) / 1000}s`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[${jobId}] Video-trained LoRA failed: ${errorMessage}`);
      await this.jobsService.markJobFailed(jobId, errorMessage);
      throw error;
    }
  }

  /**
   * Strategy D: Hybrid (Generate + Refine)
   * High quality generation followed by face swap refinement
   */
  private async processHybridSwap(job: Job<FaceSwapJobData>): Promise<void> {
    const {
      jobId,
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
      refinementStrength = 0.5,
    } = job.data;

    const startTime = Date.now();
    const uploadPrefix = `${videoId}/hybrid_${Date.now()}`;

    if (!loraWeightsUrl) {
      throw new Error('LoRA model is required for hybrid strategy');
    }

    try {
      await this.jobsService.markJobProcessing(jobId);
      await this.updateProgress(jobId, 2, 'Starting hybrid pipeline...');

      this.logger.log(`[${jobId}] Hybrid Pipeline started`);
      this.logger.log(`[${jobId}] Refinement strength: ${refinementStrength}`);

      // ========================================
      // STAGE 1: Run lora_generate (0-60%)
      // ========================================
      await this.updateProgress(jobId, 5, 'Stage 1: Generating video with LoRA...');

      // Create a temporary job-like structure for the advanced swap
      const advancedSwapData: AdvancedSwapJobData = {
        jobId,
        videoId,
        videoUrl,
        targetFaceUrl,
        targetFaceSource,
        characterDiagramId,
        referenceKitId,
        loraId: loraId!,
        loraWeightsUrl: loraWeightsUrl!,
        loraTriggerWord: loraTriggerWord || undefined,
        durationSeconds,
        videoModel,
        keepOriginalOutfit,
        upscaleMethod: 'none', // Skip upscaling in first pass
        upscaleResolution: '2k',
        keyFrameCount: 1,
      };

      // Run the first pass (lora_generate)
      // Note: This is a simplified version - in production you'd want to
      // capture the intermediate result without marking job complete
      await this.updateProgress(jobId, 10, 'Generating initial video...');

      // Extract first frame
      const fs = await import('fs/promises');
      const path = await import('path');
      const os = await import('os');
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hybrid-'));
      const videoBuffer = await this.downloadBuffer(videoUrl);
      const inputVideoPath = path.join(tempDir, 'input.mp4');
      await fs.writeFile(inputVideoPath, videoBuffer);

      const firstFramePath = path.join(tempDir, 'first_frame.png');
      await execAsync(
        `ffmpeg -i "${inputVideoPath}" -vf "select=eq(n\\,0)" -vframes 1 "${firstFramePath}"`,
      );

      const firstFrameBuffer = await fs.readFile(firstFramePath);
      const firstFrameUploadPath = `${uploadPrefix}/first_frame.png`;
      const { url: firstFrameUrl } = await this.supabase.uploadFile(
        'processed-videos',
        firstFrameUploadPath,
        firstFrameBuffer,
        'image/png',
      );

      // Regenerate first frame with identity
      await this.updateProgress(jobId, 20, 'Regenerating frame with identity...');

      let primaryFrameUrl = firstFrameUrl;
      try {
        const regeneratedResult = await this.geminiService.regenerateFrameWithIdentity(
          firstFrameUrl,
          [targetFaceUrl],
          keepOriginalOutfit,
        );

        const regeneratedBuffer = Buffer.from(regeneratedResult.imageBase64, 'base64');
        const regenUploadPath = `${uploadPrefix}/regenerated_frame.png`;
        const { url: regenUrl } = await this.supabase.uploadFile(
          'processed-videos',
          regenUploadPath,
          regeneratedBuffer,
          'image/png',
        );
        primaryFrameUrl = regenUrl;
      } catch (geminiError) {
        this.logger.warn(`[${jobId}] Gemini regeneration failed, using original`);
      }

      // Generate video
      await this.updateProgress(jobId, 35, 'Generating video with motion...');

      const videoTimeoutMs = 20 * 60 * 1000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new JobTimeoutError(videoTimeoutMs)), videoTimeoutMs);
      });

      const generatedVideo = await Promise.race([
        this.falService.runKlingMotionControl({
          image_url: primaryFrameUrl,
          video_url: videoUrl,
          character_orientation: 'video',
          onProgress: async (status) => {
            await this.addLog(jobId, `[KLING] ${status.status}`);
          },
        }),
        timeoutPromise,
      ]);

      if (!generatedVideo.video?.url) {
        throw new Error('Video generation failed');
      }

      await this.updateProgress(jobId, 60, 'Initial video generated');

      // ========================================
      // STAGE 2: Extract frames from generated video (60-65%)
      // ========================================
      await this.updateProgress(jobId, 62, 'Stage 2: Extracting frames for refinement...');

      const videoInfo = await this.ffmpegService.getVideoInfo(generatedVideo.video.url);
      const generatedFrameUrls = await this.ffmpegService.extractFrames(
        generatedVideo.video.url,
        { interval: 1 },
        `${uploadPrefix}/generated_frames`,
      );

      this.logger.log(`[${jobId}] Extracted ${generatedFrameUrls.length} frames for refinement`);
      await this.updateProgress(jobId, 65, `Extracted ${generatedFrameUrls.length} frames`);

      // ========================================
      // STAGE 3: Apply face swap refinement (65-90%)
      // ========================================
      await this.updateProgress(jobId, 67, 'Stage 3: Applying face swap refinement...');

      const refinedFrameUrls: string[] = [];
      const BATCH_SIZE = 5;

      for (let i = 0; i < generatedFrameUrls.length; i += BATCH_SIZE) {
        const batch = generatedFrameUrls.slice(i, i + BATCH_SIZE);

        const results = await Promise.all(
          batch.map(async (frameUrl) => {
            try {
              const result = await this.falService.runFaceSwap({
                base_image_url: frameUrl,
                swap_image_url: targetFaceUrl,
              });
              return result.image?.url || frameUrl;
            } catch {
              return frameUrl;
            }
          }),
        );

        refinedFrameUrls.push(...results);

        const progress = 67 + Math.round((i / generatedFrameUrls.length) * 23);
        await this.updateProgress(jobId, progress, `Refining frames... ${i + batch.length}/${generatedFrameUrls.length}`);
      }

      await this.updateProgress(jobId, 90, 'Refinement complete');

      // ========================================
      // STAGE 4: Reassemble refined video (90-95%)
      // ========================================
      await this.updateProgress(jobId, 91, 'Extracting audio from original video...');

      // Extract audio from ORIGINAL source video (not the generated video)
      // AI-generated videos typically don't have audio, so we preserve the original
      const audioUrl = await this.ffmpegService.extractAudio(videoUrl, `${uploadPrefix}/audio`);
      this.logger.log(`[${jobId}] Original audio extracted: ${audioUrl || 'no audio'}`);

      await this.updateProgress(jobId, 93, 'Reassembling refined video with original audio...');

      const refinedVideoUrl = await this.ffmpegService.assembleFrames(
        refinedFrameUrls,
        { fps: videoInfo.fps, audioUrl: audioUrl || undefined },
        `${uploadPrefix}/final`,
      );

      await this.updateProgress(jobId, 95, 'Video assembled with audio');

      // ========================================
      // STAGE 5: Finalize (95-100%)
      // ========================================
      await this.updateProgress(jobId, 97, 'Finalizing...');

      const resultBuffer = await this.downloadBuffer(refinedVideoUrl);
      const videoName = `Hybrid (LoRA + Refine) - ${new Date().toLocaleString()}`;

      const swappedVideo = await this.supabase.createVideo({
        name: videoName,
        type: 'face_swapped',
        parent_video_id: videoId,
        character_diagram_id: characterDiagramId || null,
        file_url: refinedVideoUrl,
        duration_seconds: durationSeconds,
        collection_id: null,
        thumbnail_url: null,
        width: videoInfo.width || null,
        height: videoInfo.height || null,
        file_size_bytes: resultBuffer.length,
      });

      // Cost: lora_generate cost + face_swap per frame
      const loraGenerateCost = 2 + (VIDEO_MODEL_COSTS[videoModel] || 8);
      const faceSwapCost = Math.round(refinedFrameUrls.length * 0.3);
      const costCents = loraGenerateCost + faceSwapCost;

      await this.jobsService.markJobCompleted(
        jobId,
        {
          outputVideoId: swappedVideo.id,
          outputUrl: refinedVideoUrl,
          strategy: 'hybrid',
          loraId,
          framesRefined: refinedFrameUrls.length,
          refinementStrength,
          processingTimeMs: Date.now() - startTime,
        },
        costCents,
      );

      // Cleanup temp directory
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {}

      await this.updateProgress(jobId, 100, 'Complete');
      this.logger.log(`[${jobId}] Hybrid pipeline completed in ${(Date.now() - startTime) / 1000}s`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[${jobId}] Hybrid pipeline failed: ${errorMessage}`);
      await this.jobsService.markJobFailed(jobId, errorMessage);
      throw error;
    }
  }
}

// Video model costs for cost calculation (duplicated from swap.service.ts for processor)
const VIDEO_MODEL_COSTS: Record<string, number> = {
  kling: 8,
  'kling-2.5': 12,
  'kling-2.6': 20,
  luma: 100,
  sora2pro: 100,
  wan: 5,
};
