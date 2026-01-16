import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
  private readonly logger = new Logger(FilesService.name);
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

  /**
   * Extract frames from a video file and upload them
   * @param videoBuffer - The video file buffer
   * @param maxFrames - Maximum number of frames to extract (default: 50)
   * @param targetFps - Target frames per second to extract (default: 1 fps)
   * @returns Array of uploaded frame URLs
   */
  async extractFramesFromVideo(
    videoBuffer: Buffer,
    maxFrames: number = 50,
    targetFps: number = 1,
  ): Promise<string[]> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-extract-'));
    const frameUrls: string[] = [];

    try {
      // Write video to temp file
      const videoPath = path.join(tempDir, 'input.mp4');
      await fs.writeFile(videoPath, videoBuffer);

      // Get video info
      const { stdout: durationStr } = await execAsync(
        `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`,
      );
      const duration = parseFloat(durationStr.trim()) || 10;

      // Calculate how many frames to extract
      const totalPossibleFrames = Math.floor(duration * targetFps);
      const framesToExtract = Math.min(totalPossibleFrames, maxFrames);

      // Calculate interval to get evenly spaced frames
      const interval = duration / framesToExtract;

      this.logger.log(`Extracting ${framesToExtract} frames from ${duration}s video (interval: ${interval}s)`);

      // Extract frames
      const framesDir = path.join(tempDir, 'frames');
      await fs.mkdir(framesDir, { recursive: true });

      await execAsync(
        `ffmpeg -i "${videoPath}" -vf "fps=1/${interval}" -frames:v ${framesToExtract} "${framesDir}/frame_%04d.png"`,
      );

      // Get list of extracted frames
      const frameFiles = await fs.readdir(framesDir);
      const sortedFrames = frameFiles.filter((f) => f.endsWith('.png')).sort();

      this.logger.log(`Extracted ${sortedFrames.length} frames, uploading...`);

      // Upload frames
      const uploadPrefix = `extracted-frames/${Date.now()}`;
      for (let i = 0; i < sortedFrames.length; i++) {
        const framePath = path.join(framesDir, sortedFrames[i]);
        const frameBuffer = await fs.readFile(framePath);
        const uploadPath = `${uploadPrefix}/frame_${String(i).padStart(4, '0')}.png`;

        const { url } = await this.supabaseService.uploadFile(
          STORAGE_BUCKETS.TRAINING_IMAGES,
          uploadPath,
          frameBuffer,
          'image/png',
        );
        frameUrls.push(url);
      }

      this.logger.log(`Uploaded ${frameUrls.length} frames`);
      return frameUrls;
    } finally {
      // Cleanup
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Download files from a Google Drive folder link
   * Supports images and videos (videos are extracted frame by frame)
   * @param folderUrl - Google Drive folder share link
   * @param maxFramesPerVideo - Max frames to extract per video
   * @returns Array of uploaded image URLs
   */
  async downloadGoogleDriveFolder(
    folderUrl: string,
    maxFramesPerVideo: number = 50,
  ): Promise<string[]> {
    const imageUrls: string[] = [];

    // Extract folder ID from URL
    // Formats:
    // - https://drive.google.com/drive/folders/FOLDER_ID
    // - https://drive.google.com/drive/folders/FOLDER_ID?usp=sharing
    const folderIdMatch = folderUrl.match(/folders\/([a-zA-Z0-9_-]+)/);
    if (!folderIdMatch) {
      throw new Error('Invalid Google Drive folder URL');
    }
    const folderId = folderIdMatch[1];

    this.logger.log(`Downloading from Google Drive folder: ${folderId}`);

    // Use Google Drive API to list files in folder
    // Note: This requires the folder to be publicly shared
    const apiUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents&key=${process.env.GOOGLE_API_KEY || ''}&fields=files(id,name,mimeType,size)`;

    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`Failed to list Google Drive folder: ${response.statusText}`);
    }

    const data = await response.json() as { files: Array<{ id: string; name: string; mimeType: string; size?: string }> };
    const files = data.files || [];

    this.logger.log(`Found ${files.length} files in Google Drive folder`);

    const imageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const videoTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'];

    for (const file of files) {
      try {
        // Download file content
        const downloadUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${process.env.GOOGLE_API_KEY || ''}`;
        const fileResponse = await fetch(downloadUrl);

        if (!fileResponse.ok) {
          this.logger.warn(`Failed to download ${file.name}: ${fileResponse.statusText}`);
          continue;
        }

        const buffer = Buffer.from(await fileResponse.arrayBuffer());

        if (imageTypes.includes(file.mimeType)) {
          // Upload image directly
          const uploadPath = `gdrive-import/${Date.now()}/${file.name}`;
          const { url } = await this.supabaseService.uploadFile(
            STORAGE_BUCKETS.TRAINING_IMAGES,
            uploadPath,
            buffer,
            file.mimeType,
          );
          imageUrls.push(url);
          this.logger.log(`Uploaded image: ${file.name}`);
        } else if (videoTypes.includes(file.mimeType)) {
          // Extract frames from video
          this.logger.log(`Extracting frames from video: ${file.name}`);
          const frames = await this.extractFramesFromVideo(buffer, maxFramesPerVideo);
          imageUrls.push(...frames);
          this.logger.log(`Extracted ${frames.length} frames from ${file.name}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(`Error processing ${file.name}: ${message}`);
      }
    }

    this.logger.log(`Total images from Google Drive: ${imageUrls.length}`);
    return imageUrls;
  }

  /**
   * Create a ZIP file from an array of image URLs and upload it
   * Returns the URL of the uploaded ZIP file
   */
  async createZipFromUrls(imageUrls: string[], prefix: string = 'images'): Promise<string> {
    const archiver = await import('archiver');
    const { PassThrough } = await import('stream');

    this.logger.log(`Creating ZIP from ${imageUrls.length} images`);

    // Create archiver instance
    const archive = archiver.default('zip', { zlib: { level: 5 } });
    const chunks: Buffer[] = [];

    // Collect archive data into buffer
    const passThrough = new PassThrough();
    passThrough.on('data', (chunk: Buffer) => chunks.push(chunk));

    archive.pipe(passThrough);

    // Download each image and add to archive
    for (let i = 0; i < imageUrls.length; i++) {
      try {
        const response = await fetch(imageUrls[i]);
        if (!response.ok) {
          this.logger.warn(`Failed to fetch image ${i}: ${response.statusText}`);
          continue;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        const ext = imageUrls[i].split('.').pop()?.split('?')[0] || 'png';
        const filename = `${prefix}_${i.toString().padStart(4, '0')}.${ext}`;
        archive.append(buffer, { name: filename });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(`Error fetching image ${i}: ${message}`);
      }
    }

    // Finalize the archive
    await archive.finalize();

    // Wait for all data to be collected
    await new Promise<void>((resolve) => passThrough.on('end', resolve));

    const zipBuffer = Buffer.concat(chunks);

    // Upload to Supabase
    const zipPath = `${prefix}-${Date.now()}.zip`;
    const { url } = await this.supabaseService.uploadFile(
      STORAGE_BUCKETS.TRAINING_IMAGES,
      zipPath,
      zipBuffer,
      'application/zip',
    );

    this.logger.log(`Created ZIP file: ${zipPath} (${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB)`);
    return url;
  }
}
