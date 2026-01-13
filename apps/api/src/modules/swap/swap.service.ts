import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JobsService } from '../jobs/jobs.service';
import { SupabaseService, DbVideo } from '../files/supabase.service';
import { QUEUES } from '../jobs/queues.constants';

export interface CreateFaceSwapDto {
  videoId: string;
  // Target face - at least one required
  uploadedFaceUrl?: string;
  characterDiagramId?: string;
  referenceKitId?: string;
  // LoRA model - REQUIRED for advanced pipeline
  loraId: string;
  // Video generation model
  videoModel: 'kling' | 'luma' | 'sora2pro' | 'wan';
  // Processing options
  keepOriginalOutfit: boolean;
  // Upscaling options
  upscaleMethod: 'real-esrgan' | 'clarity' | 'creative' | 'none';
  upscaleResolution?: '2k' | '4k';
  // Key frame count (5-10)
  keyFrameCount: number;
}

export interface FaceSwapResult {
  jobId: string;
  videoId: string;
  targetFaceSource: string;
  estimatedCostCents: number;
}

// Cost constants (in cents)
const GEMINI_COST = 2; // ~$0.02 for Gemini frame regeneration
const POSE_DETECTION_COST = 1; // ~$0.01 per frame for DWPose

// Video model costs (in cents) - approximate for 5 second video
const VIDEO_MODEL_COSTS: Record<string, number> = {
  kling: 40,  // Kling v2.6 Pro ~$0.40/5s
  luma: 100,  // Luma Dream Machine ~$1.00/5s (premium)
  sora2pro: 100, // Sora 2 Pro ~$1.00/5s (premium)
  wan: 20,    // WAN v2.2 ~$0.20/5s (fast)
};

// Upscaling costs (in cents)
const UPSCALE_COSTS: Record<string, number> = {
  'real-esrgan': 5,  // ~$0.05 fast upscaling
  'clarity': 15,     // ~$0.15 quality upscaling
  'creative': 20,    // ~$0.20 AI-enhanced upscaling
  'none': 0,
};

@Injectable()
export class SwapService {
  private readonly logger = new Logger(SwapService.name);

  constructor(
    @InjectQueue(QUEUES.FACE_SWAP) private faceSwapQueue: Queue,
    private readonly jobsService: JobsService,
    private readonly supabase: SupabaseService,
  ) {}

  async createFaceSwap(dto: CreateFaceSwapDto): Promise<FaceSwapResult> {
    // Validate target face - at least one source required
    if (!dto.uploadedFaceUrl && !dto.characterDiagramId && !dto.referenceKitId) {
      throw new Error('Target face is required (uploadedFaceUrl, characterDiagramId, or referenceKitId)');
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
      // Direct upload
      targetFaceUrl = dto.uploadedFaceUrl;
      targetFaceSource = 'upload';
    } else if (dto.characterDiagramId) {
      // Character diagram
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
      // Reference kit
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

    // Get LoRA model (REQUIRED)
    const lora = await this.supabase.getLoraModel(dto.loraId);
    if (!lora) {
      throw new Error('LoRA model not found');
    }
    if (lora.status !== 'ready' || !lora.weights_url) {
      throw new Error('LoRA model is not ready');
    }

    const durationSeconds = video.duration_seconds || 10;

    // Calculate estimated cost
    const estimatedCostCents = this.calculateCost({
      videoModel: dto.videoModel,
      upscaleMethod: dto.upscaleMethod,
      keyFrameCount: dto.keyFrameCount,
    });

    this.logger.log(`Creating advanced face swap job`, {
      videoId: dto.videoId,
      targetFaceSource,
      loraId: dto.loraId,
      videoModel: dto.videoModel,
      upscaleMethod: dto.upscaleMethod,
      keyFrameCount: dto.keyFrameCount,
      durationSeconds,
      estimatedCostCents,
    });

    // Create job record
    const job = await this.jobsService.createJob('face_swap', dto.videoId, {
      videoId: dto.videoId,
      videoUrl: video.file_url,
      targetFaceUrl,
      targetFaceSource,
      characterDiagramId: dto.characterDiagramId,
      referenceKitId: dto.referenceKitId,
      uploadedFaceUrl: dto.uploadedFaceUrl,
      loraId: dto.loraId,
      loraWeightsUrl: lora.weights_url,
      loraTriggerWord: lora.trigger_word,
      durationSeconds,
      videoModel: dto.videoModel,
      keepOriginalOutfit: dto.keepOriginalOutfit,
      upscaleMethod: dto.upscaleMethod,
      upscaleResolution: dto.upscaleResolution || '2k',
      keyFrameCount: dto.keyFrameCount,
    });

    // Queue the advanced swap job
    await this.faceSwapQueue.add('advanced-swap', {
      jobId: job.id,
      videoId: dto.videoId,
      videoUrl: video.file_url,
      targetFaceUrl,
      targetFaceSource,
      characterDiagramId: dto.characterDiagramId,
      referenceKitId: dto.referenceKitId,
      loraId: dto.loraId,
      loraWeightsUrl: lora.weights_url,
      loraTriggerWord: lora.trigger_word,
      durationSeconds,
      videoModel: dto.videoModel,
      keepOriginalOutfit: dto.keepOriginalOutfit,
      upscaleMethod: dto.upscaleMethod,
      upscaleResolution: dto.upscaleResolution || '2k',
      keyFrameCount: dto.keyFrameCount,
    });

    // Update job status to queued
    await this.jobsService.updateJob(job.id, { status: 'queued' });

    this.logger.log(`Advanced face swap job queued: ${job.id}`);

    return {
      jobId: job.id,
      videoId: dto.videoId,
      targetFaceSource,
      estimatedCostCents,
    };
  }

  private calculateCost(options: {
    videoModel: string;
    upscaleMethod: string;
    keyFrameCount: number;
  }): number {
    let total = GEMINI_COST; // Base Gemini regeneration cost
    total += options.keyFrameCount * POSE_DETECTION_COST; // Pose detection per frame
    total += VIDEO_MODEL_COSTS[options.videoModel] || VIDEO_MODEL_COSTS.kling;
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

    // Get original input payload
    const inputPayload = job.input_payload as {
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
      videoModel?: 'kling' | 'luma' | 'wan';
      keepOriginalOutfit?: boolean;
      upscaleMethod?: 'real-esrgan' | 'clarity' | 'creative' | 'none';
      upscaleResolution?: '2k' | '4k';
      keyFrameCount?: number;
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

    // Re-queue the advanced swap job
    await this.faceSwapQueue.add('advanced-swap', {
      jobId: job.id,
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
      keyFrameCount: inputPayload.keyFrameCount || 5,
    });

    this.logger.log(`Retried advanced face swap job: ${jobId}`);
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
