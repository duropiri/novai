import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JobsService } from '../jobs/jobs.service';
import { SupabaseService, DbVideo } from '../files/supabase.service';
import { QUEUES } from '../jobs/queues.constants';
import { VideoStrategy, VideoModel, UpscaleMethod } from '@novai/shared';

export interface CreateFaceSwapDto {
  videoId: string;
  // Strategy selection
  strategy: VideoStrategy;
  // Target face - at least one required
  uploadedFaceUrl?: string;
  characterDiagramId?: string;
  referenceKitId?: string;
  // LoRA model - required for lora_generate and hybrid strategies
  loraId?: string;
  // Video generation model (used by lora_generate, video_lora, hybrid)
  videoModel?: VideoModel;
  // Processing options
  keepOriginalOutfit?: boolean;
  // Upscaling options
  upscaleMethod?: UpscaleMethod;
  upscaleResolution?: '2k' | '4k';
  // Strategy-specific options
  keyFrameCount?: number; // For video_lora: frames to train on
  refinementStrength?: number; // For hybrid: refinement intensity (0-1)
}

export interface FaceSwapResult {
  jobId: string;
  videoId: string;
  targetFaceSource: string;
  strategy: VideoStrategy;
  estimatedCostCents: number;
}

// Cost constants (in cents)
const GEMINI_COST = 2; // ~$0.02 for Gemini frame regeneration
const FACE_SWAP_PER_FRAME = 0.3; // ~$0.003 per frame for fal.ai face swap

// Video model costs (in cents) - approximate for 5 second video
const VIDEO_MODEL_COSTS: Record<string, number> = {
  kling: 8,        // Kling v1.6 Direct ~$0.08/5s (recommended)
  'kling-2.5': 12, // Kling v2.5 Direct ~$0.12/5s (cinematic)
  'kling-2.6': 20, // Kling v2.6 Direct ~$0.20/5s (with audio)
  luma: 100,       // Luma Dream Machine ~$1.00/5s (premium)
  sora2pro: 100,   // Sora 2 Pro ~$1.00/5s (premium)
  wan: 5,          // WAN v2.2 ~$0.05/5s (fast/cheap)
};

// Upscaling costs (in cents)
const UPSCALE_COSTS: Record<string, number> = {
  'real-esrgan': 5,  // ~$0.05 fast upscaling
  'clarity': 15,     // ~$0.15 quality upscaling
  'creative': 20,    // ~$0.20 AI-enhanced upscaling
  'none': 0,
};

// LoRA training costs (in cents)
const LORA_TRAINING_COST = 150; // ~$1.50 for video-specific LoRA training

@Injectable()
export class SwapService {
  private readonly logger = new Logger(SwapService.name);

  constructor(
    @InjectQueue(QUEUES.FACE_SWAP) private faceSwapQueue: Queue,
    private readonly jobsService: JobsService,
    private readonly supabase: SupabaseService,
  ) {}

