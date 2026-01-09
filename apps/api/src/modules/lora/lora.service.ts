import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SupabaseService, DbLoraModel } from '../files/supabase.service';
import { JobsService } from '../jobs/jobs.service';
import { QUEUES } from '../jobs/queues.constants';

export interface CreateLoraDto {
  name: string;
  triggerWord: string;
  imagesZipUrl: string;
  steps?: number;
}

export interface UploadLoraDto {
  name: string;
  triggerWord: string;
  weightsBuffer: Buffer;
  weightsFileName: string;
  thumbnailBuffer?: Buffer;
  thumbnailFileName?: string;
}

@Injectable()
export class LoraService {
  private readonly logger = new Logger(LoraService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly jobsService: JobsService,
    @InjectQueue(QUEUES.LORA_TRAINING) private readonly loraQueue: Queue,
  ) {}

  private checkInitialized(): void {
    if (!this.supabase.isInitialized()) {
      throw new Error('Database not configured. Please set up Supabase credentials.');
    }
  }

  async create(dto: CreateLoraDto): Promise<DbLoraModel> {
    this.checkInitialized();
    this.logger.log(`Creating LoRA model: ${dto.name}`);

    // Create the LoRA model record
    const loraModel = await this.supabase.createLoraModel({
      name: dto.name,
      trigger_word: dto.triggerWord,
      training_images_url: dto.imagesZipUrl,
      training_steps: dto.steps || 1000,
      status: 'pending',
      weights_url: null,
      config_url: null,
      thumbnail_url: null,
      cost_cents: null,
      error_message: null,
    });

    // Create a job record for tracking
    const job = await this.jobsService.createJob('lora_training', loraModel.id, {
      imagesZipUrl: dto.imagesZipUrl,
      triggerWord: dto.triggerWord,
      steps: dto.steps || 1000,
    });

    // Queue the training job
    await this.loraQueue.add('train', {
      jobId: job.id,
      loraModelId: loraModel.id,
      imagesZipUrl: dto.imagesZipUrl,
      triggerWord: dto.triggerWord,
      steps: dto.steps || 1000,
    });

    this.logger.log(`LoRA model ${loraModel.id} queued for training`);

    return loraModel;
  }

  async uploadManual(dto: UploadLoraDto): Promise<DbLoraModel> {
    this.checkInitialized();
    this.logger.log(`Uploading manual LoRA model: ${dto.name}`);

    // Generate a UUID for the model
    const modelId = crypto.randomUUID();

    // Upload weights file to Supabase storage
    const weightsPath = `${modelId}/weights.safetensors`;
    const { url: weightsUrl } = await this.supabase.uploadFile(
      'lora-weights',
      weightsPath,
      dto.weightsBuffer,
      'application/octet-stream',
    );

    // Upload thumbnail if provided
    let thumbnailUrl: string | null = null;
    if (dto.thumbnailBuffer && dto.thumbnailFileName) {
      const ext = dto.thumbnailFileName.split('.').pop() || 'jpg';
      const thumbnailPath = `${modelId}/thumbnail.${ext}`;
      const thumbnailResult = await this.supabase.uploadFile(
        'lora-weights',
        thumbnailPath,
        dto.thumbnailBuffer,
        dto.thumbnailFileName.endsWith('.png') ? 'image/png' : 'image/jpeg',
      );
      thumbnailUrl = thumbnailResult.url;
    }

    // Create the LoRA model record with status='ready'
    const loraModel = await this.supabase.createLoraModel({
      name: dto.name,
      trigger_word: dto.triggerWord,
      training_images_url: null, // No training images for manual upload
      training_steps: 0, // Not applicable
      status: 'ready',
      weights_url: weightsUrl,
      config_url: null, // No config for manually uploaded models
      thumbnail_url: thumbnailUrl,
      cost_cents: 0, // No cost for manual upload
      error_message: null,
    });

    this.logger.log(`Manual LoRA model ${loraModel.id} uploaded successfully`);

    return loraModel;
  }

  async findAll(status?: string): Promise<DbLoraModel[]> {
    if (!this.supabase.isInitialized()) {
      return [];
    }
    return this.supabase.listLoraModels(status);
  }

  async findOne(id: string): Promise<DbLoraModel | null> {
    if (!this.supabase.isInitialized()) {
      return null;
    }
    return this.supabase.getLoraModel(id);
  }

  async updateStatus(
    id: string,
    status: DbLoraModel['status'],
    updates?: Partial<DbLoraModel>,
  ): Promise<DbLoraModel> {
    return this.supabase.updateLoraModel(id, {
      status,
      ...updates,
      ...(status === 'ready' || status === 'failed' ? { completed_at: new Date().toISOString() } : {}),
    });
  }

  async delete(id: string): Promise<void> {
    this.checkInitialized();
    const model = await this.supabase.getLoraModel(id);
    if (!model) {
      throw new Error('LoRA model not found');
    }

    // Only allow deletion of completed or failed models
    if (model.status === 'training' || model.status === 'pending') {
      throw new Error('Cannot delete a model that is still training');
    }

    // Delete associated files from storage if they exist
    if (model.weights_url) {
      try {
        const weightsPath = this.extractPathFromUrl(model.weights_url);
        if (weightsPath) {
          await this.supabase.deleteFile('lora-weights', weightsPath);
        }
      } catch (error) {
        this.logger.warn(`Failed to delete weights file: ${error}`);
      }
    }

    // Delete from database (soft delete would be better in production)
    await this.supabase.getClient()
      .from('lora_models')
      .delete()
      .eq('id', id);
  }

  private extractPathFromUrl(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      // Assuming format: /storage/v1/object/public/bucket-name/path
      const bucketIndex = pathParts.indexOf('public');
      if (bucketIndex >= 0 && bucketIndex + 2 < pathParts.length) {
        return pathParts.slice(bucketIndex + 2).join('/');
      }
      return null;
    } catch {
      return null;
    }
  }
}
