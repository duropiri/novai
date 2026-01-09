import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as ffmpeg from 'fluent-ffmpeg';
import { QUEUES } from '../queues.constants';
import { JobsService } from '../jobs.service';
import { SupabaseService, DbVideo, DbAudioFile, DbHook } from '../../files/supabase.service';

export interface VariantJobData {
  jobId: string;
  batchId: string;
  variantIndex: number;
  video: DbVideo;
  audio?: DbAudioFile;
  hook?: DbHook;
  hookDuration: number;
  hookPosition: 'top' | 'center' | 'bottom';
}

@Processor(QUEUES.VARIANT)
export class VariantProcessor extends WorkerHost {
  private readonly logger = new Logger(VariantProcessor.name);
  private readonly tempDir: string;

  constructor(
    private readonly jobsService: JobsService,
    private readonly supabase: SupabaseService,
  ) {
    super();
    this.tempDir = path.join(os.tmpdir(), 'novai-variants');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async process(job: Job<VariantJobData>): Promise<void> {
    const { jobId, batchId, variantIndex, video, audio, hook, hookDuration, hookPosition } =
      job.data;

    this.logger.log(`Processing variant ${variantIndex} for batch ${batchId}`);

    // Update job status to processing
    await this.jobsService.markJobProcessing(jobId);

    // Track temp files for cleanup
    const tempFiles: string[] = [];

    try {
      // Download video to temp file
      const videoTempPath = this.createTempFilePath('mp4');
      await this.downloadFile(video.file_url, videoTempPath);
      tempFiles.push(videoTempPath);

      // Download audio if provided
      let audioTempPath: string | undefined;
      if (audio) {
        audioTempPath = this.createTempFilePath('mp3');
        await this.downloadFile(audio.file_url, audioTempPath);
        tempFiles.push(audioTempPath);
      }

      // Create output path
      const outputPath = this.createTempFilePath('mp4');
      tempFiles.push(outputPath);

      // Process variant with FFmpeg
      await this.createVariant({
        videoPath: videoTempPath,
        audioPath: audioTempPath,
        hookText: hook?.text,
        outputPath,
        hookDuration,
        hookPosition,
      });

      // Upload result to storage
      const outputBuffer = fs.readFileSync(outputPath);
      const outputFilename = `variants/${batchId}/variant-${variantIndex}-${Date.now()}.mp4`;

      const { url: outputUrl } = await this.supabase.uploadFile(
        'variant-videos',
        outputFilename,
        outputBuffer,
        'video/mp4',
      );

      // Create video record for the variant
      const variantVideo = await this.supabase.createVideo({
        name: `${video.name} - Variant ${variantIndex + 1}`,
        type: 'variant',
        collection_id: null,
        parent_video_id: video.id,
        character_diagram_id: null,
        file_url: outputUrl,
        thumbnail_url: null,
        duration_seconds: video.duration_seconds,
        width: video.width,
        height: video.height,
        file_size_bytes: outputBuffer.length,
      });

      // Update job with success
      await this.jobsService.markJobCompleted(
        jobId,
        {
          videoId: variantVideo.id,
          outputUrl,
        },
        0, // No API cost for FFmpeg processing
      );

      this.logger.log(`Variant ${variantIndex} completed successfully`);
    } catch (error) {
      this.logger.error(`Failed to process variant ${variantIndex}: ${error}`);

      await this.jobsService.markJobFailed(
        jobId,
        error instanceof Error ? error.message : 'Unknown error',
      );

      throw error;
    } finally {
      // Cleanup temp files
      for (const tempFile of tempFiles) {
        this.cleanupTempFile(tempFile);
      }
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<VariantJobData>) {
    this.logger.log(`Variant job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<VariantJobData>, error: Error) {
    this.logger.error(`Variant job ${job.id} failed: ${error.message}`);
  }

  private createTempFilePath(extension: string): string {
    const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}.${extension}`;
    return path.join(this.tempDir, filename);
  }

  private cleanupTempFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        this.logger.debug(`Cleaned up temp file: ${filePath}`);
      }
    } catch (error) {
      this.logger.warn(`Failed to cleanup temp file: ${filePath}`);
    }
  }

  private createVariant(options: {
    videoPath: string;
    audioPath?: string;
    hookText?: string;
    outputPath: string;
    hookDuration: number;
    hookPosition: 'top' | 'center' | 'bottom';
  }): Promise<string> {
    const { videoPath, audioPath, hookText, outputPath, hookDuration, hookPosition } = options;

    return new Promise((resolve, reject) => {
      let command = ffmpeg(videoPath);

      // Add audio if provided
      if (audioPath) {
        command = command.addInput(audioPath);
      }

      // Build filter complex
      const filters: string[] = [];

      // Add text overlay if hook provided
      if (hookText) {
        const escapedText = hookText
          .replace(/'/g, "'\\''")
          .replace(/:/g, '\\:')
          .replace(/\\/g, '\\\\');

        const yPosition =
          hookPosition === 'top'
            ? '50'
            : hookPosition === 'center'
              ? '(h-text_h)/2'
              : 'h-text_h-50';

        let drawTextFilter = `drawtext=text='${escapedText}':fontsize=48:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=${yPosition}`;

        // Add timing if hookDuration specified
        if (hookDuration && hookDuration > 0) {
          drawTextFilter += `:enable='between(t,0,${hookDuration})'`;
        }

        filters.push(drawTextFilter);
      }

      // Apply filters
      if (filters.length > 0) {
        command = command.videoFilters(filters);
      }

      // Handle audio mapping
      if (audioPath) {
        command = command.outputOptions([
          '-map',
          '0:v', // Video from first input
          '-map',
          '1:a', // Audio from second input
          '-shortest', // End when shortest input ends
        ]);
      }

      // Output settings
      command
        .outputOptions([
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-crf',
          '23',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-movflags',
          '+faststart',
        ])
        .on('start', (cmd) => {
          this.logger.debug(`FFmpeg command: ${cmd}`);
        })
        .on('progress', (progress) => {
          this.logger.debug(`Processing: ${progress.percent?.toFixed(1)}%`);
        })
        .on('error', (err) => {
          this.logger.error(`FFmpeg error: ${err.message}`);
          reject(err);
        })
        .on('end', () => {
          this.logger.log(`Variant created: ${outputPath}`);
          resolve(outputPath);
        })
        .save(outputPath);
    });
  }

  private downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      const file = fs.createWriteStream(destPath);

      protocol
        .get(url, (response) => {
          // Handle redirects
          if (response.statusCode === 301 || response.statusCode === 302) {
            const redirectUrl = response.headers.location;
            if (redirectUrl) {
              file.close();
              return this.downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
            }
          }

          response.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        })
        .on('error', (err) => {
          fs.unlink(destPath, () => {}); // Delete partial file
          reject(err);
        });
    });
  }
}
