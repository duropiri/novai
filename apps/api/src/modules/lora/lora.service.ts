import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService, DbLoraModel } from '../files/supabase.service';
import { JobsService } from '../jobs/jobs.service';

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

export interface ImportLoraDto {
  name: string;
  triggerWord: string;
  weightsUrl: string;
  thumbnailUrl?: string;
}

@Injectable()
export class LoraService {
  private readonly logger = new Logger(LoraService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly jobsService: JobsService,
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

    // Create a job record and enqueue it
    // Use createAndEnqueueJob since LoRA processor doesn't need custom job names
    const job = await this.jobsService.createAndEnqueueJob('lora_training', loraModel.id, {
      loraModelId: loraModel.id, // Include this - the processor needs it!
      imagesZipUrl: dto.imagesZipUrl,
      triggerWord: dto.triggerWord,
      steps: dto.steps || 1000,
    });

    this.logger.log(`LoRA model ${loraModel.id} queued for training (job: ${job.id})`);

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

  async update(id: string, updates: { name?: string; trigger_word?: string; thumbnail_url?: string | null }): Promise<DbLoraModel> {
    this.checkInitialized();
    return this.supabase.updateLoraModel(id, updates);
  }

  async updateThumbnail(id: string, thumbnail: { buffer: Buffer; fileName: string }): Promise<DbLoraModel> {
    this.checkInitialized();
    this.logger.log(`Updating thumbnail for LoRA model: ${id}`);

    const model = await this.supabase.getLoraModel(id);
    if (!model) {
      throw new Error('LoRA model not found');
    }

    // Upload thumbnail to Supabase storage
    const ext = thumbnail.fileName.split('.').pop() || 'jpg';
    const thumbnailPath = `${id}/thumbnail.${ext}`;
    const { url: thumbnailUrl } = await this.supabase.uploadFile(
      'lora-weights',
      thumbnailPath,
      thumbnail.buffer,
      thumbnail.fileName.endsWith('.png') ? 'image/png' : 'image/jpeg',
    );

    // Update the model with new thumbnail URL
    return this.supabase.updateLoraModel(id, { thumbnail_url: thumbnailUrl });
  }

  async importFromUrl(dto: ImportLoraDto): Promise<DbLoraModel> {
    this.checkInitialized();
    this.logger.log(`Importing LoRA from URL: ${dto.name}`);

    // Validate URL is accessible (optional HEAD request)
    try {
      const response = await fetch(dto.weightsUrl, { method: 'HEAD' });
      if (!response.ok) {
        throw new Error(`URL not accessible: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('URL not accessible')) {
        throw error;
      }
      // If HEAD fails (some servers don't support it), try anyway
      this.logger.warn(`HEAD request failed, proceeding anyway: ${error}`);
    }

    // Create the LoRA model record with status='ready' (no training needed)
    const loraModel = await this.supabase.createLoraModel({
      name: dto.name,
      trigger_word: dto.triggerWord,
      training_images_url: null, // No training images for imported
      training_steps: 0, // Not applicable
      status: 'ready',
      weights_url: dto.weightsUrl,
      config_url: null, // Imported LoRAs may not have config
      thumbnail_url: dto.thumbnailUrl || null,
      cost_cents: 0, // No cost for imported
      error_message: null,
    });

    this.logger.log(`Imported LoRA model ${loraModel.id} successfully`);

    return loraModel;
  }

  /**
   * Force delete a stuck LoRA model (training/pending status)
   */
  async forceDelete(id: string): Promise<void> {
    this.checkInitialized();
    const model = await this.supabase.getLoraModel(id);
    if (!model) {
      throw new Error('LoRA model not found');
    }

    this.logger.log(`Force deleting LoRA model ${id} (status: ${model.status})`);

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

    // Delete from database
    await this.supabase.getClient()
      .from('lora_models')
      .delete()
      .eq('id', id);

    this.logger.log(`Force deleted LoRA model ${id}`);
  }

  /**
   * Clean up all stuck LoRA models (training/pending for too long)
   */
  async cleanupStuck(maxAgeMinutes = 60): Promise<{ deleted: number; ids: string[] }> {
    this.checkInitialized();

    // Get all stuck models
    const stuckModels = await this.supabase.getClient()
      .from('lora_models')
      .select('id, name, status, created_at')
      .in('status', ['training', 'pending']);

    if (stuckModels.error) {
      throw new Error(`Failed to query stuck models: ${stuckModels.error.message}`);
    }

    const cutoffTime = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
    const modelsToDelete = (stuckModels.data || []).filter((m) => {
      const createdAt = new Date(m.created_at);
      return createdAt < cutoffTime;
    });

    this.logger.log(`Found ${modelsToDelete.length} stuck LoRA models to clean up`);

    const deletedIds: string[] = [];
    for (const model of modelsToDelete) {
      try {
        await this.forceDelete(model.id);
        deletedIds.push(model.id);
      } catch (error) {
        this.logger.error(`Failed to delete stuck model ${model.id}: ${error}`);
      }
    }

    return { deleted: deletedIds.length, ids: deletedIds };
  }

  async delete(id: string): Promise<void> {
    this.checkInitialized();
    const model = await this.supabase.getLoraModel(id);
    if (!model) {
      throw new Error('LoRA model not found');
    }

    // Only allow deletion of completed or failed models
    if (model.status === 'training' || model.status === 'pending') {
      throw new Error('Cannot delete a model that is still training. Use force delete instead.');
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
