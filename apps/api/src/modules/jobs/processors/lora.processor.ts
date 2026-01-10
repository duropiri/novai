import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queues.constants';
import { JobsService } from '../jobs.service';
import { FalService, FalQueueStatus } from '../../../services/fal.service';
import { SupabaseService } from '../../files/supabase.service';

interface LoraJobData {
  jobId: string;
  loraModelId: string;
  imagesZipUrl: string;
  triggerWord: string;
  steps?: number;
}

@Processor(QUEUES.LORA_TRAINING)
export class LoraProcessor extends WorkerHost {
  private readonly logger = new Logger(LoraProcessor.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly falService: FalService,
    private readonly supabase: SupabaseService,
  ) {
    super();
  }

  async process(job: Job<LoraJobData>): Promise<void> {
    const { jobId, loraModelId, imagesZipUrl, triggerWord, steps = 1000 } = job.data;

    try {
      await this.jobsService.markJobProcessing(jobId);
      await this.supabase.updateLoraModel(loraModelId, { status: 'training' });

      this.logger.log(`Starting LoRA training job ${jobId}`, {
        loraModelId,
        imagesZipUrl,
        triggerWord,
        steps,
      });

      // Submit training job to fal.ai
      const { request_id } = await this.falService.submitLoraTraining({
        images_data_url: imagesZipUrl,
        trigger_word: triggerWord,
        steps: steps,
        is_style: false, // Character mode for face training
        create_masks: true, // Auto-segment faces
      });

      this.logger.log(`LoRA training submitted to fal.ai with request_id: ${request_id}`);

      // Update job with external request ID
      await this.supabase.updateJob(jobId, {
        external_request_id: request_id,
        external_status: 'IN_QUEUE',
      });

      // Poll for completion
      const result = await this.falService.pollLoraTraining(request_id, {
        intervalMs: 15000, // Check every 15 seconds
        maxAttempts: 120, // Max 30 minutes
        onProgress: async (status: FalQueueStatus) => {
          this.logger.debug(`LoRA training status: ${status.status}`);

          // Update job status
          await this.supabase.updateJob(jobId, {
            external_status: status.status,
            progress: this.calculateProgress(status.status),
          });

          // Log any messages from fal.ai
          if (status.logs?.length) {
            const latestLog = status.logs[status.logs.length - 1];
            this.logger.debug(`fal.ai: ${latestLog.message}`);
          }
        },
      });

      this.logger.log(`LoRA training completed for ${loraModelId}`);

      // Log file info
      const weightsSize = result.diffusers_lora_file.file_size;
      this.logger.log(`Weights file size: ${(weightsSize / 1024 / 1024).toFixed(2)} MB`);

      // Store fal.ai URLs directly (no re-upload needed)
      // fal.ai URLs are persistent and don't expire quickly
      const weightsUrl = result.diffusers_lora_file.url;
      const configUrl = result.config_file.url;

      this.logger.log(`Storing fal.ai URLs directly`);

      // Update LoRA model with results
      await this.supabase.updateLoraModel(loraModelId, {
        status: 'ready',
        weights_url: weightsUrl,
        config_url: configUrl,
        cost_cents: 200, // $2.00 for fal.ai training
        completed_at: new Date().toISOString(),
      });

      // Mark job as completed
      await this.jobsService.markJobCompleted(
        jobId,
        {
          weightsUrl,
          configUrl,
          fileSize: result.diffusers_lora_file.file_size,
        },
        200, // $2.00 cost
      );

      this.logger.log(`LoRA training job ${jobId} completed successfully`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed LoRA training job ${jobId}: ${errorMessage}`);

      // Update LoRA model status
      await this.supabase.updateLoraModel(loraModelId, {
        status: 'failed',
        error_message: errorMessage,
        completed_at: new Date().toISOString(),
      });

      // Mark job as failed
      await this.jobsService.markJobFailed(jobId, errorMessage);
      throw error;
    }
  }

  private calculateProgress(status: string): number {
    switch (status) {
      case 'IN_QUEUE':
        return 10;
      case 'IN_PROGRESS':
        return 50;
      case 'COMPLETED':
        return 100;
      default:
        return 0;
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
