import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SupabaseService, DbReferenceKit } from '../files/supabase.service';
import { QUEUES } from '../jobs/queues.constants';

export interface CreateReferenceKitDto {
  name: string;
  sourceImageUrl?: string; // Single image (backward compatible)
  imageUrls?: string[]; // Multiple source images
  imageTypes?: Record<number, string>; // e.g., { 0: 'front', 1: 'profile' }
  generateExtended?: boolean; // half_body, full_body
  expressions?: string[]; // 'smile', 'serious', 'surprised', 'angry'
}

export interface ReferenceKitSourceImage {
  id: string;
  reference_kit_id: string;
  image_url: string;
  image_type: string;
  sort_order: number;
  created_at: string;
}

export interface ReferenceKitWithSources extends DbReferenceKit {
  sources: ReferenceKitSourceImage[];
}

export interface RegenerateReferenceDto {
  kitId: string;
  referenceType: 'anchor' | 'profile' | 'half_body' | 'full_body' | string; // string for expression_smile etc.
}

@Injectable()
export class ReferenceKitService {
  private readonly logger = new Logger(ReferenceKitService.name);

  constructor(
    private readonly supabase: SupabaseService,
    @InjectQueue(QUEUES.REFERENCE_KIT) private readonly referenceKitQueue: Queue,
  ) {}

  private checkInitialized(): void {
    if (!this.supabase.isInitialized()) {
      throw new Error('Database not configured. Please set up Supabase credentials.');
    }
  }

  async create(dto: CreateReferenceKitDto): Promise<DbReferenceKit> {
    this.checkInitialized();
    this.logger.log(`Creating Reference Kit: ${dto.name}`);

    // Support both single image (backward compatible) and multiple images
    const imageUrls = dto.imageUrls || (dto.sourceImageUrl ? [dto.sourceImageUrl] : []);
    if (imageUrls.length === 0) {
      throw new BadRequestException('At least one source image is required');
    }

    const primaryImageUrl = imageUrls[0];
    const imageTypes = dto.imageTypes || {};

    // Create the reference kit record
    const kit = await this.supabase.createReferenceKit({
      name: dto.name,
      source_image_url: primaryImageUrl,
      anchor_face_url: null,
      profile_url: null,
      half_body_url: null,
      full_body_url: null,
      expressions: {},
      status: 'pending',
      generation_progress: {},
      error_message: null,
    });

    // Update with multi-image fields
    await this.supabase.getClient()
      .from('reference_kits')
      .update({
        source_image_count: imageUrls.length,
        uses_provided_images: imageUrls.length > 1,
      })
      .eq('id', kit.id);

    // Insert all source images into reference_kit_sources table
    const sourceRecords = imageUrls.map((url, index) => ({
      reference_kit_id: kit.id,
      image_url: url,
      image_type: imageTypes[index] || 'source',
      sort_order: index,
    }));

    await this.supabase.getClient()
      .from('reference_kit_sources')
      .insert(sourceRecords);

    // Queue the generation job
    await this.referenceKitQueue.add('generate-kit', {
      kitId: kit.id,
      sourceImageUrl: primaryImageUrl,
      allSourceUrls: imageUrls,
      imageTypes,
      generateExtended: dto.generateExtended ?? false,
      expressions: dto.expressions ?? [],
    });

    this.logger.log(`Reference Kit ${kit.id} queued for generation with ${imageUrls.length} source images`);

    return kit;
  }

  async regenerate(dto: RegenerateReferenceDto): Promise<DbReferenceKit> {
    this.checkInitialized();

    const originalKit = await this.supabase.getReferenceKit(dto.kitId);
    if (!originalKit) {
      throw new Error('Reference Kit not found');
    }

    this.logger.log(`Duplicating kit ${dto.kitId} and regenerating ${dto.referenceType}`);

    // Generate a new name with version increment
    const newName = this.generateVersionedName(originalKit.name);

    // Create a duplicate kit with all the same image URLs
    const duplicateKit = await this.supabase.createReferenceKit({
      name: newName,
      source_image_url: originalKit.source_image_url,
      anchor_face_url: originalKit.anchor_face_url,
      profile_url: originalKit.profile_url,
      half_body_url: originalKit.half_body_url,
      full_body_url: originalKit.full_body_url,
      expressions: { ...originalKit.expressions },
      status: 'generating',
      generation_progress: { [dto.referenceType]: 'pending' },
      error_message: null,
    });

    this.logger.log(`Created duplicate kit ${duplicateKit.id} from ${dto.kitId}`);

    // Queue regeneration job for the duplicate kit
    await this.referenceKitQueue.add('regenerate-reference', {
      kitId: duplicateKit.id,
      sourceImageUrl: originalKit.source_image_url,
      referenceType: dto.referenceType,
    });

    return duplicateKit;
  }

  /**
   * Generate a versioned name for duplicate kits
   * "My Kit" -> "My Kit (v2)"
   * "My Kit (v2)" -> "My Kit (v3)"
   */
  private generateVersionedName(originalName: string): string {
    const versionMatch = originalName.match(/^(.+)\s*\(v(\d+)\)$/);
    if (versionMatch) {
      const baseName = versionMatch[1].trim();
      const currentVersion = parseInt(versionMatch[2], 10);
      return `${baseName} (v${currentVersion + 1})`;
    }
    return `${originalName} (v2)`;
  }

