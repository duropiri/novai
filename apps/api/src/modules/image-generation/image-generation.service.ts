import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JobsService } from '../jobs/jobs.service';
import { SupabaseService } from '../files/supabase.service';
import { QUEUES } from '../jobs/queues.constants';

export interface CreateImageGenerationDto {
  loraId?: string;
  characterDiagramId?: string;
  referenceKitId?: string;
  expressionBoardId?: string;
  prompt?: string;
  sourceImageUrl?: string;
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:5' | '3:4';
  numImages: number;
  loraStrength?: number;
  imageStrength?: number;
}

export interface ImageGenerationResult {
  jobId: string;
  loraId?: string;
  characterDiagramId?: string;
  referenceKitId?: string;
  expressionBoardId?: string;
  estimatedCostCents: number;
  mode: 'text-to-image' | 'face-swap' | 'character-diagram-swap' | 'reference-kit-swap' | 'expression-board-swap';
}

export interface GeneratedImage {
  url: string;
  width: number;
  height: number;
}

@Injectable()
export class ImageGenerationService {
  private readonly logger = new Logger(ImageGenerationService.name);

  constructor(
    @InjectQueue(QUEUES.IMAGE_GENERATION) private imageGenQueue: Queue,
    private readonly jobsService: JobsService,
    private readonly supabase: SupabaseService,
  ) {}

  async createImageGeneration(dto: CreateImageGenerationDto): Promise<ImageGenerationResult> {
    // Determine mode based on identity source
    let mode: 'text-to-image' | 'face-swap' | 'character-diagram-swap' | 'reference-kit-swap' | 'expression-board-swap';
    let referenceId: string;
    let jobPayload: Record<string, unknown>;

    if (dto.expressionBoardId) {
      // Expression Board mode - uses labeled expression images as reference faces
      const board = await this.supabase.getExpressionBoard(dto.expressionBoardId);
      if (!board) {
        throw new Error('Expression Board not found');
      }
      if (board.status !== 'ready' || !board.cell_urls) {
        throw new Error('Expression Board is not ready');
      }

      // Find the best reference face from cell_urls
      // Prefer "Front Neutral" for angles board, or "Neutral" for emotion board
      const cellUrls = board.cell_urls as Record<string, string>;
      const anchorFaceUrl =
        cellUrls['Front Neutral'] ||
        cellUrls['Neutral'] ||
        cellUrls['Happy'] ||
        Object.values(cellUrls)[0];

      if (!anchorFaceUrl) {
        throw new Error('Expression Board has no usable reference images');
      }

      // Collect all cell URLs as reference images
      const referenceUrls = Object.values(cellUrls).filter(Boolean) as string[];

      mode = 'expression-board-swap';
      referenceId = dto.expressionBoardId;
      jobPayload = {
        expressionBoardId: dto.expressionBoardId,
        anchorFaceUrl,
        referenceUrls,
        expressionLabels: Object.keys(cellUrls),
        prompt: dto.prompt,
        sourceImageUrl: dto.sourceImageUrl,
        aspectRatio: dto.aspectRatio,
        numImages: dto.numImages,
        imageStrength: dto.imageStrength,
        mode,
      };
    } else if (dto.referenceKitId) {
      // Reference Kit mode - uses multiple reference images for identity preservation
      const kit = await this.supabase.getReferenceKit(dto.referenceKitId);
      if (!kit) {
        throw new Error('Reference Kit not found');
      }
      if (kit.status !== 'ready' || !kit.anchor_face_url) {
        throw new Error('Reference Kit is not ready (missing anchor face)');
      }

      // Collect all reference URLs
      const referenceUrls = [
        kit.anchor_face_url,
        kit.profile_url,
        kit.half_body_url,
        kit.full_body_url,
        ...Object.values(kit.expressions || {}),
      ].filter(Boolean) as string[];

      mode = 'reference-kit-swap';
      referenceId = dto.referenceKitId;
      jobPayload = {
        referenceKitId: dto.referenceKitId,
        anchorFaceUrl: kit.anchor_face_url,
        referenceUrls,
        prompt: dto.prompt,
        sourceImageUrl: dto.sourceImageUrl,
        aspectRatio: dto.aspectRatio,
        numImages: dto.numImages,
        imageStrength: dto.imageStrength,
        mode,
      };
    } else if (dto.characterDiagramId) {
      // Character Diagram mode - face swap only
      const diagram = await this.supabase.getCharacterDiagram(dto.characterDiagramId);
      if (!diagram) {
        throw new Error('Character Diagram not found');
      }
      if (diagram.status !== 'ready' || !diagram.file_url) {
        throw new Error('Character Diagram is not ready');
      }

      mode = 'character-diagram-swap';
      referenceId = dto.characterDiagramId;
      jobPayload = {
        characterDiagramId: dto.characterDiagramId,
        characterDiagramUrl: diagram.file_url,
        prompt: dto.prompt,
        sourceImageUrl: dto.sourceImageUrl,
        numImages: dto.numImages,
        imageStrength: dto.imageStrength,
        mode,
      };
    } else if (dto.loraId) {
      // LoRA mode - text-to-image or face-swap
      const lora = await this.supabase.getLoraModel(dto.loraId);
      if (!lora) {
        throw new Error('LoRA model not found');
      }
      // Use lora_url (high_noise_lora) as primary, fallback to weights_url for backward compatibility
      const loraUrl = lora.lora_url || lora.weights_url;
      if (lora.status !== 'ready' || !loraUrl) {
        throw new Error('LoRA model is not ready');
      }

      // WAN 2.2 LoRAs work with Nano Banana + face swap approach
      // No special handling needed - processor handles this

      mode = dto.sourceImageUrl ? 'face-swap' : 'text-to-image';
      referenceId = dto.loraId;
      jobPayload = {
        loraId: dto.loraId,
        loraWeightsUrl: loraUrl,
        loraTriggerWord: lora.trigger_word,
        loraTrainer: lora.trainer, // Pass trainer type for processor logic
        loraTrainingImagesUrl: lora.training_images_url, // For WAN 2.2 fallback
        prompt: dto.prompt,
        sourceImageUrl: dto.sourceImageUrl,
        aspectRatio: dto.aspectRatio,
        numImages: dto.numImages,
        loraStrength: dto.loraStrength ?? 0.8,
        imageStrength: dto.imageStrength,
        mode,
      };
    } else {
      throw new Error('LoRA, Character Diagram, or Reference Kit is required');
    }

    // Calculate estimated cost:
    // - Text-to-image: ~$0.03 per image for FLUX LoRA
    // - Face swap with LoRA: ~$0.04 per image (includes generating reference face + swap)
    // - Character Diagram swap: ~$0.04 per image (just face swap, no generation)
    const costPerImage = mode === 'text-to-image' ? 3 : 4;
    const estimatedCostCents = Math.ceil(dto.numImages * costPerImage);

    this.logger.log(`Creating image generation job`, {
      loraId: dto.loraId,
      characterDiagramId: dto.characterDiagramId,
      referenceKitId: dto.referenceKitId,
      mode,
      prompt: dto.prompt?.substring(0, 50),
      sourceImageUrl: dto.sourceImageUrl ? 'provided' : 'none',
      aspectRatio: dto.aspectRatio,
      numImages: dto.numImages,
      estimatedCostCents,
    });

    // Create job record
    const job = await this.jobsService.createJob('image_generation', referenceId, jobPayload);

    // Queue the image generation job
    await this.imageGenQueue.add('generate', {
      jobId: job.id,
      ...jobPayload,
    });

    // Update job status to queued
    await this.jobsService.updateJob(job.id, { status: 'queued' });

    this.logger.log(`Image generation job queued: ${job.id}`);

    return {
      jobId: job.id,
      loraId: dto.loraId,
      characterDiagramId: dto.characterDiagramId,
      referenceKitId: dto.referenceKitId,
      expressionBoardId: dto.expressionBoardId,
      estimatedCostCents,
      mode,
    };
  }