  async createFaceSwap(dto: CreateFaceSwapDto): Promise<FaceSwapResult> {
    const strategy = dto.strategy || 'lora_generate'; // Default to current behavior

    // Validate target face - at least one source required
    if (!dto.uploadedFaceUrl && !dto.characterDiagramId && !dto.referenceKitId) {
      throw new Error('Target face is required (uploadedFaceUrl, characterDiagramId, or referenceKitId)');
    }

    // Validate strategy-specific requirements
    if ((strategy === 'lora_generate' || strategy === 'hybrid') && !dto.loraId) {
      throw new Error(`LoRA model is required for ${strategy} strategy`);
    }

    // Get video details
    const video = await this.supabase.getVideo(dto.videoId);
    if (!video) {
      throw new Error('Video not found');
    }

    // Get target face URL and determine source type
    let targetFaceUrl: string;
    let targetFaceSource: 'upload' | 'character_diagram' | 'reference_kit';

    if (dto.uploadedFaceUrl) {
      targetFaceUrl = dto.uploadedFaceUrl;
      targetFaceSource = 'upload';
    } else if (dto.characterDiagramId) {
      const diagram = await this.supabase.getCharacterDiagram(dto.characterDiagramId);
      if (!diagram) {
        throw new Error('Character diagram not found');
      }
      if (diagram.status !== 'ready' || !diagram.file_url) {
        throw new Error('Character diagram is not ready');
      }
      targetFaceUrl = diagram.file_url;
      targetFaceSource = 'character_diagram';
    } else {
      const kit = await this.supabase.getReferenceKit(dto.referenceKitId!);
      if (!kit) {
        throw new Error('Reference kit not found');
      }
      if (kit.status !== 'ready' || !kit.anchor_face_url) {
        throw new Error('Reference kit is not ready (missing anchor face)');
      }
      targetFaceUrl = kit.anchor_face_url;
      targetFaceSource = 'reference_kit';
    }

    // Get LoRA model if provided (required for lora_generate and hybrid)
    let loraUrl: string | null = null;
    let loraTriggerWord: string | null = null;
    if (dto.loraId) {
      const lora = await this.supabase.getLoraModel(dto.loraId);
      if (!lora) {
        throw new Error('LoRA model not found');
      }
      loraUrl = lora.lora_url || lora.weights_url;
      if (lora.status !== 'ready' || !loraUrl) {
        throw new Error('LoRA model is not ready');
      }
      loraTriggerWord = lora.trigger_word;
    }

    const durationSeconds = video.duration_seconds || 10;
    const fps = 30; // Assume 30fps for frame count estimation
    const estimatedFrameCount = Math.round(fps * durationSeconds);

    // Calculate estimated cost based on strategy
    const estimatedCostCents = this.calculateCost({
      strategy,
      videoModel: dto.videoModel || 'kling',
      upscaleMethod: dto.upscaleMethod || 'none',
      keyFrameCount: dto.keyFrameCount || 10,
      estimatedFrameCount,
    });

    this.logger.log(`Creating ${strategy} face swap job`, {
      strategy,
      videoId: dto.videoId,
      targetFaceSource,
      loraId: dto.loraId,
      videoModel: dto.videoModel,
      upscaleMethod: dto.upscaleMethod,
      durationSeconds,
      estimatedCostCents,
    });

    // Create job record with strategy
    const job = await this.jobsService.createJob('face_swap', dto.videoId, {
      strategy,
      videoId: dto.videoId,
      videoUrl: video.file_url,
      targetFaceUrl,
      targetFaceSource,
      characterDiagramId: dto.characterDiagramId,
      referenceKitId: dto.referenceKitId,
      uploadedFaceUrl: dto.uploadedFaceUrl,
      loraId: dto.loraId || null,
      loraWeightsUrl: loraUrl,
      loraTriggerWord,
      durationSeconds,
      videoModel: dto.videoModel || 'kling',
      keepOriginalOutfit: dto.keepOriginalOutfit ?? true,
      upscaleMethod: dto.upscaleMethod || 'none',
      upscaleResolution: dto.upscaleResolution || '2k',
      keyFrameCount: dto.keyFrameCount || 10,
      refinementStrength: dto.refinementStrength || 0.5,
    });

    // Queue the job based on strategy
    const jobName = this.getJobNameForStrategy(strategy);
    await this.faceSwapQueue.add(jobName, {
      jobId: job.id,
      strategy,
      videoId: dto.videoId,
      videoUrl: video.file_url,
      targetFaceUrl,
      targetFaceSource,
      characterDiagramId: dto.characterDiagramId,
      referenceKitId: dto.referenceKitId,
      loraId: dto.loraId || null,
      loraWeightsUrl: loraUrl,
      loraTriggerWord,
      durationSeconds,
      videoModel: dto.videoModel || 'kling',
      keepOriginalOutfit: dto.keepOriginalOutfit ?? true,
      upscaleMethod: dto.upscaleMethod || 'none',
      upscaleResolution: dto.upscaleResolution || '2k',
      keyFrameCount: dto.keyFrameCount || 10,
      refinementStrength: dto.refinementStrength || 0.5,
    });

    await this.jobsService.updateJob(job.id, { status: 'queued' });

    this.logger.log(`${strategy} face swap job queued: ${job.id}`);

    return {
      jobId: job.id,
      videoId: dto.videoId,
      targetFaceSource,
      strategy,
      estimatedCostCents,
    };
  }

  /**
   * Get the BullMQ job name for a given strategy
   */
  private getJobNameForStrategy(strategy: VideoStrategy): string {
    switch (strategy) {
      case 'face_swap':
        return 'direct-face-swap';
      case 'lora_generate':
        return 'advanced-swap'; // Keep existing job name for backward compatibility
      case 'video_lora':
        return 'video-lora-swap';
      case 'hybrid':
        return 'hybrid-swap';
      default:
        return 'advanced-swap';
    }
  }

  private calculateCost(options: {
    strategy: VideoStrategy;
    videoModel: string;
    upscaleMethod: string;
    keyFrameCount: number;
    estimatedFrameCount: number;
  }): number {
    let total = 0;

    switch (options.strategy) {
      case 'face_swap':
        // Direct face swap: cost per frame
        total = Math.round(options.estimatedFrameCount * FACE_SWAP_PER_FRAME);
        break;

      case 'lora_generate':
        // Current approach: Gemini + video generation
        total = GEMINI_COST;
        total += VIDEO_MODEL_COSTS[options.videoModel] || VIDEO_MODEL_COSTS.kling;
        break;

      case 'video_lora':
        // Train LoRA on video frames + generate
        total = LORA_TRAINING_COST;
        total += VIDEO_MODEL_COSTS[options.videoModel] || VIDEO_MODEL_COSTS.kling;
        break;

      case 'hybrid':
        // lora_generate + face_swap on output
        total = GEMINI_COST;
        total += VIDEO_MODEL_COSTS[options.videoModel] || VIDEO_MODEL_COSTS.kling;
        total += Math.round(options.estimatedFrameCount * FACE_SWAP_PER_FRAME);
        break;
    }

    // Add upscaling cost
    total += UPSCALE_COSTS[options.upscaleMethod] || 0;

    return total;
  }

