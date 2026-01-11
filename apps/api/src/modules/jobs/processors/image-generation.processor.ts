import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queues.constants';
import { JobsService } from '../jobs.service';
import { FalService } from '../../../services/fal.service';
import { SupabaseService } from '../../files/supabase.service';

interface ImageGenerationJobData {
  jobId: string;
  // LoRA mode fields
  loraId?: string;
  loraWeightsUrl?: string;
  loraTriggerWord?: string;
  loraStrength?: number;
  // Character Diagram mode fields
  characterDiagramId?: string;
  characterDiagramUrl?: string;
  // Common fields
  prompt?: string;
  sourceImageUrl?: string;
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:5' | '3:4';
  numImages: number;
  imageStrength?: number;
  mode: 'text-to-image' | 'face-swap' | 'character-diagram-swap';
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
      loraStrength,
      characterDiagramId,
      characterDiagramUrl,
      prompt,
      sourceImageUrl,
      aspectRatio,
      numImages,
      imageStrength,
      mode,
    } = job.data;

    try {
      await this.jobsService.markJobProcessing(jobId);

      this.logger.log(`Processing image generation job ${jobId}`, {
        loraId,
        characterDiagramId,
        mode,
        prompt: prompt?.substring(0, 50),
        sourceImageUrl: sourceImageUrl ? 'provided' : 'none',
        aspectRatio,
        numImages,
      });

      await this.supabase.updateJob(jobId, { progress: 10 });

      let result: { images: Array<{ url: string; width: number; height: number }> };

      if (mode === 'character-diagram-swap' && characterDiagramUrl) {
        // Character Diagram swap mode using Flux PuLID for natural results
        this.logger.log(`Character Diagram swap mode: using Flux PuLID for identity-preserving generation`);

        await this.supabase.updateJob(jobId, { progress: 20 });

        // Use provided prompt or create a default one
        const generationPrompt = prompt || 'portrait photo, high quality, photorealistic, natural lighting';

        // Map aspect ratio to PuLID image size
        const aspectRatioToPulidSize: Record<string, 'square_hd' | 'square' | 'portrait_4_3' | 'portrait_16_9' | 'landscape_4_3' | 'landscape_16_9'> = {
          '1:1': 'square_hd',
          '16:9': 'landscape_16_9',
          '9:16': 'portrait_16_9',
          '4:5': 'portrait_4_3',
          '3:4': 'portrait_4_3',
        };
        const imageSize = (aspectRatio && aspectRatioToPulidSize[aspectRatio]) || 'square_hd';

        const generatedImages: Array<{ url: string; width: number; height: number }> = [];

        for (let i = 0; i < numImages; i++) {
          this.logger.log(`Flux PuLID generation ${i + 1}/${numImages} using Character Diagram`);

          const pulidResult = await this.falService.runFluxPulid({
            prompt: generationPrompt,
            reference_image_url: characterDiagramUrl,
            image_size: imageSize,
            id_weight: 1.0, // Strong identity preservation
            start_step: 0, // Start early for realistic look
            num_inference_steps: 20,
          });

          if (pulidResult.images && pulidResult.images.length > 0) {
            generatedImages.push({
              url: pulidResult.images[0].url,
              width: pulidResult.images[0].width,
              height: pulidResult.images[0].height,
            });
          }

          await this.supabase.updateJob(jobId, {
            progress: 20 + Math.floor((i + 1) / numImages * 70),
            external_status: 'GENERATING_WITH_IDENTITY',
          });
        }

        result = { images: generatedImages };
      } else if (mode === 'face-swap' && sourceImageUrl && loraWeightsUrl && loraTriggerWord) {
        // LoRA Face swap mode: generate reference face from LoRA, then use Flux PuLID
        this.logger.log(`LoRA Face swap mode: generating reference face from LoRA, then using Flux PuLID`);

        // Step 1: Generate a reference face portrait from the LoRA
        const facePrompt = `${loraTriggerWord} portrait photo, face closeup, looking at camera, neutral expression, plain background, high quality`;

        await this.supabase.updateJob(jobId, { progress: 20 });

        const faceResult = await this.falService.runFluxLoraGeneration({
          prompt: facePrompt,
          lora_url: loraWeightsUrl,
          lora_scale: loraStrength ?? 0.8,
          image_size: { width: 512, height: 512 },
          num_images: 1,
          onProgress: async (status) => {
            if (status.status === 'IN_PROGRESS') {
              await this.supabase.updateJob(jobId, {
                progress: 30,
                external_status: 'GENERATING_FACE',
              });
            }
          },
        });

        if (!faceResult.images || faceResult.images.length === 0) {
          throw new Error('Failed to generate reference face from LoRA');
        }

        const referenceFaceUrl = faceResult.images[0].url;
        this.logger.log(`Reference face generated: ${referenceFaceUrl}`);

        await this.supabase.updateJob(jobId, { progress: 50 });

        // Step 2: Use Flux PuLID with the generated face as identity reference
        // Use provided prompt or create a default one describing the scene
        const generationPrompt = prompt || 'portrait photo, high quality, photorealistic, natural lighting';

        // Map aspect ratio to PuLID image size
        const aspectRatioToPulidSize: Record<string, 'square_hd' | 'square' | 'portrait_4_3' | 'portrait_16_9' | 'landscape_4_3' | 'landscape_16_9'> = {
          '1:1': 'square_hd',
          '16:9': 'landscape_16_9',
          '9:16': 'portrait_16_9',
          '4:5': 'portrait_4_3',
          '3:4': 'portrait_4_3',
        };
        const imageSize = (aspectRatio && aspectRatioToPulidSize[aspectRatio]) || 'square_hd';

        const generatedImages: Array<{ url: string; width: number; height: number }> = [];

        for (let i = 0; i < numImages; i++) {
          this.logger.log(`Flux PuLID generation ${i + 1}/${numImages}`);

          const pulidResult = await this.falService.runFluxPulid({
            prompt: generationPrompt,
            reference_image_url: referenceFaceUrl,
            image_size: imageSize,
            id_weight: 1.0,
            start_step: 0,
            num_inference_steps: 20,
          });

          if (pulidResult.images && pulidResult.images.length > 0) {
            generatedImages.push({
              url: pulidResult.images[0].url,
              width: pulidResult.images[0].width,
              height: pulidResult.images[0].height,
            });
          }

          await this.supabase.updateJob(jobId, {
            progress: 50 + Math.floor((i + 1) / numImages * 40),
            external_status: 'GENERATING_WITH_IDENTITY',
          });
        }

        result = { images: generatedImages };
      } else if (mode === 'text-to-image' && loraWeightsUrl && loraTriggerWord) {
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
          lora_scale: loraStrength ?? 0.8,
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
      } else {
        throw new Error(`Invalid mode or missing required data: ${mode}`);
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
      const storageId = loraId || characterDiagramId || 'unknown';

      for (let i = 0; i < result.images.length; i++) {
        const image = result.images[i];
        try {
          const imageBuffer = await this.downloadFile(image.url);
          const filePath = `${storageId}/generated_${Date.now()}_${i}.jpg`;
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

      // Calculate cost: ~$0.03 per image for text-to-image, ~$0.04 for face swap
      const costCents = mode === 'text-to-image' ? Math.ceil(numImages * 3) : Math.ceil(numImages * 4);

      // Build prompt for output
      const fullPrompt = prompt && loraTriggerWord
        ? `${loraTriggerWord} ${prompt}`
        : prompt || loraTriggerWord || '';

      // Mark job as completed
      await this.jobsService.markJobCompleted(
        jobId,
        {
          images: uploadedImages,
          prompt: fullPrompt,
          sourceImageUrl,
          mode,
          loraId,
          characterDiagramId,
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
