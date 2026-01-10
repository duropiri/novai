import { Injectable } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

export const STORAGE_BUCKETS = {
  TRAINING_IMAGES: 'training-images',
  LORA_WEIGHTS: 'lora-weights',
  CHARACTER_IMAGES: 'character-images',
  SOURCE_VIDEOS: 'source-videos',
  PROCESSED_VIDEOS: 'processed-videos',
  VARIANT_VIDEOS: 'variant-videos',
  AUDIO: 'audio',
} as const;

export interface FileMetadata {
  id: string;
  bucket: string;
  path: string;
  url: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
}

@Injectable()
export class FilesService {
  // In-memory store for now (will be replaced with Supabase DB)
  private files: Map<string, FileMetadata> = new Map();

  constructor(private supabaseService: SupabaseService) {}

  async uploadFile(
    bucket: keyof typeof STORAGE_BUCKETS,
    file: Buffer,
    originalName: string,
    mimeType: string,
  ): Promise<FileMetadata> {
    const id = crypto.randomUUID();
    const ext = originalName.split('.').pop() || '';
    const path = `${id}${ext ? `.${ext}` : ''}`;
    const bucketName = STORAGE_BUCKETS[bucket];

    // Upload the file
    await this.supabaseService.uploadFile(
      bucketName,
      path,
      file,
      mimeType,
    );

    // Use signed URLs for all file types to ensure accessibility
    // Signed URLs work regardless of bucket public/private settings
    // Long expiry (7 days) for media files
    const expirySeconds = 7 * 24 * 60 * 60; // 7 days
    const url = await this.supabaseService.getSignedUrl(bucketName, path, expirySeconds);

    const metadata: FileMetadata = {
      id,
      bucket: bucketName,
      path,
      url,
      originalName,
      mimeType,
      sizeBytes: file.length,
      createdAt: new Date(),
    };

    this.files.set(id, metadata);

    return metadata;
  }

  async getFileUrl(id: string, signed = true): Promise<string> {
    const metadata = this.files.get(id);
    if (!metadata) {
      throw new Error(`File not found: ${id}`);
    }

    // Always use signed URLs for reliability (7 day expiry)
    const expirySeconds = 7 * 24 * 60 * 60;
    return this.supabaseService.getSignedUrl(metadata.bucket, metadata.path, expirySeconds);
  }

  async deleteFile(id: string): Promise<void> {
    const metadata = this.files.get(id);
    if (!metadata) {
      throw new Error(`File not found: ${id}`);
    }

    await this.supabaseService.deleteFile(metadata.bucket, metadata.path);
    this.files.delete(id);
  }

  getFile(id: string): FileMetadata | undefined {
    return this.files.get(id);
  }
}
