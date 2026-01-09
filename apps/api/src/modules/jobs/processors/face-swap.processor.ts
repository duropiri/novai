import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queues.constants';
import { JobsService } from '../jobs.service';
import { PicsiService } from '../../../services/picsi.service';
import { SupabaseService } from '../../files/supabase.service';

interface FaceSwapJobData {
  jobId: string;
  videoId: string;
  videoUrl: string;
  faceImageUrl: string;
  characterDiagramId: string;
  durationSeconds?: number;
}

@Processor(QUEUES.FACE_SWAP)
export class FaceSwapProcessor extends WorkerHost {
  private readonly logger = new Logger(FaceSwapProcessor.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly picsiService: PicsiService,
    private readonly supabase: SupabaseService,
  ) {
    super();
  }

  async process(job: Job<FaceSwapJobData>): Promise<void> {
    const { jobId, videoId, videoUrl, faceImageUrl, characterDiagramId, durationSeconds = 10 } =
      job.data;

    try {
      await this.jobsService.markJobProcessing(jobId);

      this.logger.log(`Processing face swap job ${jobId}`, {
        videoUrl,
        faceImageUrl,
        characterDiagramId,
      });

      // Submit to Picsi.ai
      const picsiJob = await this.picsiService.submitVideoFaceSwap({
        source_video_url: videoUrl,
        face_image_url: faceImageUrl,
        model: 'inswapper_dax', // High quality model
      });

      // Update job with external request ID
      await this.supabase.updateJob(jobId, {
        external_request_id: picsiJob.job_id,
        external_status: picsiJob.status,
      });

      this.logger.log(`Face swap submitted to Picsi.ai with job_id: ${picsiJob.job_id}`);

      // Poll for completion with progress updates
      const result = await this.picsiService.pollForCompletion(picsiJob.job_id, {
        intervalMs: 5000,
        maxAttempts: 360, // Up to 30 minutes
        onProgress: async (status) => {
          if (status.progress !== undefined) {
            await this.supabase.updateJob(jobId, {
              progress: status.progress,
              external_status: status.status,
            });
          }
        },
      });

      if (!result.result_url) {
        throw new Error('Face swap completed but no result URL provided');
      }

      this.logger.log(`Face swap completed for job ${jobId}`, {
        resultUrl: result.result_url,
        creditsUsed: result.credits_used,
      });

      // Download the result video
      const videoBuffer = await this.downloadFile(result.result_url);

      // Upload to Supabase storage
      const filePath = `${videoId}/swapped_${Date.now()}.mp4`;
      const { url: outputUrl } = await this.supabase.uploadFile(
        'processed-videos',
        filePath,
        videoBuffer,
        'video/mp4',
      );

      // Create a new video record for the swapped video
      const swappedVideo = await this.supabase.createVideo({
        name: `Face Swapped - ${new Date().toLocaleString()}`,
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

      // Calculate cost: 2 credits per second of video
      const costCents = Math.ceil(durationSeconds * 2);

      // Mark job as completed
      await this.jobsService.markJobCompleted(
        jobId,
        {
          outputVideoId: swappedVideo.id,
          outputUrl,
          creditsUsed: result.credits_used,
          processingTime: result.processing_time_seconds,
        },
        costCents,
      );

      this.logger.log(`Face swap job ${jobId} completed successfully`, {
        swappedVideoId: swappedVideo.id,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed face swap job ${jobId}: ${errorMessage}`);
      await this.jobsService.markJobFailed(jobId, errorMessage);
      throw error;
    }
  }

  private async downloadFile(url: string): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
