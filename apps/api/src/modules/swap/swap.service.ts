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
  // WAN Animate Replace settings
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

    // Calculate estimated cost based on resolution and duration
    const costPerSecond = WAN_COST_PER_SECOND[resolution] || 8;
    const estimatedCostCents = Math.ceil(durationSeconds * costPerSecond);

    this.logger.log(`Creating face swap job`, {
      videoId: dto.videoId,
      characterDiagramId: dto.characterDiagramId,
      loraId: dto.loraId,
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
      resolution,
      videoQuality: dto.videoQuality,
      useTurbo: dto.useTurbo,
      inferenceSteps: dto.inferenceSteps,
    });

    // Queue the face swap job
    await this.faceSwapQueue.add('swap', {
      jobId: job.id,
      videoId: dto.videoId,
      videoUrl: video.file_url,
      faceImageUrl: diagram.file_url,
      characterDiagramId: dto.characterDiagramId,
      loraId: dto.loraId,
      loraWeightsUrl: loraData.weightsUrl,
      loraTriggerWord: loraData.triggerWord,
      durationSeconds,
      resolution,
      videoQuality: dto.videoQuality,
      useTurbo: dto.useTurbo,
      inferenceSteps: dto.inferenceSteps,
    });

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
}