  async findAll(status?: string): Promise<DbReferenceKit[]> {
    if (!this.supabase.isInitialized()) {
      return [];
    }
    return this.supabase.listReferenceKits(status);
  }

  async findOne(id: string): Promise<DbReferenceKit | null> {
    if (!this.supabase.isInitialized()) {
      return null;
    }
    return this.supabase.getReferenceKit(id);
  }

  async findOneWithSources(id: string): Promise<ReferenceKitWithSources | null> {
    if (!this.supabase.isInitialized()) {
      return null;
    }
    const kit = await this.supabase.getReferenceKit(id);
    if (!kit) {
      return null;
    }

    const { data: sources } = await this.supabase.getClient()
      .from('reference_kit_sources')
      .select('*')
      .eq('reference_kit_id', id)
      .order('sort_order', { ascending: true });

    return {
      ...kit,
      sources: sources || [],
    };
  }

  async getSources(kitId: string): Promise<ReferenceKitSourceImage[]> {
    if (!this.supabase.isInitialized()) {
      return [];
    }

    const { data: sources } = await this.supabase.getClient()
      .from('reference_kit_sources')
      .select('*')
      .eq('reference_kit_id', kitId)
      .order('sort_order', { ascending: true });

    return sources || [];
  }

  async addSources(kitId: string, imageUrls: string[], imageTypes?: Record<number, string>): Promise<ReferenceKitSourceImage[]> {
    this.checkInitialized();

    const kit = await this.supabase.getReferenceKit(kitId);
    if (!kit) {
      throw new Error('Reference Kit not found');
    }

    // Get current max sort order
    const { data: existingSources } = await this.supabase.getClient()
      .from('reference_kit_sources')
      .select('sort_order')
      .eq('reference_kit_id', kitId)
      .order('sort_order', { ascending: false })
      .limit(1);

    const startOrder = (existingSources?.[0]?.sort_order ?? -1) + 1;

    const sourceRecords = imageUrls.map((url, index) => ({
      reference_kit_id: kitId,
      image_url: url,
      image_type: imageTypes?.[index] || 'source',
      sort_order: startOrder + index,
    }));

    const { data: inserted, error } = await this.supabase.getClient()
      .from('reference_kit_sources')
      .insert(sourceRecords)
      .select();

    if (error) {
      throw new Error(`Failed to add sources: ${error.message}`);
    }

    // Update source count
    const currentCount = kit.source_image_count || 1;
    await this.supabase.getClient()
      .from('reference_kits')
      .update({
        source_image_count: currentCount + imageUrls.length,
        uses_provided_images: true,
      })
      .eq('id', kitId);

    this.logger.log(`Added ${imageUrls.length} source images to kit ${kitId}`);
    return inserted || [];
  }

  async deleteSource(kitId: string, sourceId: string): Promise<void> {
    this.checkInitialized();

    // Get the source
    const { data: source } = await this.supabase.getClient()
      .from('reference_kit_sources')
      .select('*')
      .eq('id', sourceId)
      .eq('reference_kit_id', kitId)
      .single();

    if (!source) {
      throw new Error('Source image not found');
    }

    // Don't allow deleting if it's the only source
    const { count } = await this.supabase.getClient()
      .from('reference_kit_sources')
      .select('*', { count: 'exact', head: true })
      .eq('reference_kit_id', kitId);

    if (count && count <= 1) {
      throw new BadRequestException('Cannot delete the only source image');
    }

    // Delete the source record
    await this.supabase.getClient()
      .from('reference_kit_sources')
      .delete()
      .eq('id', sourceId);

    // Update source count
    const kit = await this.supabase.getReferenceKit(kitId);
    if (kit) {
      await this.supabase.getClient()
        .from('reference_kits')
        .update({ source_image_count: Math.max(1, (kit.source_image_count || 1) - 1) })
        .eq('id', kitId);
    }

    this.logger.log(`Deleted source ${sourceId} from kit ${kitId}`);
  }

  async update(id: string, updates: { name?: string }): Promise<DbReferenceKit> {
    this.checkInitialized();
    return this.supabase.updateReferenceKit(id, updates);
  }

  async delete(id: string): Promise<void> {
    this.checkInitialized();

    const kit = await this.supabase.getReferenceKit(id);
    if (!kit) {
      throw new Error('Reference Kit not found');
    }

    // Only allow deletion if not currently generating
    if (kit.status === 'generating') {
      throw new Error('Cannot delete a kit that is currently generating');
    }

    // TODO: Delete associated storage files

    await this.supabase.deleteReferenceKit(id);
    this.logger.log(`Deleted Reference Kit ${id}`);
  }

  /**
   * Get all reference URLs for a kit (for use in image generation)
   */
  async getReferenceUrls(id: string): Promise<{
    anchorFaceUrl: string | null;
    profileUrl: string | null;
    halfBodyUrl: string | null;
    fullBodyUrl: string | null;
    expressions: Record<string, string>;
  } | null> {
    const kit = await this.findOne(id);
    if (!kit) return null;

    return {
      anchorFaceUrl: kit.anchor_face_url,
      profileUrl: kit.profile_url,
      halfBodyUrl: kit.half_body_url,
      fullBodyUrl: kit.full_body_url,
      expressions: kit.expressions,
    };
  }

}
