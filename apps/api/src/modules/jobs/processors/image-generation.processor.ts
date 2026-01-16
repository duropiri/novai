import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queues.constants';
import { JobsService } from '../jobs.service';
import { FalService } from '../../../services/fal.service';
import { GeminiService } from '../../../services/gemini.service';
import { SupabaseService } from '../../files/supabase.service';

interface ImageGenerationJobData {
  jobId: string;
  // LoRA mode fields
  loraId?: string;
  loraWeightsUrl?: string;
  loraTriggerWord?: string;
  loraStrength?: number;
  loraTrainer?: string; // 'flux-fast' | 'wan-22' | 'manual' | 'imported'
  loraTrainingImagesUrl?: string; // For WAN 2.2 fallback
  // Character Diagram mode fields
  characterDiagramId?: string;
  characterDiagramUrl?: string;
  // Reference Kit mode fields
  referenceKitId?: string;
  anchorFaceUrl?: string;
  referenceUrls?: string[];
  // Expression Board mode fields
  expressionBoardId?: string;
  expressionLabels?: string[];
  // Common fields
  prompt?: string;
  sourceImageUrl?: string;
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:5' | '3:4';
  numImages: number;
  imageStrength?: number;
  mode: 'text-to-image' | 'face-swap' | 'character-diagram-swap' | 'reference-kit-swap' | 'expression-board-swap';
}