  async getSwapResults(jobId: string): Promise<DbVideo | null> {
    const job = await this.supabase.getJob(jobId);
    if (!job || job.status !== 'completed') {
      return null;
    }

    const outputPayload = job.output_payload as { outputVideoId?: string } | null;
    if (!outputPayload?.outputVideoId) {
      return null;
    }

    return this.supabase.getVideo(outputPayload.outputVideoId);
  }

  async listSwappedVideos(): Promise<DbVideo[]> {
    return this.supabase.listVideos({ type: 'face_swapped' });
  }

  async retryJob(jobId: string): Promise<{ jobId: string }> {
    const job = await this.supabase.getJob(jobId);
    if (!job) {
      throw new Error('Job not found');
    }

    // Only allow retry for failed or stuck jobs
    if (!['failed', 'processing'].includes(job.status)) {
      throw new Error(`Cannot retry job with status: ${job.status}`);
    }

    // Check if processing job is stuck (more than 30 minutes)
    if (job.status === 'processing' && job.started_at) {
      const startedAt = new Date(job.started_at).getTime();
      const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
      if (startedAt > thirtyMinutesAgo) {
        throw new Error('Cannot retry job that is still actively processing. Wait for completion or for it to become stuck.');
      }
    }

    // Get original input payload with strategy
    const inputPayload = job.input_payload as {
      strategy?: VideoStrategy;
      videoId?: string;
      videoUrl?: string;
      targetFaceUrl?: string;
      targetFaceSource?: 'upload' | 'character_diagram' | 'reference_kit';
      characterDiagramId?: string;
      referenceKitId?: string;
      loraId?: string;
      loraWeightsUrl?: string;
      loraTriggerWord?: string;
      durationSeconds?: number;
      videoModel?: VideoModel;
      keepOriginalOutfit?: boolean;
      upscaleMethod?: UpscaleMethod;
      upscaleResolution?: '2k' | '4k';
      keyFrameCount?: number;
      refinementStrength?: number;
    } | null;

    if (!inputPayload?.videoUrl || !inputPayload?.targetFaceUrl) {
      throw new Error('Job is missing required input data for retry');
    }

    // Reset job status
    await this.supabase.updateJob(jobId, {
      status: 'queued',
      progress: 0,
      error_message: null,
      started_at: null,
      completed_at: null,
      external_request_id: null,
      external_status: null,
    });

    // Determine strategy and queue appropriate job
    const strategy = inputPayload.strategy || 'lora_generate';
    const jobName = this.getJobNameForStrategy(strategy);

    await this.faceSwapQueue.add(jobName, {
      jobId: job.id,
      strategy,
      videoId: inputPayload.videoId,
      videoUrl: inputPayload.videoUrl,
      targetFaceUrl: inputPayload.targetFaceUrl,
      targetFaceSource: inputPayload.targetFaceSource,
      characterDiagramId: inputPayload.characterDiagramId,
      referenceKitId: inputPayload.referenceKitId,
      loraId: inputPayload.loraId,
      loraWeightsUrl: inputPayload.loraWeightsUrl,
      loraTriggerWord: inputPayload.loraTriggerWord,
      durationSeconds: inputPayload.durationSeconds,
      videoModel: inputPayload.videoModel || 'kling',
      keepOriginalOutfit: inputPayload.keepOriginalOutfit ?? true,
      upscaleMethod: inputPayload.upscaleMethod || 'none',
      upscaleResolution: inputPayload.upscaleResolution || '2k',
      keyFrameCount: inputPayload.keyFrameCount || 10,
      refinementStrength: inputPayload.refinementStrength || 0.5,
    });

    this.logger.log(`Retried ${strategy} face swap job: ${jobId}`);
    return { jobId };
  }

  async deleteJob(jobId: string): Promise<void> {
    const job = await this.supabase.getJob(jobId);
    if (!job) {
      throw new Error('Job not found');
    }

    // Get output video if exists and delete it
    const outputPayload = job.output_payload as { outputVideoId?: string; outputUrl?: string } | null;
    if (outputPayload?.outputVideoId) {
      try {
        await this.supabase.deleteVideo(outputPayload.outputVideoId);
      } catch (error) {
        this.logger.warn(`Failed to delete output video: ${error}`);
      }
    }

    // Delete the job record
    await this.supabase.deleteJob(jobId);
    this.logger.log(`Deleted face swap job: ${jobId}`);
  }
}
