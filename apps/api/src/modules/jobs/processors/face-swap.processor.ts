import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queues.constants';
import { JobsService } from '../jobs.service';
import { FalService } from '../../../services/fal.service';
import { SupabaseService } from '../../files/supabase.service';

interface FaceSwapJobData {
  jobId: string;
  videoId: string;
  videoUrl: string;
  faceImageUrl: string;
  characterDiagramId: string;
  loraId?: string;
  durationSeconds?: number;
  // WAN settings
  resolution?: '480p' | '580p' | '720p';
  videoQuality?: 'low' | 'medium' | 'high' | 'maximum';
  useTurbo?: boolean;
  inferenceSteps?: number;
}

// WAN pricing per second by resolution
const WAN_COST_PER_SECOND: Record<string, number> = {
  '480p': 4, // $0.04/second = 4 cents
  '580p': 6, // $0.06/second = 6 cents
  '720p': 8, // $0.08/second = 8 cents
};

@Processor(QUEUES.FACE_SWAP)
export class FaceSwapProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(FaceSwapProcessor.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly falService: FalService,
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
    this.logger.log(`BullMQ Job ID: ${job.id}`);
    this.logger.log(`Job data: ${JSON.stringify(job.data, null, 2)}`);

    const {
      jobId,
      videoId,
      videoUrl,
      faceImageUrl,
      characterDiagramId,
      loraId,
      durationSeconds = 10,
      resolution = '720p',
      videoQuality = 'high',
      useTurbo = true,
      inferenceSteps = 20,
    } = job.data;

    try {
      await this.jobsService.markJobProcessing(jobId);
      await this.supabase.updateJob(jobId, { progress: 10 });

      this.logger.log(`Processing WAN Animate Replace for job ${jobId}`, {
        videoUrl,
        faceImageUrl,
        resolution,
        videoQuality,
        useTurbo,
        inferenceSteps,
      });

      let lastProgress = 10;

      // Run WAN Animate Replace - the ONLY face swap method
      const result = await this.falService.runWanAnimateReplace({
        video_url: videoUrl,
        image_url: faceImageUrl,
        resolution,
        video_quality: videoQuality,
        use_turbo: useTurbo,
        num_inference_steps: inferenceSteps,
        onProgress: async (status) => {
          if (status.status === 'IN_PROGRESS' && lastProgress < 85) {
            lastProgress = Math.min(85, lastProgress + 5);
            await this.supabase.updateJob(jobId, {
              progress: lastProgress,
              external_status: status.status,
            });
          } else if (status.status === 'IN_QUEUE') {
            await this.supabase.updateJob(jobId, {
              external_status: status.status,
              progress: 20,
            });
          }
          if (status.logs?.length) {
            const lastLog = status.logs[status.logs.length - 1];
            this.logger.log(`WAN: ${lastLog.message}`);
          }
        },
      });

      if (!result.video?.url) {
        throw new Error('WAN Animate Replace completed but no result URL provided');
      }

      this.logger.log(`WAN Animate Replace completed for job ${jobId}`, {
        resultUrl: result.video.url,
      });

      await this.supabase.updateJob(jobId, { progress: 90 });

      // Download the result video
      const videoBuffer = await this.downloadBuffer(result.video.url);

      // Upload to Supabase storage
      const filePath = `${videoId}/swapped_${Date.now()}.mp4`;
      const { url: outputUrl } = await this.supabase.uploadFile(
        'processed-videos',
        filePath,
        videoBuffer,
        'video/mp4',
      );

      // Create video record
      const swappedVideo = await this.supabase.createVideo({
        name: `AI Swap - ${new Date().toLocaleString()}`,
        type: 'face_swapped',
        parent_video_id: videoId,
        character_diagram_id: characterDiagramId,
        file_url: outputUrl,
        duration_seconds: durationSeconds,
        collection_id: null,
        thumbnail_url: null,
        width: null,
        height: null,
        file_size_bytes: videoBuffer.length,
      });

      // Calculate cost based on resolution and duration
      const costPerSecond = WAN_COST_PER_SECOND[resolution] || 8;
      const costCents = Math.ceil(durationSeconds * costPerSecond);

      // Mark job completed
      await this.jobsService.markJobCompleted(
        jobId,
        {
          outputVideoId: swappedVideo.id,
          outputUrl,
          loraId,
          characterDiagramId,
          resolution,
        },
        costCents,
      );

      this.logger.log(`Face swap job ${jobId} completed successfully`, {
        swappedVideoId: swappedVideo.id,
        costCents,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed face swap job ${jobId}: ${errorMessage}`);
      await this.jobsService.markJobFailed(jobId, errorMessage);
      throw error;
    }
  }

  private async downloadBuffer(url: string): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
