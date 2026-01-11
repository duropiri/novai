import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService, DbCollection } from '../files/supabase.service';

// Represents an image from any source
export interface ImageItem {
  id: string;
  sourceType: 'character_diagram' | 'generated' | 'custom';
  sourceId?: string;
  imageUrl: string;
  thumbnailUrl?: string;
  name: string;
  createdAt: string;
}

// Collection with metadata
export interface ImageCollection {
  id: string;
  name: string;
  type: 'smart' | 'custom';
  count: number;
}

// Database row for image_collection_items
export interface DbImageCollectionItem {
  id: string;
  collection_id: string;
  source_type: string;
  source_id: string | null;
  image_url: string;
  thumbnail_url: string | null;
  name: string | null;
  created_at: string;
}

@Injectable()
export class ImageCollectionsService {
  private readonly logger = new Logger(ImageCollectionsService.name);

  // Smart collection IDs (virtual, not in database)
  static readonly SMART_CHARACTER_DIAGRAMS = 'smart-character-diagrams';
  static readonly SMART_GENERATED = 'smart-generated';

  constructor(private readonly supabase: SupabaseService) {}

  private checkInitialized(): void {
    if (!this.supabase.isInitialized()) {
      throw new Error('Database not configured. Please set up Supabase credentials.');
    }
  }

  /**
   * List all image collections - smart + custom
   */
  async listCollections(): Promise<ImageCollection[]> {
    if (!this.supabase.isInitialized()) {
      return this.getSmartCollections();
    }

    const collections: ImageCollection[] = [];

    // Add smart collections
    const smartCollections = await this.getSmartCollectionsWithCounts();
    collections.push(...smartCollections);

    // Get custom image collections from database
    const customCollections = await this.supabase.listCollections('image');
    for (const col of customCollections) {
      const count = await this.countItemsInCustomCollection(col.id);
      collections.push({
        id: col.id,
        name: col.name,
        type: 'custom',
        count,
      });
    }

    return collections;
  }

  /**
   * Get smart collections with actual counts
   */
  private async getSmartCollectionsWithCounts(): Promise<ImageCollection[]> {
    const [diagrams, generatedCount] = await Promise.all([
      this.supabase.listCharacterDiagrams('ready'),
      this.countGeneratedImages(),
    ]);

    return [
      {
        id: ImageCollectionsService.SMART_CHARACTER_DIAGRAMS,
        name: 'Character Diagrams',
        type: 'smart',
        count: diagrams.length,
      },
      {
        id: ImageCollectionsService.SMART_GENERATED,
        name: 'Generated Images',
        type: 'smart',
        count: generatedCount,
      },
    ];
  }

  /**
   * Get smart collections without DB access (fallback)
   */
  private getSmartCollections(): ImageCollection[] {
    return [
      {
        id: ImageCollectionsService.SMART_CHARACTER_DIAGRAMS,
        name: 'Character Diagrams',
        type: 'smart',
        count: 0,
      },
      {
        id: ImageCollectionsService.SMART_GENERATED,
        name: 'Generated Images',
        type: 'smart',
        count: 0,
      },
    ];
  }

  /**
   * Get images in a collection
   */
  async getCollectionImages(collectionId: string): Promise<ImageItem[]> {
    if (!this.supabase.isInitialized()) {
      return [];
    }

    // Handle smart collections
    if (collectionId === ImageCollectionsService.SMART_CHARACTER_DIAGRAMS) {
      return this.getCharacterDiagramImages();
    }
    if (collectionId === ImageCollectionsService.SMART_GENERATED) {
      return this.getGeneratedImages();
    }

    // Custom collection - query image_collection_items
    return this.getCustomCollectionImages(collectionId);
  }

  /**
   * Get all images (for "All Images" view)
   */
  async getAllImages(): Promise<ImageItem[]> {
    if (!this.supabase.isInitialized()) {
      return [];
    }

    const [diagrams, generated, customItems] = await Promise.all([
      this.getCharacterDiagramImages(),
      this.getGeneratedImages(),
      this.getAllCustomCollectionImages(),
    ]);

    // Combine and sort by created date descending
    const allImages = [...diagrams, ...generated, ...customItems];
    allImages.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return allImages;
  }

