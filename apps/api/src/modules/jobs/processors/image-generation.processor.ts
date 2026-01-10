import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queues.constants';
import { JobsService } from '../jobs.service';
import { FalService } from '../../../services/fal.service';
import { SupabaseService } from '../../files/supabase.service';

interface ImageGenerationJobData {
  jobId: string;
  loraId: string;
  loraWeightsUrl: string;
  loraTriggerWord: string;
  prompt?: string;
  sourceImageUrl?: string;
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:5' | '3:4';
  numImages: number;
  loraStrength: number;
  imageStrength?: number;
  mode: 'text-to-image' | 'image-to-image';
}

@Processor(QUEUES.IMAGE_GENERATION)
export class ImageGenerationProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ImageGenerationProcessor.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly falService: FalService,
    private readonly supabase: SupabaseService,
  ) {
    super();
  }

  onModuleInit() {
    this.logger.log('=== ImageGenerationProcessor initialized ===');
    this.logger.log(`Queue name: ${QUEUES.IMAGE_GENERATION}`);
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

  async process(job: Job<ImageGenerationJobData>): Promise<void> {
    this.logger.log('=== IMAGE GENERATION JOB STARTED ===');
    this.logger.log(`BullMQ Job ID: ${job.id}`);

    const {
      jobId,
      loraId,
      loraWeightsUrl,
      loraTriggerWord,
      prompt,
      sourceImageUrl,
      aspectRatio,
      numImages,
      loraStrength,
      imageStrength,
      mode,
    } = job.data;

    try {
      await this.jobsService.markJobProcessing(jobId);

      this.logger.log(`Processing image generation job ${jobId}`, {
        loraId,
        mode,
        prompt: prompt?.substring(0, 50),
        sourceImageUrl: sourceImageUrl ? 'provided' : 'none',
        aspectRatio,
        numImages,
        loraStrength,
        imageStrength,
      });

      await this.supabase.updateJob(jobId, { progress: 10 });

      let result: { images: Array<{ url: string; width: number; height: number }> };

      if (mode === 'image-to-image' && sourceImageUrl) {
        // Image-to-image mode: transform source image with LoRA
        // Build prompt with trigger word if provided
        const fullPrompt = prompt
          ? `${loraTriggerWord} ${prompt}`
          : loraTriggerWord;

        result = await this.falService.runFluxLoraImageToImage({
          image_url: sourceImageUrl,
          prompt: fullPrompt,
          lora_url: loraWeightsUrl,
          lora_scale: loraStrength,
          strength: imageStrength ?? 0.85,
          num_images: numImages,
          onProgress: async (status) => {
            if (status.status === 'IN_PROGRESS') {
              await this.supabase.updateJob(jobId, {
                progress: 50,
                external_status: status.status,
              });
            }
          },
        });
      } else {
        // Text-to-image mode: generate from prompt
        if (!prompt) {
          throw new Error('Prompt is required for text-to-image mode');
        }

        const fullPrompt = `${loraTriggerWord} ${prompt}`;

        // Map aspect ratio to image size
        const aspectRatioToSize: Record<string, { width: number; height: number }> = {
          '1:1': { width: 1024, height: 1024 },
          '16:9': { width: 1344, height: 768 },
          '9:16': { width: 768, height: 1344 },
          '4:5': { width: 896, height: 1120 },
          '3:4': { width: 896, height: 1152 },
        };

        result = await this.falService.runFluxLoraGeneration({
          prompt: fullPrompt,
          lora_url: loraWeightsUrl,
          lora_scale: loraStrength,
          image_size: (aspectRatio && aspectRatioToSize[aspectRatio]) ?? { width: 1024, height: 1024 },
          num_images: numImages,
          onProgress: async (status) => {
            if (status.status === 'IN_PROGRESS') {
              await this.supabase.updateJob(jobId, {
                progress: 50,
                external_status: status.status,
              });
            }
          },
        });
      }

      if (!result.images || result.images.length === 0) {
        throw new Error('Image generation completed but no images returned');
      }

      this.logger.log(`Image generation completed for job ${jobId}`, {
        imageCount: result.images.length,
        mode,
      });

      await this.supabase.updateJob(jobId, { progress: 90 });

      // Download and upload images to Supabase storage
      const uploadedImages: Array<{ url: string; width: number; height: number }> = [];

      for (let i = 0; i < result.images.length; i++) {
        const image = result.images[i];
        try {
          const imageBuffer = await this.downloadFile(image.url);
          const filePath = `${loraId}/generated_${Date.now()}_${i}.jpg`;
          const { url } = await this.supabase.uploadFile(
            'character-images',
            filePath,
            imageBuffer,
            'image/jpeg',
          );
          uploadedImages.push({
            url,
            width: image.width,
            height: image.height,
          });
        } catch (error) {
          this.logger.warn(`Failed to upload image ${i}: ${error}`);
          // Still include the original URL if upload fails
          uploadedImages.push({
            url: image.url,
            width: image.width,
            height: image.height,
          });
        }
      }

      // Calculate cost: ~$0.03 per image for FLUX LoRA
      const costCents = Math.ceil(numImages * 3);

      // Build prompt for output
      const fullPrompt = prompt
        ? `${loraTriggerWord} ${prompt}`
        : loraTriggerWord;

      // Mark job as completed
      await this.jobsService.markJobCompleted(
        jobId,
        {
          images: uploadedImages,
          prompt: fullPrompt,
          sourceImageUrl,
          mode,
          loraId,
          aspectRatio,
          numImages,
          loraStrength,
          imageStrength,
        },
        costCents,
      );

      this.logger.log(`Image generation job ${jobId} completed successfully`, {
        imageCount: uploadedImages.length,
        mode,
        costCents,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed image generation job ${jobId}: ${errorMessage}`);
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
