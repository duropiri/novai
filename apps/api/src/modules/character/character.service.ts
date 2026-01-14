import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SupabaseService, DbCharacterDiagram } from '../files/supabase.service';
import { JobsService } from '../jobs/jobs.service';
import { QUEUES } from '../jobs/queues.constants';

export interface CreateCharacterDiagramDto {
  name?: string;
  sourceImageUrl?: string; // Single image (backward compatible)
  imageUrls?: string[]; // Multiple images (new)
  primaryImageIndex?: number; // Which image is primary (default: 0)
  imageTypes?: Record<number, string>; // { 0: 'front', 1: 'profile' }
  clothingOption?: 'original' | 'minimal'; // 'original' keeps outfit, 'minimal' for body proportions
}

export interface UploadCharacterDiagramDto {
  name: string;
  fileUrl?: string; // Single file (backward compatible)
  fileUrls?: string[]; // Multiple files (new)
  primaryImageIndex?: number;
  imageTypes?: Record<number, string>;
}

export interface UpdateCharacterDiagramDto {
  name?: string;
}

export interface CharacterDiagramImage {
  id: string;
  character_diagram_id: string;
  image_url: string;
  image_type: string;
  is_primary: boolean;
  sort_order: number;
  created_at: string;
}

export interface CharacterDiagramWithImages extends DbCharacterDiagram {
  images: CharacterDiagramImage[];
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

    // Support both single image (backward compatible) and multiple images
    const imageUrls = dto.imageUrls || (dto.sourceImageUrl ? [dto.sourceImageUrl] : []);
    if (imageUrls.length === 0) {
      throw new BadRequestException('At least one image is required');
    }

    const primaryIndex = dto.primaryImageIndex ?? 0;
    const imageTypes = dto.imageTypes || {};

