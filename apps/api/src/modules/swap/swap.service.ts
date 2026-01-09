import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JobsService } from '../jobs/jobs.service';
import { SupabaseService, DbVideo, DbCharacterDiagram } from '../files/supabase.service';
import { QUEUES } from '../jobs/queues.constants';

export interface CreateFaceSwapDto {
  videoId: string;
  characterDiagramId: string;
}

export interface FaceSwapResult {
  jobId: string;
  videoId: string;
  characterDiagramId: string;
  estimatedCostCents: number;
}

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

    // Calculate estimated cost (2 credits per second)
    const durationSeconds = video.duration_seconds || 10;
    const estimatedCostCents = Math.ceil(durationSeconds * 2);

    this.logger.log(`Creating face swap job`, {
      videoId: dto.videoId,
      characterDiagramId: dto.characterDiagramId,
      durationSeconds,
      estimatedCostCents,
    });

    // Create job record
    const job = await this.jobsService.createJob('face_swap', dto.videoId, {
      videoId: dto.videoId,
      videoUrl: video.file_url,
      characterDiagramId: dto.characterDiagramId,
      faceImageUrl: diagram.file_url,
      durationSeconds,
    });

    // Queue the face swap job
    await this.faceSwapQueue.add('swap', {
      jobId: job.id,
      videoId: dto.videoId,
      videoUrl: video.file_url,
      faceImageUrl: diagram.file_url,
      characterDiagramId: dto.characterDiagramId,
      durationSeconds,
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
