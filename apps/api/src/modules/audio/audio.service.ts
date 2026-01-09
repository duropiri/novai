import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService, DbAudioFile } from '../files/supabase.service';

export interface CreateAudioFileDto {
  name: string;
  collectionId: string;
  fileUrl: string;
  durationSeconds?: number;
  fileSizeBytes?: number;
}

@Injectable()
export class AudioService {
  private readonly logger = new Logger(AudioService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async create(dto: CreateAudioFileDto): Promise<DbAudioFile> {
    this.logger.log(`Creating audio file: ${dto.name}`);

    return this.supabase.createAudioFile({
      name: dto.name,
      collection_id: dto.collectionId,
      file_url: dto.fileUrl,
      duration_seconds: dto.durationSeconds || null,
      file_size_bytes: dto.fileSizeBytes || null,
    });
  }

  async findAll(collectionId?: string): Promise<DbAudioFile[]> {
    return this.supabase.listAudioFiles(collectionId);
  }

  async findOne(id: string): Promise<DbAudioFile | null> {
    return this.supabase.getAudioFile(id);
  }

  async update(id: string, updates: Partial<Pick<DbAudioFile, 'name' | 'collection_id'>>): Promise<DbAudioFile> {
    return this.supabase.updateAudioFile(id, updates);
  }

  async delete(id: string): Promise<void> {
    const audio = await this.supabase.getAudioFile(id);
    if (!audio) {
      throw new Error('Audio file not found');
    }

    // Delete file from storage
    if (audio.file_url) {
      try {
        const filePath = this.extractPathFromUrl(audio.file_url);
        if (filePath) {
          await this.supabase.deleteFile('audio', filePath);
        }
      } catch (error) {
        this.logger.warn(`Failed to delete audio file: ${error}`);
      }
    }

    await this.supabase.deleteAudioFile(id);
    this.logger.log(`Deleted audio file ${id}`);
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
