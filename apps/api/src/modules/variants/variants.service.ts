import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as archiver from 'archiver';
import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SupabaseService, DbVideo, DbAudioFile, DbHook } from '../files/supabase.service';
import { JobsService } from '../jobs/jobs.service';
import { QUEUES } from '../jobs/jobs.module';

export interface CreateVariantBatchDto {
  videoCollectionIds: string[];
  audioCollectionIds?: string[];
  hookIds?: string[];
  hookDuration?: number; // seconds
  hookPosition?: 'top' | 'center' | 'bottom';
}

export interface VariantBatchResult {
  batchId: string;
  totalVariants: number;
  estimatedProcessingMinutes: number;
}

export interface VariantItem {
  video: DbVideo;
  audio?: DbAudioFile;
  hook?: DbHook;
}

// Store batch metadata (in production, use database)
interface BatchMetadata {
  batchId: string;
  createdAt: Date;
  expiresAt: Date;
  zipUrl?: string;
  totalVariants: number;
}

@Injectable()
export class VariantsService {
  private readonly logger = new Logger(VariantsService.name);
  private readonly tempDir: string;
  private readonly batchMetadata: Map<string, BatchMetadata> = new Map();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly jobsService: JobsService,
    @InjectQueue(QUEUES.VARIANT) private readonly variantQueue: Queue,
  ) {
    this.tempDir = path.join(os.tmpdir(), 'novai-variant-zips');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async createBatch(dto: CreateVariantBatchDto): Promise<VariantBatchResult> {
    this.logger.log('Creating variant batch...');

    // Gather all items from collections
    const videos: DbVideo[] = [];
    const audios: DbAudioFile[] = [];
    const hooks: DbHook[] = [];

    // Get videos from selected collections
    for (const collectionId of dto.videoCollectionIds) {
      const collectionVideos = await this.supabase.listVideos({ collectionId });
      videos.push(...collectionVideos);
    }

    // Get audios from selected collections
    if (dto.audioCollectionIds && dto.audioCollectionIds.length > 0) {
      for (const collectionId of dto.audioCollectionIds) {
        const collectionAudios = await this.supabase.listAudioFiles(collectionId);
        audios.push(...collectionAudios);
      }
    }

    // Get selected hooks
    if (dto.hookIds && dto.hookIds.length > 0) {
      for (const hookId of dto.hookIds) {
        const hook = await this.supabase.getHook(hookId);
        if (hook) {
          hooks.push(hook);
        }
      }
    }

    if (videos.length === 0) {
      throw new Error('No videos found in selected collections');
    }

    // Generate variant combinations using round-robin
    const variants = this.generateRoundRobinVariants(videos, audios, hooks);

    this.logger.log(`Generated ${variants.length} variants from ${videos.length} videos`);

    // Create a batch job
    const batchId = `batch-${Date.now()}`;

    // Queue each variant for processing
    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i];

      // Create job record
      const job = await this.jobsService.createJob('variant', variant.video.id, {
        batchId,
        variantIndex: i,
        videoId: variant.video.id,
        audioId: variant.audio?.id,
        hookId: variant.hook?.id,
        hookDuration: dto.hookDuration,
        hookPosition: dto.hookPosition,
      });

      // Add to processing queue
      await this.variantQueue.add(
        'process',
        {
          jobId: job.id,
          batchId,
          variantIndex: i,
          video: variant.video,
          audio: variant.audio,
          hook: variant.hook,
          hookDuration: dto.hookDuration || 5,
          hookPosition: dto.hookPosition || 'bottom',
        },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        },
      );

      // Update job status to queued
      await this.jobsService.updateJob(job.id, { status: 'queued' });
    }

    // Estimate processing time (roughly 30 seconds per variant)
    const estimatedMinutes = Math.ceil((variants.length * 30) / 60);

    // Store batch metadata with 24-hour expiry
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
    this.batchMetadata.set(batchId, {
      batchId,
      createdAt: now,
      expiresAt,
      totalVariants: variants.length,
    });

    return {
      batchId,
      totalVariants: variants.length,
      estimatedProcessingMinutes: estimatedMinutes,
    };
  }

  async getBatchStatus(batchId: string): Promise<{
    total: number;
    completed: number;
    failed: number;
    processing: number;
    pending: number;
  }> {
    const jobs = await this.supabase.listJobs({ type: 'variant' });
    const batchJobs = jobs.filter((job) => {
      const payload = job.input_payload as { batchId?: string };
      return payload?.batchId === batchId;
    });

    return {
      total: batchJobs.length,
      completed: batchJobs.filter((j) => j.status === 'completed').length,
      failed: batchJobs.filter((j) => j.status === 'failed').length,
      processing: batchJobs.filter((j) => j.status === 'processing').length,
      pending: batchJobs.filter((j) => j.status === 'pending' || j.status === 'queued').length,
    };
  }

  async getCompletedVariants(batchId: string): Promise<DbVideo[]> {
    const jobs = await this.supabase.listJobs({ type: 'variant' });
    const completedJobs = jobs.filter((job) => {
      const payload = job.input_payload as { batchId?: string };
      return payload?.batchId === batchId && job.status === 'completed';
    });

    const variants: DbVideo[] = [];
    for (const job of completedJobs) {
      const output = job.output_payload as { videoId?: string };
      if (output?.videoId) {
        const video = await this.supabase.getVideo(output.videoId);
        if (video) {
          variants.push(video);
        }
      }
    }

    return variants;
  }

  /**
   * Create a ZIP file containing all completed variants for a batch
   */
  async createBatchZip(batchId: string): Promise<{ zipUrl: string; expiresAt: Date }> {
    const metadata = this.batchMetadata.get(batchId);

    // Check if batch has expired
    if (metadata && metadata.expiresAt < new Date()) {
      throw new Error('Batch has expired');
    }

    // Check if ZIP already exists
    if (metadata?.zipUrl) {
      return { zipUrl: metadata.zipUrl, expiresAt: metadata.expiresAt };
    }

    const variants = await this.getCompletedVariants(batchId);
    if (variants.length === 0) {
      throw new Error('No completed variants found for this batch');
    }

    this.logger.log(`Creating ZIP for batch ${batchId} with ${variants.length} variants`);

    const zipFilename = `${batchId}.zip`;
    const zipPath = path.join(this.tempDir, zipFilename);

    // Create ZIP archive
    await this.createZipArchive(zipPath, variants);

    // Upload to Supabase Storage
    const zipBuffer = fs.readFileSync(zipPath);
    const storagePath = `batch-zips/${zipFilename}`;
    const { url: zipUrl } = await this.supabase.uploadFile(
      'variant-videos',
      storagePath,
      zipBuffer,
      'application/zip',
    );

    // Cleanup local temp file
    fs.unlinkSync(zipPath);

    // Update metadata with ZIP URL
    if (metadata) {
      metadata.zipUrl = zipUrl;
      this.batchMetadata.set(batchId, metadata);
    }

    const expiresAt = metadata?.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000);
    return { zipUrl, expiresAt };
  }

  /**
   * Get batch info including expiry
   */
  getBatchInfo(batchId: string): BatchMetadata | undefined {
    return this.batchMetadata.get(batchId);
  }

  /**
   * Cleanup expired batches - call this periodically
   */
  async cleanupExpiredBatches(): Promise<number> {
    const now = new Date();
    const expiredBatches: string[] = [];

    for (const [batchId, metadata] of this.batchMetadata.entries()) {
      if (metadata.expiresAt < now) {
        expiredBatches.push(batchId);
      }
    }

    this.logger.log(`Found ${expiredBatches.length} expired batches to cleanup`);

    for (const batchId of expiredBatches) {
      try {
        // Get all variants for this batch and delete them
        const variants = await this.getCompletedVariants(batchId);
        for (const variant of variants) {
          try {
            // Extract path from URL for deletion
            const urlParts = new URL(variant.file_url);
            const storagePath = urlParts.pathname.split('/storage/v1/object/public/variant-videos/')[1];
            if (storagePath) {
              await this.supabase.deleteFile('variant-videos', storagePath);
            }
            // Delete video record
            await this.supabase.deleteVideo(variant.id);
          } catch (err) {
            this.logger.warn(`Failed to delete variant ${variant.id}: ${err}`);
          }
        }

        // Delete ZIP file if exists
        const metadata = this.batchMetadata.get(batchId);
        if (metadata?.zipUrl) {
          try {
            const urlParts = new URL(metadata.zipUrl);
            const storagePath = urlParts.pathname.split('/storage/v1/object/public/variant-videos/')[1];
            if (storagePath) {
              await this.supabase.deleteFile('variant-videos', storagePath);
            }
          } catch (err) {
            this.logger.warn(`Failed to delete ZIP for batch ${batchId}: ${err}`);
          }
        }

        // Remove from metadata
        this.batchMetadata.delete(batchId);
        this.logger.log(`Cleaned up expired batch ${batchId}`);
      } catch (err) {
        this.logger.error(`Failed to cleanup batch ${batchId}: ${err}`);
      }
    }

    return expiredBatches.length;
  }

  /**
   * Create ZIP archive from variant videos
   */
  private createZipArchive(outputPath: string, variants: DbVideo[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip', { zlib: { level: 5 } });

      output.on('close', () => {
        this.logger.log(`ZIP created: ${archive.pointer()} bytes`);
        resolve();
      });

      archive.on('error', (err) => {
        reject(err);
      });

      archive.pipe(output);

      // Download each video and add to archive
      const downloadPromises = variants.map(async (variant, index) => {
        try {
          const buffer = await this.downloadFileToBuffer(variant.file_url);
          const filename = `variant-${index + 1}-${variant.name.replace(/[^a-zA-Z0-9.-]/g, '_')}.mp4`;
          archive.append(buffer, { name: filename });
        } catch (err) {
          this.logger.warn(`Failed to add variant ${variant.id} to ZIP: ${err}`);
        }
      });

      Promise.all(downloadPromises)
        .then(() => {
          archive.finalize();
        })
        .catch(reject);
    });
  }

  /**
   * Download a file to buffer
   */
  private downloadFileToBuffer(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;

      protocol.get(url, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            return this.downloadFileToBuffer(redirectUrl).then(resolve).catch(reject);
          }
        }

        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      }).on('error', reject);
    });
  }

  /**
   * Generate variants using round-robin assignment.
   * Each video gets paired with audio and hooks in rotation.
   */
  private generateRoundRobinVariants(
    videos: DbVideo[],
    audios: DbAudioFile[],
    hooks: DbHook[],
  ): VariantItem[] {
    const variants: VariantItem[] = [];

    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];

      // Round-robin audio selection
      const audio = audios.length > 0 ? audios[i % audios.length] : undefined;

      // Round-robin hook selection
      const hook = hooks.length > 0 ? hooks[i % hooks.length] : undefined;

      variants.push({ video, audio, hook });
    }

    return variants;
  }
}
