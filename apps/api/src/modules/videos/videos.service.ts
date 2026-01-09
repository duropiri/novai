import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService, DbVideo } from '../files/supabase.service';

export interface CreateVideoDto {
  name: string;
  collectionId: string;
  fileUrl: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  fileSizeBytes?: number;
}

@Injectable()
export class VideosService {
  private readonly logger = new Logger(VideosService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async create(dto: CreateVideoDto): Promise<DbVideo> {
    this.logger.log(`Creating video: ${dto.name}`);

    return this.supabase.createVideo({
      name: dto.name,
      type: 'source',
      collection_id: dto.collectionId,
      parent_video_id: null,
      character_diagram_id: null,
      file_url: dto.fileUrl,
      thumbnail_url: dto.thumbnailUrl || null,
      duration_seconds: dto.durationSeconds || null,
      width: dto.width || null,
      height: dto.height || null,
      file_size_bytes: dto.fileSizeBytes || null,
    });
  }

  async findAll(options?: { type?: string; collectionId?: string }): Promise<DbVideo[]> {
    return this.supabase.listVideos(options);
  }

  async findOne(id: string): Promise<DbVideo | null> {
    return this.supabase.getVideo(id);
  }

  async update(id: string, updates: Partial<Pick<DbVideo, 'name' | 'collection_id'>>): Promise<DbVideo> {
    return this.supabase.updateVideo(id, updates);
  }

  async delete(id: string): Promise<void> {
    const video = await this.supabase.getVideo(id);
    if (!video) {
      throw new Error('Video not found');
    }

    // Delete file from storage
    if (video.file_url) {
      try {
        const filePath = this.extractPathFromUrl(video.file_url);
        if (filePath) {
          await this.supabase.deleteFile('source-videos', filePath);
        }
      } catch (error) {
        this.logger.warn(`Failed to delete video file: ${error}`);
      }
    }

    // Delete thumbnail if exists
    if (video.thumbnail_url) {
      try {
        const thumbPath = this.extractPathFromUrl(video.thumbnail_url);
        if (thumbPath) {
          await this.supabase.deleteFile('source-videos', thumbPath);
        }
      } catch (error) {
        this.logger.warn(`Failed to delete thumbnail: ${error}`);
      }
    }

    await this.supabase.deleteVideo(id);
    this.logger.log(`Deleted video ${id}`);
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
