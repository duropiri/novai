import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JobsService } from '../jobs/jobs.service';
import { SupabaseService, DbVideo } from '../files/supabase.service';
import { QUEUES } from '../jobs/queues.constants';

export interface CreateFaceSwapDto {
  videoId: string;
  characterDiagramId: string;
  loraId?: string; // Optional - identity comes from character diagram
  // Swap method selection
  swapMethod: 'kling' | 'wan_replace';
  // WAN Animate Replace settings (only used for wan_replace)
  resolution?: '480p' | '580p' | '720p';
  videoQuality?: 'low' | 'medium' | 'high' | 'maximum';
  useTurbo?: boolean;
  inferenceSteps?: number;
}

export interface FaceSwapResult {
  jobId: string;
  videoId: string;
  characterDiagramId: string;
  estimatedCostCents: number;
}

// WAN pricing per second by resolution (in cents)
const WAN_COST_PER_SECOND: Record<string, number> = {
  '480p': 4, // $0.04/second
  '580p': 6, // $0.06/second
  '720p': 8, // $0.08/second
};

// Kling method pricing (flat rate)
const KLING_BASE_COST = 40; // $0.40 flat rate for face swap + motion

@Injectable()
export class SwapService {
  private readonly logger = new Logger(SwapService.name);

  constructor(
    @InjectQueue(QUEUES.FACE_SWAP) private faceSwapQueue: Queue,
    private readonly jobsService: JobsService,
    private readonly supabase: SupabaseService,
  ) {}

  async createFaceSwap(dto: CreateFaceSwapDto): Promise<FaceSwapResult> {
    // Get video details
    const video = await this.supabase.getVideo(dto.videoId);
    if (!video) {
      throw new Error('Video not found');
    }

    // Get character diagram details
    const diagram = await this.supabase.getCharacterDiagram(dto.characterDiagramId);
    if (!diagram) {
      throw new Error('Character diagram not found');
    }

    if (diagram.status !== 'ready' || !diagram.file_url) {
      throw new Error('Character diagram is not ready');
    }

    // LoRA is optional - identity comes from character diagram
    let loraData: { weightsUrl?: string; triggerWord?: string } = {};
    if (dto.loraId) {
      const lora = await this.supabase.getLoraModel(dto.loraId);
      if (!lora) {
        throw new Error('LoRA model not found');
      }
      if (lora.status !== 'ready' || !lora.weights_url) {
        throw new Error('LoRA model is not ready');
      }
      loraData = {
        weightsUrl: lora.weights_url,
        triggerWord: lora.trigger_word,
      };
    }

    const durationSeconds = video.duration_seconds || 10;
    const resolution = dto.resolution || '720p';
    const swapMethod = dto.swapMethod;

    // Calculate estimated cost based on swap method
    let estimatedCostCents: number;
    if (swapMethod === 'kling') {
      // Kling: flat rate for face swap + motion control
      estimatedCostCents = KLING_BASE_COST;
    } else {
      // WAN Replace: cost per second based on resolution
      const costPerSecond = WAN_COST_PER_SECOND[resolution] || 8;
      estimatedCostCents = Math.ceil(durationSeconds * costPerSecond);
    }

    this.logger.log(`Creating face swap job`, {
      videoId: dto.videoId,
      characterDiagramId: dto.characterDiagramId,
      loraId: dto.loraId,
      swapMethod,
      resolution,
      durationSeconds,
      estimatedCostCents,
    });

    // Create job record
    const job = await this.jobsService.createJob('face_swap', dto.videoId, {
      videoId: dto.videoId,
      videoUrl: video.file_url,
      characterDiagramId: dto.characterDiagramId,
      faceImageUrl: diagram.file_url,
      loraId: dto.loraId,
      loraWeightsUrl: loraData.weightsUrl,
      loraTriggerWord: loraData.triggerWord,
      durationSeconds,
      swapMethod,
      resolution,
      videoQuality: dto.videoQuality,
      useTurbo: dto.useTurbo,
      inferenceSteps: dto.inferenceSteps,
    });

    // Queue the face swap job with appropriate job name
    const jobName = swapMethod === 'kling' ? 'kling-motion' : 'wan-replace';
    await this.faceSwapQueue.add(jobName, {
      jobId: job.id,
      videoId: dto.videoId,
      videoUrl: video.file_url,
      faceImageUrl: diagram.file_url,
      characterDiagramId: dto.characterDiagramId,
      loraId: dto.loraId,
      loraWeightsUrl: loraData.weightsUrl,
      loraTriggerWord: loraData.triggerWord,
      durationSeconds,
      swapMethod,
      resolution,
      videoQuality: dto.videoQuality,
      useTurbo: dto.useTurbo,
      inferenceSteps: dto.inferenceSteps,
    });

    // Update job status to queued
    await this.jobsService.updateJob(job.id, { status: 'queued' });

    this.logger.log(`Face swap job queued: ${job.id}`);

    return {
      jobId: job.id,
      videoId: dto.videoId,
      characterDiagramId: dto.characterDiagramId,
      estimatedCostCents,
    };
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
      characterDiagramId?: string;
      faceImageUrl?: string;
      loraId?: string;
      loraWeightsUrl?: string;
      loraTriggerWord?: string;
      durationSeconds?: number;
      swapMethod?: 'kling' | 'wan_replace';
      resolution?: '480p' | '580p' | '720p';
      videoQuality?: 'low' | 'medium' | 'high' | 'maximum';
      useTurbo?: boolean;
      inferenceSteps?: number;
    } | null;

    if (!inputPayload?.videoUrl || !inputPayload?.faceImageUrl) {
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

    // Re-queue the job with original parameters
    const jobName = inputPayload.swapMethod === 'kling' ? 'kling-motion' : 'wan-replace';
    await this.faceSwapQueue.add(jobName, {
      jobId: job.id,
      videoId: inputPayload.videoId,
      videoUrl: inputPayload.videoUrl,
      faceImageUrl: inputPayload.faceImageUrl,
      characterDiagramId: inputPayload.characterDiagramId,
      loraId: inputPayload.loraId,
      loraWeightsUrl: inputPayload.loraWeightsUrl,
      loraTriggerWord: inputPayload.loraTriggerWord,
      durationSeconds: inputPayload.durationSeconds,
      swapMethod: inputPayload.swapMethod,
      resolution: inputPayload.resolution,
      videoQuality: inputPayload.videoQuality,
      useTurbo: inputPayload.useTurbo,
      inferenceSteps: inputPayload.inferenceSteps,
    });

    this.logger.log(`Retried face swap job: ${jobId}`);
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
        // Delete the video record (this will also clean up the file via cascade or manually)
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