@Processor(QUEUES.IMAGE_GENERATION)
export class ImageGenerationProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ImageGenerationProcessor.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly falService: FalService,
    private readonly geminiService: GeminiService,
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
      loraTrainer,
      loraTrainingImagesUrl,
      characterDiagramId,
      characterDiagramUrl,
      referenceKitId,
      anchorFaceUrl,
      referenceUrls,
      expressionBoardId,
      expressionLabels,
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
        referenceKitId,
        expressionBoardId,
        mode,
        prompt: prompt?.substring(0, 50),
        sourceImageUrl: sourceImageUrl ? 'provided' : 'none',
        aspectRatio,
        numImages,
      });

      await this.supabase.updateJob(jobId, { progress: 10 });

      let result: { images: Array<{ url: string; width: number; height: number }> };

      if (mode === 'character-diagram-swap' && characterDiagramUrl && sourceImageUrl) {
        // Character Diagram face swap mode: swap face from diagram into source image
        this.logger.log(`Character Diagram face swap mode: using fal-ai/face-swap`);
        this.logger.log(`Base image (scene): ${sourceImageUrl}`);
        this.logger.log(`Swap image (face): ${characterDiagramUrl}`);

        await this.supabase.updateJob(jobId, { progress: 20 });

        const generatedImages: Array<{ url: string; width: number; height: number }> = [];

        for (let i = 0; i < numImages; i++) {
          this.logger.log(`Face swap ${i + 1}/${numImages} using Character Diagram`);

          const swapResult = await this.falService.runFaceSwap({
            base_image_url: sourceImageUrl,    // The image with the scene/pose to keep
            swap_image_url: characterDiagramUrl, // The face to swap in
          });

          if (swapResult.image) {
            generatedImages.push({
              url: swapResult.image.url,
              width: swapResult.image.width,
              height: swapResult.image.height,
            });
          }

          await this.supabase.updateJob(jobId, {
            progress: 20 + Math.floor((i + 1) / numImages * 70),
            external_status: 'SWAPPING_FACE',
          });
        }

        result = { images: generatedImages };
      } else if (mode === 'reference-kit-swap' && anchorFaceUrl && sourceImageUrl) {
        // Reference Kit face swap mode: swap anchor face into source image
        this.logger.log(`Reference Kit face swap mode: using fal-ai/face-swap with anchor face`);
        this.logger.log(`Base image (scene): ${sourceImageUrl}`);
        this.logger.log(`Swap image (anchor face): ${anchorFaceUrl}`);
        this.logger.log(`Total reference images available: ${referenceUrls?.length || 1}`);

        await this.supabase.updateJob(jobId, { progress: 20 });

        const generatedImages: Array<{ url: string; width: number; height: number }> = [];

        for (let i = 0; i < numImages; i++) {
          this.logger.log(`Face swap ${i + 1}/${numImages} using Reference Kit anchor face`);

          const swapResult = await this.falService.runFaceSwap({
            base_image_url: sourceImageUrl,  // The image with the scene/pose to keep
            swap_image_url: anchorFaceUrl,   // The anchor face from reference kit
          });

          if (swapResult.image) {
            generatedImages.push({
              url: swapResult.image.url,
              width: swapResult.image.width,
              height: swapResult.image.height,
            });
          }

          await this.supabase.updateJob(jobId, {
            progress: 20 + Math.floor((i + 1) / numImages * 70),
            external_status: 'SWAPPING_FACE',
          });
        }

        result = { images: generatedImages };
      } else if (mode === 'reference-kit-swap' && anchorFaceUrl && prompt && !sourceImageUrl) {
        // Reference Kit text-to-image mode: generate with Nano Banana, then face swap with anchor face
        this.logger.log(`Reference Kit text-to-image mode: Nano Banana + face swap with anchor face`);
        this.logger.log(`Prompt: ${prompt.substring(0, 50)}...`);
        this.logger.log(`Anchor face: ${anchorFaceUrl}`);

        // Map aspect ratio for Nano Banana
        const aspectRatioMap: Record<string, '21:9' | '16:9' | '3:2' | '4:3' | '5:4' | '1:1' | '4:5' | '3:4' | '2:3' | '9:16'> = {
          '1:1': '1:1',
          '16:9': '16:9',
          '9:16': '9:16',
          '4:5': '4:5',
          '3:4': '3:4',
        };

        await this.supabase.updateJob(jobId, { progress: 10, external_status: 'GENERATING_BASE' });

        // Step 1: Generate base images with Nano Banana (Direct Gemini API)
        const baseResult = await this.geminiService.runNanoBananaGeneration({
          prompt: prompt,
          num_images: numImages,
          aspect_ratio: aspectRatioMap[aspectRatio || '9:16'] || '9:16',
          onProgress: async (status) => {
            if (status.status === 'IN_PROGRESS') {
              await this.supabase.updateJob(jobId, { progress: 30, external_status: 'GENERATING_BASE' });
            }
          },
        });

        if (!baseResult.images || baseResult.images.length === 0) {
          throw new Error('Nano Banana (Gemini) returned no images');
        }

        this.logger.log(`Generated ${baseResult.images.length} base images with Nano Banana (Gemini)`);
        await this.supabase.updateJob(jobId, { progress: 50, external_status: 'SWAPPING_FACES' });

        // Step 2: Face swap anchor face onto each base image
        const generatedImages: Array<{ url: string; width: number; height: number }> = [];

        for (let i = 0; i < baseResult.images.length; i++) {
          const baseImage = baseResult.images[i];
          this.logger.log(`Face swap ${i + 1}/${baseResult.images.length} using Reference Kit anchor face`);

          try {
            const swapResult = await this.falService.runFaceSwap({
              base_image_url: baseImage.url,
              swap_image_url: anchorFaceUrl,
            });

            if (swapResult.image) {
              generatedImages.push({
                url: swapResult.image.url,
                width: swapResult.image.width,
                height: swapResult.image.height,
              });
            } else {
              this.logger.warn(`Face swap failed for image ${i + 1}, keeping original`);
              generatedImages.push(baseImage);
            }
          } catch (swapError) {
            this.logger.warn(`Face swap error for image ${i + 1}: ${swapError}, keeping original`);
            generatedImages.push(baseImage);
          }

          await this.supabase.updateJob(jobId, {
            progress: 50 + Math.floor((i + 1) / baseResult.images.length * 40),
            external_status: 'SWAPPING_FACES',
          });
        }

        result = { images: generatedImages };
      } else if (mode === 'expression-board-swap' && anchorFaceUrl && sourceImageUrl) {
        // Expression Board face swap mode: swap anchor face into source image
        this.logger.log(`Expression Board face swap mode: using fal-ai/face-swap with anchor face`);
        this.logger.log(`Base image (scene): ${sourceImageUrl}`);
        this.logger.log(`Swap image (anchor face): ${anchorFaceUrl}`);
        this.logger.log(`Available expressions: ${expressionLabels?.join(', ') || 'unknown'}`);

        await this.supabase.updateJob(jobId, { progress: 20 });

        const generatedImages: Array<{ url: string; width: number; height: number }> = [];

        for (let i = 0; i < numImages; i++) {
          this.logger.log(`Face swap ${i + 1}/${numImages} using Expression Board anchor face`);

          const swapResult = await this.falService.runFaceSwap({
            base_image_url: sourceImageUrl,
            swap_image_url: anchorFaceUrl,
          });

          if (swapResult.image) {
            generatedImages.push({
              url: swapResult.image.url,
              width: swapResult.image.width,
              height: swapResult.image.height,
            });
          }

          await this.supabase.updateJob(jobId, {
            progress: 20 + Math.floor((i + 1) / numImages * 70),
            external_status: 'SWAPPING_FACE',
          });
        }

        result = { images: generatedImages };
      } else if (mode === 'expression-board-swap' && anchorFaceUrl && prompt && !sourceImageUrl) {
        // Expression Board text-to-image mode: generate with Nano Banana, then face swap with anchor face
        this.logger.log(`Expression Board text-to-image mode: Nano Banana + face swap with anchor face`);
        this.logger.log(`Prompt: ${prompt.substring(0, 50)}...`);
        this.logger.log(`Anchor face: ${anchorFaceUrl}`);
        this.logger.log(`Available expressions: ${expressionLabels?.join(', ') || 'unknown'}`);

        // Map aspect ratio for Nano Banana
        const aspectRatioMap: Record<string, '21:9' | '16:9' | '3:2' | '4:3' | '5:4' | '1:1' | '4:5' | '3:4' | '2:3' | '9:16'> = {
          '1:1': '1:1',
          '16:9': '16:9',
          '9:16': '9:16',
          '4:5': '4:5',
          '3:4': '3:4',
        };

        await this.supabase.updateJob(jobId, { progress: 10, external_status: 'GENERATING_BASE' });

        // Step 1: Generate base images with Nano Banana
        const baseResult = await this.geminiService.runNanoBananaGeneration({
          prompt: prompt,
          num_images: numImages,
          aspect_ratio: aspectRatioMap[aspectRatio || '9:16'] || '9:16',
          onProgress: async (status) => {
            if (status.status === 'IN_PROGRESS') {
              await this.supabase.updateJob(jobId, { progress: 30, external_status: 'GENERATING_BASE' });
            }
          },
        });

        if (!baseResult.images || baseResult.images.length === 0) {
          throw new Error('Nano Banana (Gemini) returned no images');
        }

        this.logger.log(`Generated ${baseResult.images.length} base images with Nano Banana (Gemini)`);
        await this.supabase.updateJob(jobId, { progress: 50, external_status: 'SWAPPING_FACES' });

        // Step 2: Face swap anchor face onto each base image
        const generatedImages: Array<{ url: string; width: number; height: number }> = [];

        for (let i = 0; i < baseResult.images.length; i++) {
          const baseImage = baseResult.images[i];
          this.logger.log(`Face swap ${i + 1}/${baseResult.images.length} using Expression Board anchor face`);

          try {
            const swapResult = await this.falService.runFaceSwap({
              base_image_url: baseImage.url,
              swap_image_url: anchorFaceUrl,
            });

            if (swapResult.image) {
              generatedImages.push({
                url: swapResult.image.url,
                width: swapResult.image.width,
                height: swapResult.image.height,
              });
            } else {
              this.logger.warn(`Face swap failed for image ${i + 1}, keeping original`);
              generatedImages.push(baseImage);
            }
          } catch (swapError) {
            this.logger.warn(`Face swap error for image ${i + 1}: ${swapError}, keeping original`);
            generatedImages.push(baseImage);
          }

          await this.supabase.updateJob(jobId, {
            progress: 50 + Math.floor((i + 1) / baseResult.images.length * 40),
            external_status: 'SWAPPING_FACES',
          });
        }

        result = { images: generatedImages };
      } else if (mode === 'face-swap' && sourceImageUrl && loraWeightsUrl && loraTriggerWord) {
        // LoRA Face swap mode: generate reference face from LoRA, then swap into source image
        this.logger.log(`LoRA Face swap mode: generating reference face from LoRA, then using fal-ai/face-swap`);

        // Step 1: Generate a reference face portrait from the LoRA using FLUX
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
        this.logger.log(`Reference face generated from LoRA: ${referenceFaceUrl}`);

        await this.supabase.updateJob(jobId, { progress: 50 });

        // Step 2: Use fal-ai/face-swap to swap the generated face into the source image
        this.logger.log(`Swapping face into source image: ${sourceImageUrl}`);

        const generatedImages: Array<{ url: string; width: number; height: number }> = [];

        for (let i = 0; i < numImages; i++) {
          this.logger.log(`Face swap ${i + 1}/${numImages}`);

          const swapResult = await this.falService.runFaceSwap({
            base_image_url: sourceImageUrl,    // The image with the scene/pose to keep
            swap_image_url: referenceFaceUrl,  // The LoRA-generated face to swap in
          });

          if (swapResult.image) {
            generatedImages.push({
              url: swapResult.image.url,
              width: swapResult.image.width,
              height: swapResult.image.height,
            });
          }

          await this.supabase.updateJob(jobId, {
            progress: 50 + Math.floor((i + 1) / numImages * 40),
            external_status: 'SWAPPING_FACE',
          });
        }

        result = { images: generatedImages };
      } else if (mode === 'text-to-image' && loraTriggerWord) {
        // Text-to-image mode: Generate with Nano Banana + Face Swap
        // This approach works with ANY LoRA trainer (WAN 2.2, FLUX, etc.)
        if (!prompt) {
          throw new Error('Prompt is required for text-to-image mode');
        }

        this.logger.log(`Text-to-image mode using Nano Banana + Face Swap`);
        this.logger.log(`Trigger word: ${loraTriggerWord}, Prompt: ${prompt.substring(0, 50)}...`);

        // Map aspect ratio for Nano Banana
        const aspectRatioMap: Record<string, '21:9' | '16:9' | '3:2' | '4:3' | '5:4' | '1:1' | '4:5' | '3:4' | '2:3' | '9:16'> = {
          '1:1': '1:1',
          '16:9': '16:9',
          '9:16': '9:16',
          '4:5': '4:5',
          '3:4': '3:4',
        };

        await this.supabase.updateJob(jobId, { progress: 10, external_status: 'GENERATING_BASE' });

        // Step 1: Generate base images with Nano Banana (Direct Gemini API, no LoRA support)
        const baseResult = await this.geminiService.runNanoBananaGeneration({
          prompt: prompt,
          num_images: numImages,
          aspect_ratio: aspectRatioMap[aspectRatio || '9:16'] || '9:16',
          onProgress: async (status) => {
            if (status.status === 'IN_PROGRESS') {
              await this.supabase.updateJob(jobId, { progress: 30, external_status: 'GENERATING_BASE' });
            }
          },
        });

        if (!baseResult.images || baseResult.images.length === 0) {
          throw new Error('Nano Banana (Gemini) returned no images');
        }

        this.logger.log(`Generated ${baseResult.images.length} base images with Nano Banana (Gemini)`);
        await this.supabase.updateJob(jobId, { progress: 50, external_status: 'GENERATING_REFERENCE' });

        // Step 2: Try to get a reference face for face swap (optional)
        let referenceFaceUrl: string | null = null;

        if (characterDiagramUrl) {
          // If we have a character diagram, use it as the reference face
          referenceFaceUrl = characterDiagramUrl;
          this.logger.log(`Using character diagram as reference face: ${referenceFaceUrl}`);
        } else if (anchorFaceUrl) {
          // If we have a reference kit anchor face, use it
          referenceFaceUrl = anchorFaceUrl;
          this.logger.log(`Using reference kit anchor face: ${referenceFaceUrl}`);
        } else if (loraWeightsUrl) {
          // Generate reference face from LoRA using FLUX (can process safetensor files)
          this.logger.log(`Generating reference face from LoRA using FLUX`);
          const facePrompt = `${loraTriggerWord} portrait photo, face closeup, looking at camera, neutral expression, plain background, high quality`;
          const faceResult = await this.falService.runFluxLoraGeneration({
            prompt: facePrompt,
            lora_url: loraWeightsUrl,
            lora_scale: loraStrength ?? 0.8,
            image_size: { width: 512, height: 512 },
            num_images: 1,
          });

          if (faceResult.images && faceResult.images.length > 0) {
            referenceFaceUrl = faceResult.images[0].url;
            this.logger.log(`Generated reference face from LoRA with FLUX: ${referenceFaceUrl}`);
          } else {
            this.logger.warn('Failed to generate reference face from LoRA, will skip face swap');
          }
        } else {
          // No face reference available and no LoRA - skip face swap
          this.logger.warn('No face reference available and no LoRA weights, will skip face swap');
        }

        // Step 3: Apply face swap if we have a reference, otherwise use base images
        const generatedImages: Array<{ url: string; width: number; height: number }> = [];

        if (referenceFaceUrl) {
          await this.supabase.updateJob(jobId, { progress: 60, external_status: 'SWAPPING_FACES' });

          for (let i = 0; i < baseResult.images.length; i++) {
            const baseImage = baseResult.images[i];
            this.logger.log(`Face swap ${i + 1}/${baseResult.images.length}`);

            try {
              const swapResult = await this.falService.runFaceSwap({
                base_image_url: baseImage.url,
                swap_image_url: referenceFaceUrl,
              });

              if (swapResult.image) {
                generatedImages.push({
                  url: swapResult.image.url,
                  width: swapResult.image.width,
                  height: swapResult.image.height,
                });
              } else {
                // Face swap failed, keep original
                this.logger.warn(`Face swap failed for image ${i + 1}, keeping original`);
                generatedImages.push(baseImage);
              }
            } catch (swapError) {
              this.logger.warn(`Face swap error for image ${i + 1}: ${swapError}, keeping original`);
              generatedImages.push(baseImage);
            }

            await this.supabase.updateJob(jobId, {
              progress: 60 + Math.floor((i + 1) / baseResult.images.length * 30),
              external_status: 'SWAPPING_FACES',
            });
          }
        } else {
          // No face reference - skip face swap, use base images directly
          this.logger.log(`Skipping face swap - no reference available. Returning ${baseResult.images.length} base images.`);
          await this.supabase.updateJob(jobId, { progress: 90, external_status: 'COMPLETING' });
          generatedImages.push(...baseResult.images);
        }

        result = { images: generatedImages };
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
      const storageId = loraId || characterDiagramId || referenceKitId || expressionBoardId || 'unknown';

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
          referenceKitId,
          expressionBoardId,
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