  async getGenerationResults(jobId: string): Promise<GeneratedImage[] | null> {
    const job = await this.supabase.getJob(jobId);
    if (!job || job.status !== 'completed') {
      return null;
    }

    const outputPayload = job.output_payload as { images?: GeneratedImage[] } | null;
    if (!outputPayload?.images) {
      return null;
    }

    return outputPayload.images;
  }

  async listRecentGenerations(limit = 20): Promise<Array<{
    jobId: string;
    status: string;
    prompt?: string;
    sourceImageUrl?: string;
    mode?: string;
    images?: GeneratedImage[];
    createdAt: string;
  }>> {
    const jobs = await this.supabase.listJobs({ type: 'image_generation', limit });

    return jobs.map((job) => {
      const inputPayload = job.input_payload as {
        prompt?: string;
        sourceImageUrl?: string;
        mode?: string;
      } | null;
      const outputPayload = job.output_payload as {
        images?: GeneratedImage[];
        prompt?: string;
      } | null;

      return {
        jobId: job.id,
        status: job.status,
        prompt: outputPayload?.prompt || inputPayload?.prompt,
        sourceImageUrl: inputPayload?.sourceImageUrl,
        mode: inputPayload?.mode,
        images: outputPayload?.images,
        createdAt: job.created_at,
      };
    });
  }

  async deleteGeneration(jobId: string): Promise<void> {
    const job = await this.supabase.getJob(jobId);
    if (!job) {
      throw new Error('Job not found');
    }

    // Delete generated images from storage if they exist
    const outputPayload = job.output_payload as { images?: GeneratedImage[] } | null;
    if (outputPayload?.images) {
      for (const image of outputPayload.images) {
        try {
          // Extract path from URL and delete from storage
          // The URL format is typically: https://xxx.supabase.co/storage/v1/object/public/bucket/path
          const urlParts = image.url.split('/');
          const bucketIndex = urlParts.indexOf('public');
          if (bucketIndex > -1 && bucketIndex + 2 < urlParts.length) {
            const bucket = urlParts[bucketIndex + 1];
            const path = urlParts.slice(bucketIndex + 2).join('/');
            await this.supabase.deleteFile(bucket, path);
          }
        } catch (error) {
          this.logger.warn(`Failed to delete image file: ${error}`);
          // Continue deleting other files even if one fails
        }
      }
    }

    // Delete the job record
    await this.supabase.deleteJob(jobId);
    this.logger.log(`Deleted image generation job: ${jobId}`);
  }
}
