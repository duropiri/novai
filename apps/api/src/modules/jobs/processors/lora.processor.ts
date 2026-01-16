import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queues.constants';
import { JobsService } from '../jobs.service';
import { FalService } from '../../../services/fal.service';
import { SupabaseService } from '../../files/supabase.service';

interface LoraJobData {
  jobId: string;
  loraModelId: string;
  imagesZipUrl: string;
  triggerWord: string;
  steps?: number;
  // WAN 2.2 trainer options
  learningRate?: number;
  isStyle?: boolean;
  useFaceDetection?: boolean;
  useFaceCropping?: boolean;
  useMasks?: boolean;
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
    // Log raw job data for debugging
    this.logger.log(`=== LORA PROCESSOR START (WAN 2.2) ===`);
    this.logger.log(`Job ID: ${job.id}, Job Name: ${job.name}`);
    this.logger.log(`Raw job.data: ${JSON.stringify(job.data, null, 2)}`);

    const {
      jobId,
      loraModelId,
      imagesZipUrl,
      triggerWord,
      steps = 1000,
      learningRate = 0.0007,
      isStyle = false,
      useFaceDetection = true,
      useFaceCropping = false,
      useMasks = true,
    } = job.data;

    // CRITICAL: Validate loraModelId exists - this was missing in old jobs
    if (!loraModelId) {
      const errorMsg = `FATAL: loraModelId is undefined in job data. This job was likely created before the fix. Job data: ${JSON.stringify(job.data)}`;
      this.logger.error(errorMsg);

      // Try to mark the job as failed if we have jobId
      if (jobId) {
        await this.jobsService.markJobFailed(jobId, 'loraModelId missing from job data - job created with old code');
      }
      throw new Error(errorMsg);
    }

    this.logger.log(`Validated: loraModelId=${loraModelId}, jobId=${jobId}`);

    try {
      await this.jobsService.markJobProcessing(jobId);
      await this.supabase.updateLoraModel(loraModelId, {
        status: 'training',
        trainer: 'wan-22',
        learning_rate: learningRate,
        is_style: isStyle,
        progress: 0,
      });

      this.logger.log(`Starting WAN 2.2 LoRA training job ${jobId}`, {
        loraModelId,
        imagesZipUrl,
        triggerWord,
        steps,
        learningRate,
        isStyle,
      });

      // Run WAN 2.2 training (uses fal.subscribe which handles polling automatically)
      const result = await this.falService.runWan22Training(
        {
          training_data_url: imagesZipUrl,
          trigger_phrase: triggerWord,
          steps,
          learning_rate: learningRate,
          is_style: isStyle,
          use_face_detection: useFaceDetection,
          use_face_cropping: useFaceCropping,
          use_masks: useMasks,
        },
        {
          onQueueUpdate: async (update) => {
            this.logger.debug(`WAN 2.2 training status: ${update.status}`);

            try {
              // Get latest log message for status
              const lastLog = update.logs?.[update.logs.length - 1]?.message || '';

              // Update job and model status
              await this.supabase.updateJob(jobId, {
                external_status: update.status,
              });

              await this.supabase.updateLoraModel(loraModelId, {
                status_message: lastLog || update.status,
              });
            } catch (err) {
              // Don't crash on transient network errors during status updates
              this.logger.warn(`Failed to update status (non-fatal): ${err instanceof Error ? err.message : err}`);
            }
          },
          onProgress: async (progress) => {
            this.logger.debug(`WAN 2.2 training progress: ${progress}%`);

            try {
              // Update progress
              await job.updateProgress(progress);
              await this.supabase.updateJob(jobId, { progress });
              await this.supabase.updateLoraModel(loraModelId, { progress });
            } catch (err) {
              // Don't crash on transient network errors during progress updates
              this.logger.warn(`Failed to update progress (non-fatal): ${err instanceof Error ? err.message : err}`);
            }
          },
        },
      );

      this.logger.log(`=== WAN 2.2 LORA TRAINING COMPLETED ===`);
      this.logger.log(`loraModelId at completion: ${loraModelId}`);
      this.logger.log(`Full result: ${JSON.stringify(result, null, 2)}`);

      // Extract URLs - HIGH NOISE LoRA is the PRIMARY for inference
      const loraUrl = result.high_noise_lora.url; // PRIMARY - use this for generation
      const diffusersLoraUrl = result.diffusers_lora_file?.url || null; // Reference only
      const configUrl = result.config_file?.url || null; // Reference only
      const fileSize = result.high_noise_lora.file_size || 0;

      this.logger.log(`[LoRA] PRIMARY LoRA (high_noise): ${loraUrl}`);
      this.logger.log(`[LoRA] Diffusers LoRA (reference): ${diffusersLoraUrl}`);
      this.logger.log(`[LoRA] Config (reference): ${configUrl}`);
      this.logger.log(`[LoRA] File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

      // Final validation before database update
      if (!loraModelId || loraModelId === 'undefined') {
        throw new Error(`loraModelId became invalid after training: ${loraModelId}`);
      }

      this.logger.log(`About to update LoRA model with ID: "${loraModelId}"`);

      // Update LoRA model with results
      // IMPORTANT: lora_url is the PRIMARY field used for inference
      await this.supabase.updateLoraModel(loraModelId, {
        status: 'ready',
        // PRIMARY: High noise LoRA - this is what we use for image/video generation
        lora_url: loraUrl,
        // BACKWARD COMPATIBILITY: Also set weights_url
        weights_url: loraUrl,
        // REFERENCE ONLY: Store links but don't use for inference
        diffusers_lora_url: diffusersLoraUrl,
        config_url: configUrl,
        // Training metadata
        progress: 100,
        status_message: 'Training completed successfully',
        cost_cents: 200, // $2.00 for fal.ai WAN 2.2 training
        completed_at: new Date().toISOString(),
      });

      // Mark job as completed
      await this.jobsService.markJobCompleted(
        jobId,
        {
          loraUrl, // Primary
          diffusersLoraUrl, // Reference
          configUrl, // Reference
          fileSize,
        },
        200, // $2.00 cost
      );

      this.logger.log(`LoRA training job ${jobId} completed successfully`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`=== WAN 2.2 LORA TRAINING FAILED ===`);
      this.logger.error(`Failed LoRA training job ${jobId}: ${errorMessage}`);
      this.logger.error(`loraModelId at error: ${loraModelId}, type: ${typeof loraModelId}`);

      // Only update LoRA model if we have a valid ID
      if (loraModelId && loraModelId !== 'undefined') {
        await this.supabase.updateLoraModel(loraModelId, {
          status: 'failed',
          error_message: errorMessage,
          status_message: `Training failed: ${errorMessage}`,
          completed_at: new Date().toISOString(),
        });
      } else {
        this.logger.error(`Cannot update LoRA model - loraModelId is invalid: ${loraModelId}`);
      }

      // Mark job as failed
      if (jobId) {
        await this.jobsService.markJobFailed(jobId, errorMessage);
      }
      throw error;
    }
  }
}
