import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService, DbCollection, DbVideo, DbAudioFile } from '../files/supabase.service';

export interface CreateCollectionDto {
  name: string;
  type: 'video' | 'audio';
}

export interface CollectionWithStats extends DbCollection {
  itemCount: number;
  totalDurationSeconds: number;
}

@Injectable()
export class CollectionsService {
  private readonly logger = new Logger(CollectionsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async create(dto: CreateCollectionDto): Promise<DbCollection> {
    this.logger.log(`Creating ${dto.type} collection: ${dto.name}`);
    return this.supabase.createCollection({
      name: dto.name,
      type: dto.type,
    });
  }

  async findAll(type?: 'video' | 'audio'): Promise<CollectionWithStats[]> {
    const collections = await this.supabase.listCollections(type);

    // Get stats for each collection
    const collectionsWithStats: CollectionWithStats[] = await Promise.all(
      collections.map(async (collection) => {
        let itemCount = 0;
        let totalDurationSeconds = 0;

        if (collection.type === 'video') {
          const videos = await this.supabase.listVideos({ collectionId: collection.id });
          itemCount = videos.length;
          totalDurationSeconds = videos.reduce((sum, v) => sum + (v.duration_seconds || 0), 0);
        } else {
          const audioFiles = await this.supabase.listAudioFiles(collection.id);
          itemCount = audioFiles.length;
          totalDurationSeconds = audioFiles.reduce((sum, a) => sum + (a.duration_seconds || 0), 0);
        }

        return {
          ...collection,
          itemCount,
          totalDurationSeconds,
        };
      }),
    );

    return collectionsWithStats;
  }

  async findOne(id: string): Promise<CollectionWithStats | null> {
    const collection = await this.supabase.getCollection(id);
    if (!collection) return null;

    let itemCount = 0;
    let totalDurationSeconds = 0;

    if (collection.type === 'video') {
      const videos = await this.supabase.listVideos({ collectionId: collection.id });
      itemCount = videos.length;
      totalDurationSeconds = videos.reduce((sum, v) => sum + (v.duration_seconds || 0), 0);
    } else {
      const audioFiles = await this.supabase.listAudioFiles(collection.id);
      itemCount = audioFiles.length;
      totalDurationSeconds = audioFiles.reduce((sum, a) => sum + (a.duration_seconds || 0), 0);
    }

    return {
      ...collection,
      itemCount,
      totalDurationSeconds,
    };
  }

  async update(id: string, name: string): Promise<DbCollection> {
    this.logger.log(`Updating collection ${id}: ${name}`);
    return this.supabase.updateCollection(id, { name });
  }

  async delete(id: string): Promise<void> {
    const collection = await this.supabase.getCollection(id);
    if (!collection) {
      throw new Error('Collection not found');
    }

    // Check if collection has items
    if (collection.type === 'video') {
      const videos = await this.supabase.listVideos({ collectionId: id });
      if (videos.length > 0) {
        throw new Error('Cannot delete collection with videos. Remove videos first.');
      }
    } else {
      const audioFiles = await this.supabase.listAudioFiles(id);
      if (audioFiles.length > 0) {
        throw new Error('Cannot delete collection with audio files. Remove files first.');
      }
    }

    await this.supabase.deleteCollection(id);
    this.logger.log(`Deleted collection ${id}`);
  }

  // Get videos in a collection
  async getVideos(collectionId: string): Promise<DbVideo[]> {
    return this.supabase.listVideos({ collectionId });
  }

  // Get audio files in a collection
  async getAudioFiles(collectionId: string): Promise<DbAudioFile[]> {
    return this.supabase.listAudioFiles(collectionId);
  }
}