    // Generate name if not provided
    const name = dto.name?.trim() || `Character ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    this.logger.log(`Creating character diagram: ${name} with ${imageUrls.length} images`);

    // Create the character diagram record
    const diagram = await this.supabase.createCharacterDiagram({
      name,
      source_image_url: imageUrls[primaryIndex], // Primary image for backward compatibility
      file_url: null,
      status: 'pending',
      error_message: null,
      cost_cents: null,
    });

    // Update with multi-image fields
    await this.supabase.getClient()
      .from('character_diagrams')
      .update({
        image_count: imageUrls.length,
        primary_image_url: imageUrls[primaryIndex],
      })
      .eq('id', diagram.id);

    // Insert all images into character_diagram_images table
    const imageRecords = imageUrls.map((url, index) => ({
      character_diagram_id: diagram.id,
      image_url: url,
      image_type: imageTypes[index] || (index === primaryIndex ? 'primary' : 'reference'),
      is_primary: index === primaryIndex,
      sort_order: index,
    }));

    await this.supabase.getClient()
      .from('character_diagram_images')
      .insert(imageRecords);

    const clothingOption = dto.clothingOption || 'original';

    // Create a job record for tracking
    const job = await this.jobsService.createJob('character_diagram', diagram.id, {
      sourceImageUrl: imageUrls[primaryIndex],
      allImageUrls: imageUrls,
      imageTypes,
      name,
      clothingOption,
    });

    // Queue the generation job - photo-based
    await this.characterQueue.add('generate-from-photo', {
      jobId: job.id,
      diagramId: diagram.id,
      sourceImageUrl: imageUrls[primaryIndex],
      allImageUrls: imageUrls,
      name,
      clothingOption,
    });

    // Update job status to queued
    await this.jobsService.updateJob(job.id, { status: 'queued' });

    this.logger.log(`Character diagram ${diagram.id} queued for generation with ${imageUrls.length} reference images`);

    return diagram;
  }

  async upload(dto: UploadCharacterDiagramDto): Promise<DbCharacterDiagram> {
    this.checkInitialized();

    this.logger.log(`Uploading character diagram: ${dto.name}`);

    // Create the character diagram record with status ready (no processing needed)
    const diagram = await this.supabase.createCharacterDiagram({
      name: dto.name,
      source_image_url: null,
      file_url: dto.fileUrl ?? null,
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

  async findOneWithImages(id: string): Promise<CharacterDiagramWithImages | null> {
    if (!this.supabase.isInitialized()) {
      return null;
    }
    const diagram = await this.supabase.getCharacterDiagram(id);
    if (!diagram) {
      return null;
    }

    const { data: images } = await this.supabase.getClient()
      .from('character_diagram_images')
      .select('*')
      .eq('character_diagram_id', id)
      .order('sort_order', { ascending: true });

    return {
      ...diagram,
      images: images || [],
    };
  }

  async getImages(diagramId: string): Promise<CharacterDiagramImage[]> {
    if (!this.supabase.isInitialized()) {
      return [];
    }

    const { data: images } = await this.supabase.getClient()
      .from('character_diagram_images')
      .select('*')
      .eq('character_diagram_id', diagramId)
      .order('sort_order', { ascending: true });

    return images || [];
  }

  async addImages(diagramId: string, imageUrls: string[], imageTypes?: Record<number, string>): Promise<CharacterDiagramImage[]> {
    this.checkInitialized();

    const diagram = await this.supabase.getCharacterDiagram(diagramId);
    if (!diagram) {
      throw new Error('Character diagram not found');
    }

    // Get current max sort order
    const { data: existingImages } = await this.supabase.getClient()
      .from('character_diagram_images')
      .select('sort_order')
      .eq('character_diagram_id', diagramId)
      .order('sort_order', { ascending: false })
      .limit(1);

    const startOrder = (existingImages?.[0]?.sort_order ?? -1) + 1;

    const imageRecords = imageUrls.map((url, index) => ({
      character_diagram_id: diagramId,
      image_url: url,
      image_type: imageTypes?.[index] || 'reference',
      is_primary: false,
      sort_order: startOrder + index,
    }));

    const { data: inserted, error } = await this.supabase.getClient()
      .from('character_diagram_images')
      .insert(imageRecords)
      .select();

    if (error) {
      throw new Error(`Failed to add images: ${error.message}`);
    }

    // Update image count
    const currentCount = diagram.image_count || 1;
    await this.supabase.getClient()
      .from('character_diagrams')
      .update({ image_count: currentCount + imageUrls.length })
      .eq('id', diagramId);

    this.logger.log(`Added ${imageUrls.length} images to diagram ${diagramId}`);
    return inserted || [];
  }

  async setPrimaryImage(diagramId: string, imageId: string): Promise<void> {
    this.checkInitialized();

    // Unset current primary
    await this.supabase.getClient()
      .from('character_diagram_images')
      .update({ is_primary: false })
      .eq('character_diagram_id', diagramId);

    // Set new primary
    const { data: image, error } = await this.supabase.getClient()
      .from('character_diagram_images')
      .update({ is_primary: true, image_type: 'primary' })
      .eq('id', imageId)
      .eq('character_diagram_id', diagramId)
      .select()
      .single();

    if (error || !image) {
      throw new Error('Image not found');
    }

    // Update diagram's primary_image_url
    await this.supabase.getClient()
      .from('character_diagrams')
      .update({ primary_image_url: image.image_url, source_image_url: image.image_url })
      .eq('id', diagramId);

    this.logger.log(`Set image ${imageId} as primary for diagram ${diagramId}`);
  }

  async deleteImage(diagramId: string, imageId: string): Promise<void> {
    this.checkInitialized();

    // Get the image to check if it's primary
    const { data: image } = await this.supabase.getClient()
      .from('character_diagram_images')
      .select('*')
      .eq('id', imageId)
      .eq('character_diagram_id', diagramId)
      .single();

    if (!image) {
      throw new Error('Image not found');
    }

    // Don't allow deleting if it's the only image
    const { count } = await this.supabase.getClient()
      .from('character_diagram_images')
      .select('*', { count: 'exact', head: true })
      .eq('character_diagram_id', diagramId);

    if (count && count <= 1) {
      throw new BadRequestException('Cannot delete the only image');
    }

    // Delete the image record
    await this.supabase.getClient()
      .from('character_diagram_images')
      .delete()
      .eq('id', imageId);

    // If it was primary, set the first remaining image as primary
    if (image.is_primary) {
      const { data: remaining } = await this.supabase.getClient()
        .from('character_diagram_images')
        .select('*')
        .eq('character_diagram_id', diagramId)
        .order('sort_order', { ascending: true })
        .limit(1);

      if (remaining?.[0]) {
        await this.setPrimaryImage(diagramId, remaining[0].id);
      }
    }

    // Update image count
    const diagram = await this.supabase.getCharacterDiagram(diagramId);
    if (diagram) {
      await this.supabase.getClient()
        .from('character_diagrams')
        .update({ image_count: Math.max(0, (diagram.image_count || 1) - 1) })
        .eq('id', diagramId);
    }

    // Try to delete from storage
    try {
      const filePath = this.extractPathFromUrl(image.image_url);
      if (filePath) {
        await this.supabase.deleteFile('character-images', filePath);
      }
    } catch (error) {
      this.logger.warn(`Failed to delete image file: ${error}`);
    }

    this.logger.log(`Deleted image ${imageId} from diagram ${diagramId}`);
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
