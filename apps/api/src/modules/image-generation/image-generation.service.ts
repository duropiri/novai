import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JobsService } from '../jobs/jobs.service';
import { SupabaseService } from '../files/supabase.service';
import { QUEUES } from '../jobs/queues.constants';

export interface CreateImageGenerationDto {
  loraId: string;
  prompt?: string; // Optional when using source image
  sourceImageUrl?: string; // Optional source image for img2img
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:5' | '3:4';
  numImages: number;
  loraStrength: number;
  imageStrength?: number; // How much to preserve source image (0-1)
}

export interface ImageGenerationResult {
  jobId: string;
  loraId: string;
  estimatedCostCents: number;
  mode: 'text-to-image' | 'image-to-image';
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
    // Validate: need either prompt or source image
    if (!dto.prompt?.trim() && !dto.sourceImageUrl) {
      throw new Error('Either a prompt or source image is required');
    }

    // Get LoRA model details
    const lora = await this.supabase.getLoraModel(dto.loraId);
    if (!lora) {
      throw new Error('LoRA model not found');
    }

    if (lora.status !== 'ready' || !lora.weights_url) {
      throw new Error('LoRA model is not ready');
    }

    const mode = dto.sourceImageUrl ? 'image-to-image' : 'text-to-image';

    // Calculate estimated cost: ~$0.03 per image for FLUX LoRA
    // img2img is same price as txt2img
    const estimatedCostCents = Math.ceil(dto.numImages * 3);

    this.logger.log(`Creating image generation job`, {
      loraId: dto.loraId,
      mode,
      prompt: dto.prompt?.substring(0, 50),
      sourceImageUrl: dto.sourceImageUrl ? 'provided' : 'none',
      aspectRatio: dto.aspectRatio,
      numImages: dto.numImages,
      loraStrength: dto.loraStrength,
      imageStrength: dto.imageStrength,
      estimatedCostCents,
    });

    // Create job record
    const job = await this.jobsService.createJob('image_generation', dto.loraId, {
      loraId: dto.loraId,
      loraWeightsUrl: lora.weights_url,
      loraTriggerWord: lora.trigger_word,
      prompt: dto.prompt,
      sourceImageUrl: dto.sourceImageUrl,
      aspectRatio: dto.aspectRatio,
      numImages: dto.numImages,
      loraStrength: dto.loraStrength,
      imageStrength: dto.imageStrength,
      mode,
    });

    // Queue the image generation job
    await this.imageGenQueue.add('generate', {
      jobId: job.id,
      loraId: dto.loraId,
      loraWeightsUrl: lora.weights_url,
      loraTriggerWord: lora.trigger_word,
      prompt: dto.prompt,
      sourceImageUrl: dto.sourceImageUrl,
      aspectRatio: dto.aspectRatio,
      numImages: dto.numImages,
      loraStrength: dto.loraStrength,
      imageStrength: dto.imageStrength,
      mode,
    });

    this.logger.log(`Image generation job queued: ${job.id}`);

    return {
      jobId: job.id,
      loraId: dto.loraId,
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
}
