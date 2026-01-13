import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SupabaseService, DbReferenceKit } from '../files/supabase.service';
import { QUEUES } from '../jobs/queues.constants';

export interface CreateReferenceKitDto {
  name: string;
  sourceImageUrl: string;
  generateExtended?: boolean; // half_body, full_body
  expressions?: string[]; // 'smile', 'serious', 'surprised', 'angry'
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

    // Create the reference kit record
    const kit = await this.supabase.createReferenceKit({
      name: dto.name,
      source_image_url: dto.sourceImageUrl,
      anchor_face_url: null,
      profile_url: null,
      half_body_url: null,
      full_body_url: null,
      expressions: {},
      status: 'pending',
      generation_progress: {},
      error_message: null,
    });

    // Queue the generation job
    await this.referenceKitQueue.add('generate-kit', {
      kitId: kit.id,
      sourceImageUrl: dto.sourceImageUrl,
      generateExtended: dto.generateExtended ?? false,
      expressions: dto.expressions ?? [],
    });

    this.logger.log(`Reference Kit ${kit.id} queued for generation`);

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
