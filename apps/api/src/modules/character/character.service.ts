import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SupabaseService, DbCharacterDiagram } from '../files/supabase.service';
import { JobsService } from '../jobs/jobs.service';
import { QUEUES } from '../jobs/queues.constants';

export interface CreateCharacterDiagramDto {
  name?: string;
  sourceImageUrl: string;
}

export interface CreateCharacterDiagramFromLoraDto {
  name?: string;
  loraId: string;
}

export interface UploadCharacterDiagramDto {
  name: string;
  fileUrl: string;
}

export interface UpdateCharacterDiagramDto {
  name?: string;
}

@Injectable()
export class CharacterService {
  private readonly logger = new Logger(CharacterService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly jobsService: JobsService,
    @InjectQueue(QUEUES.CHARACTER_DIAGRAM) private readonly characterQueue: Queue,
  ) {}

  private checkInitialized(): void {
    if (!this.supabase.isInitialized()) {
      throw new Error('Database not configured. Please set up Supabase credentials.');
    }
  }

  async create(dto: CreateCharacterDiagramDto): Promise<DbCharacterDiagram> {
    this.checkInitialized();
    // Generate name if not provided
    const name = dto.name?.trim() || `Character ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    this.logger.log(`Creating character diagram: ${name}`);

    // Create the character diagram record (basic fields only)
    const diagram = await this.supabase.createCharacterDiagram({
      name,
      source_image_url: dto.sourceImageUrl,
      file_url: null,
      status: 'pending',
      error_message: null,
      cost_cents: null,
    });

    // Create a job record for tracking
    const job = await this.jobsService.createJob('character_diagram', diagram.id, {
      sourceImageUrl: dto.sourceImageUrl,
      name,
    });

    // Queue the generation job - photo-based
    await this.characterQueue.add('generate-from-photo', {
      jobId: job.id,
      diagramId: diagram.id,
      sourceImageUrl: dto.sourceImageUrl,
      name,
    });

    this.logger.log(`Character diagram ${diagram.id} queued for generation`);

    return diagram;
  }

  async createFromLora(dto: CreateCharacterDiagramFromLoraDto): Promise<DbCharacterDiagram> {
    this.checkInitialized();

    // Get the LoRA model to use its name if diagram name not provided
    const lora = await this.supabase.getLoraModel(dto.loraId);
    if (!lora) {
      throw new Error('LoRA model not found');
    }

    const name = dto.name?.trim() || `${lora.name} - Character`;

    this.logger.log(`Creating character diagram from LoRA: ${name}`);

    // Create the character diagram record (LoRA reference stored in job metadata)
    const diagram = await this.supabase.createCharacterDiagram({
      name,
      source_image_url: null, // Will be set after reference image generation
      file_url: null,
      status: 'pending',
      error_message: null,
      cost_cents: null,
    });

    // Create a job record for tracking
    const job = await this.jobsService.createJob('character_diagram', diagram.id, {
      loraId: dto.loraId,
      loraName: lora.name,
      triggerWord: lora.trigger_word,
      weightsUrl: lora.weights_url,
      name,
    });

    // Queue the LoRA-based generation job
    await this.characterQueue.add('generate-from-lora', {
      jobId: job.id,
      diagramId: diagram.id,
      loraId: dto.loraId,
      triggerWord: lora.trigger_word,
      weightsUrl: lora.weights_url,
      name,
    });

    this.logger.log(`Character diagram ${diagram.id} queued for LoRA-based generation`);

    return diagram;
  }

  async upload(dto: UploadCharacterDiagramDto): Promise<DbCharacterDiagram> {
    this.checkInitialized();

    this.logger.log(`Uploading character diagram: ${dto.name}`);

    // Create the character diagram record with status ready (no processing needed)
    const diagram = await this.supabase.createCharacterDiagram({
      name: dto.name,
      source_image_url: null,
      file_url: dto.fileUrl,
      status: 'ready',
      error_message: null,
      cost_cents: 0, // No cost for manual upload
    });

    this.logger.log(`Character diagram ${diagram.id} uploaded successfully`);

    return diagram;
  }

  async update(id: string, dto: UpdateCharacterDiagramDto): Promise<DbCharacterDiagram> {
    this.checkInitialized();

    const diagram = await this.supabase.getCharacterDiagram(id);
    if (!diagram) {
      throw new Error('Character diagram not found');
    }

    return this.supabase.updateCharacterDiagram(id, {
      name: dto.name,
    });
  }

  async findAll(status?: string): Promise<DbCharacterDiagram[]> {
    if (!this.supabase.isInitialized()) {
      return [];
    }
    return this.supabase.listCharacterDiagrams(status);
  }

  async findOne(id: string): Promise<DbCharacterDiagram | null> {
    if (!this.supabase.isInitialized()) {
      return null;
    }
    return this.supabase.getCharacterDiagram(id);
  }

  async delete(id: string): Promise<void> {
    this.checkInitialized();
    const diagram = await this.supabase.getCharacterDiagram(id);
    if (!diagram) {
      throw new Error('Character diagram not found');
    }

    // Only allow deletion of completed or failed diagrams
    if (diagram.status === 'processing' || diagram.status === 'pending') {
      throw new Error('Cannot delete a diagram that is still processing');
    }

    // Delete associated files from storage if they exist
    if (diagram.file_url) {
      try {
        const filePath = this.extractPathFromUrl(diagram.file_url);
        if (filePath) {
          await this.supabase.deleteFile('character-images', filePath);
        }
      } catch (error) {
        this.logger.warn(`Failed to delete generated file: ${error}`);
      }
    }

    if (diagram.source_image_url) {
      try {
        const sourcePath = this.extractPathFromUrl(diagram.source_image_url);
        if (sourcePath) {
          await this.supabase.deleteFile('character-images', sourcePath);
        }
      } catch (error) {
        this.logger.warn(`Failed to delete source file: ${error}`);
      }
    }

    // Delete from database
    await this.supabase.getClient()
      .from('character_diagrams')
      .delete()
      .eq('id', id);
  }

  private extractPathFromUrl(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
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