  /**
   * Create a custom collection
   */
  async createCollection(name: string): Promise<DbCollection> {
    this.checkInitialized();
    this.logger.log(`Creating image collection: ${name}`);
    return this.supabase.createCollection({ name, type: 'image' });
  }

  /**
   * Delete a custom collection
   */
  async deleteCollection(collectionId: string): Promise<void> {
    this.checkInitialized();

    // Prevent deletion of smart collections
    if (collectionId.startsWith('smart-')) {
      throw new Error('Cannot delete smart collections');
    }

    await this.supabase.deleteCollection(collectionId);
    this.logger.log(`Deleted image collection: ${collectionId}`);
  }

  /**
   * Add an image to a custom collection
   */
  async addToCollection(
    collectionId: string,
    data: { imageUrl: string; name?: string; sourceType?: string; sourceId?: string },
  ): Promise<DbImageCollectionItem> {
    this.checkInitialized();

    if (collectionId.startsWith('smart-')) {
      throw new Error('Cannot add items to smart collections');
    }

    return this.supabase.createImageCollectionItem({
      collection_id: collectionId,
      source_type: data.sourceType || 'url',
      source_id: data.sourceId || null,
      image_url: data.imageUrl,
      thumbnail_url: null,
      name: data.name || null,
    });
  }

  /**
   * Remove an image from a custom collection
   */
  async removeFromCollection(itemId: string): Promise<void> {
    this.checkInitialized();
    await this.supabase.deleteImageCollectionItem(itemId);
    this.logger.log(`Removed image from collection: ${itemId}`);
  }

  // --- Private helpers ---

  private async getCharacterDiagramImages(): Promise<ImageItem[]> {
    const diagrams = await this.supabase.listCharacterDiagrams('ready');
    return diagrams
      .filter((d) => d.file_url)
      .map((d) => ({
        id: d.id,
        sourceType: 'character_diagram' as const,
        sourceId: d.id,
        imageUrl: d.file_url!,
        thumbnailUrl: d.file_url || undefined,
        name: d.name,
        createdAt: d.created_at,
      }));
  }

  private async getGeneratedImages(): Promise<ImageItem[]> {
    const jobs = await this.supabase.listJobs({ type: 'image_generation', limit: 100 });
    const images: ImageItem[] = [];

    for (const job of jobs) {
      if (job.status !== 'completed' || !job.output_payload) continue;

      const output = job.output_payload as { images?: Array<{ url: string }> };
      if (!output.images) continue;

      for (let i = 0; i < output.images.length; i++) {
        const img = output.images[i];
        images.push({
          id: `${job.id}-${i}`,
          sourceType: 'generated',
          sourceId: job.id,
          imageUrl: img.url,
          thumbnailUrl: img.url,
          name: `Generated ${new Date(job.created_at).toLocaleDateString()}`,
          createdAt: job.created_at,
        });
      }
    }

    return images;
  }

  private async countGeneratedImages(): Promise<number> {
    const jobs = await this.supabase.listJobs({ type: 'image_generation', limit: 100 });
    let count = 0;
    for (const job of jobs) {
      if (job.status !== 'completed' || !job.output_payload) continue;
      const output = job.output_payload as { images?: Array<unknown> };
      count += output.images?.length || 0;
    }
    return count;
  }

  private async getCustomCollectionImages(collectionId: string): Promise<ImageItem[]> {
    const items = await this.supabase.listImageCollectionItems(collectionId);
    return items.map((item) => ({
      id: item.id,
      sourceType: item.source_type as 'character_diagram' | 'generated' | 'custom',
      sourceId: item.source_id || undefined,
      imageUrl: item.image_url,
      thumbnailUrl: item.thumbnail_url || undefined,
      name: item.name || 'Untitled',
      createdAt: item.created_at,
    }));
  }

  private async getAllCustomCollectionImages(): Promise<ImageItem[]> {
    const collections = await this.supabase.listCollections('image');
    const allItems: ImageItem[] = [];
    for (const col of collections) {
      const items = await this.getCustomCollectionImages(col.id);
      allItems.push(...items);
    }
    return allItems;
  }

  private async countItemsInCustomCollection(collectionId: string): Promise<number> {
    const items = await this.supabase.listImageCollectionItems(collectionId);
    return items.length;
  }
}
