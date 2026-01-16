import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SupabaseService } from '../modules/files/supabase.service';

const execAsync = promisify(exec);

export interface VideoInfo {
  fps: number;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  frameCount: number;
}

export interface ExtractFramesOptions {
  interval?: number; // Extract every Nth frame (default: 1 = every frame)
  count?: number; // Extract exactly N frames evenly spaced
  startTime?: number; // Start extraction at this second
  endTime?: number; // End extraction at this second
}

export interface AssembleFramesOptions {
  fps: number;
  audioUrl?: string;
  outputFormat?: 'mp4' | 'webm';
}

@Injectable()
export class FFmpegService {
  private readonly logger = new Logger(FFmpegService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Get video information (fps, duration, dimensions, audio)
   */
  async getVideoInfo(videoUrl: string): Promise<VideoInfo> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-info-'));

    try {
      const videoPath = path.join(tempDir, 'input.mp4');
      await this.downloadFile(videoUrl, videoPath);

      // Get video stream info
      const { stdout: videoInfo } = await execAsync(
        `ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate,duration,width,height,nb_frames -of json "${videoPath}"`,
      );

      // Get audio stream info
      const { stdout: audioInfo } = await execAsync(
        `ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of csv=p=0 "${videoPath}"`,
      ).catch(() => ({ stdout: '' }));

      const parsed = JSON.parse(videoInfo);
      const stream = parsed.streams?.[0] || {};

      // Parse frame rate (format: "30/1" or "30000/1001")
      const [fpsNum, fpsDen] = (stream.r_frame_rate || '30/1').split('/').map(Number);
      const fps = Math.round(fpsNum / (fpsDen || 1));

      const duration = parseFloat(stream.duration) || 0;
      const width = parseInt(stream.width, 10) || 0;
      const height = parseInt(stream.height, 10) || 0;
      const frameCount = parseInt(stream.nb_frames, 10) || Math.round(fps * duration);
      const hasAudio = audioInfo.trim() === 'audio';

      return { fps, duration, width, height, hasAudio, frameCount };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Extract frames from video
   * Returns array of uploaded frame URLs
   */
  async extractFrames(
    videoUrl: string,
    options: ExtractFramesOptions = {},
    uploadPrefix: string,
  ): Promise<string[]> {
    const { interval = 1, count, startTime = 0, endTime } = options;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-extract-'));

    try {
      const videoPath = path.join(tempDir, 'input.mp4');
      await this.downloadFile(videoUrl, videoPath);

      const videoInfo = await this.getVideoInfo(videoUrl);
      const { fps, duration } = videoInfo;

      // Calculate extraction parameters
      const effectiveEnd = endTime !== undefined ? Math.min(endTime, duration) : duration;
      const effectiveStart = Math.max(0, startTime);
      const segmentDuration = effectiveEnd - effectiveStart;

      let ffmpegFilter: string;
      let expectedFrameCount: number;

      if (count !== undefined) {
        // Extract exactly N frames evenly spaced
        const frameInterval = segmentDuration / count;
        ffmpegFilter = `fps=1/${frameInterval}`;
        expectedFrameCount = count;
      } else {
        // Extract every Nth frame
        ffmpegFilter = `select=not(mod(n\\,${interval}))`;
        expectedFrameCount = Math.floor((fps * segmentDuration) / interval);
      }

      this.logger.log(`Extracting ~${expectedFrameCount} frames from video`);

      const framesDir = path.join(tempDir, 'frames');
      await fs.mkdir(framesDir, { recursive: true });

      // Build ffmpeg command
      let cmd = `ffmpeg -i "${videoPath}"`;
      if (effectiveStart > 0) {
        cmd += ` -ss ${effectiveStart}`;
      }
      if (endTime !== undefined) {
        cmd += ` -t ${segmentDuration}`;
      }
      cmd += ` -vf "${ffmpegFilter}" -vsync vfr "${framesDir}/frame_%05d.png"`;

      await execAsync(cmd);

      // Get list of extracted frames
      const frameFiles = await fs.readdir(framesDir);
      const sortedFrames = frameFiles.filter((f) => f.endsWith('.png')).sort();

      this.logger.log(`Extracted ${sortedFrames.length} frames`);

      // Upload frames in parallel batches for faster processing
      const BATCH_SIZE = 10;
      const frameUrls: string[] = new Array(sortedFrames.length);

      for (let batchStart = 0; batchStart < sortedFrames.length; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, sortedFrames.length);
        const batchPromises = [];

        for (let i = batchStart; i < batchEnd; i++) {
          const framePath = path.join(framesDir, sortedFrames[i]);
          const uploadPath = `${uploadPrefix}/frame_${String(i).padStart(5, '0')}.png`;

          batchPromises.push(
            fs.readFile(framePath).then(async (frameBuffer) => {
              const { url } = await this.supabase.uploadFile(
                'processed-videos',
                uploadPath,
                frameBuffer,
                'image/png',
              );
              frameUrls[i] = url;
            })
          );
        }

        await Promise.all(batchPromises);
        this.logger.log(`Uploaded ${batchEnd}/${sortedFrames.length} frames`);
      }

      return frameUrls;
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Assemble frames into video
   * Takes array of frame URLs and creates a video
   */
  async assembleFrames(
    frameUrls: string[],
    options: AssembleFramesOptions,
    uploadPrefix: string,
  ): Promise<string> {
    const { fps, audioUrl, outputFormat = 'mp4' } = options;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-assemble-'));

    try {
      const framesDir = path.join(tempDir, 'frames');
      await fs.mkdir(framesDir, { recursive: true });

      // Download frames in parallel batches for faster processing
      // Use downloadImageAsPng to handle JPEG images returned by face swap services
      const BATCH_SIZE = 10;
      this.logger.log(`Downloading ${frameUrls.length} frames...`);

      for (let batchStart = 0; batchStart < frameUrls.length; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, frameUrls.length);
        const batchPromises = [];

        for (let i = batchStart; i < batchEnd; i++) {
          const framePath = path.join(framesDir, `frame_${String(i).padStart(5, '0')}.png`);
          batchPromises.push(this.downloadImageAsPng(frameUrls[i], framePath));
        }

        await Promise.all(batchPromises);
        this.logger.log(`Downloaded ${batchEnd}/${frameUrls.length} frames`);
      }

      // Build ffmpeg command
      const outputPath = path.join(tempDir, `output.${outputFormat}`);
      let cmd = `ffmpeg -framerate ${fps} -i "${framesDir}/frame_%05d.png"`;

      if (audioUrl) {
        const audioPath = path.join(tempDir, 'audio.aac');
        await this.downloadFile(audioUrl, audioPath);
        cmd += ` -i "${audioPath}" -c:a aac -b:a 128k -map 0:v:0 -map 1:a:0 -shortest`;
      }

      cmd += ` -c:v libx264 -pix_fmt yuv420p -crf 23 -preset medium -y "${outputPath}"`;

      this.logger.log('Assembling frames into video...');
      await execAsync(cmd);

      // Upload the assembled video
      const outputBuffer = await fs.readFile(outputPath);
      const uploadPath = `${uploadPrefix}/assembled_${Date.now()}.${outputFormat}`;
      const { url } = await this.supabase.uploadFile(
        'processed-videos',
        uploadPath,
        outputBuffer,
        `video/${outputFormat}`,
      );

      this.logger.log(`Video assembled and uploaded: ${url}`);
      return url;
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Extract audio from video
   * Returns URL of extracted audio file
   */
  async extractAudio(videoUrl: string, uploadPrefix: string): Promise<string | null> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-audio-'));

    try {
      const videoPath = path.join(tempDir, 'input.mp4');
      await this.downloadFile(videoUrl, videoPath);

      // Check if video has audio
      const { stdout: audioCheck } = await execAsync(
        `ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of csv=p=0 "${videoPath}"`,
      ).catch(() => ({ stdout: '' }));

      if (audioCheck.trim() !== 'audio') {
        this.logger.log('Video has no audio track');
        return null;
      }

      // Extract audio
      const audioPath = path.join(tempDir, 'audio.aac');
      await execAsync(`ffmpeg -i "${videoPath}" -vn -acodec aac -b:a 128k -y "${audioPath}"`);

      // Upload audio
      const audioBuffer = await fs.readFile(audioPath);
      const uploadPath = `${uploadPrefix}/audio_${Date.now()}.aac`;
      const { url } = await this.supabase.uploadFile(
        'processed-videos',
        uploadPath,
        audioBuffer,
        'audio/aac',
      );

      this.logger.log(`Audio extracted and uploaded: ${url}`);
      return url;
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Merge audio with video
   * Returns URL of merged video
   */
  async mergeAudio(
    videoUrl: string,
    audioUrl: string,
    uploadPrefix: string,
  ): Promise<string> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-merge-'));

    try {
      const videoPath = path.join(tempDir, 'video.mp4');
      const audioPath = path.join(tempDir, 'audio.aac');
      const outputPath = path.join(tempDir, 'merged.mp4');

      await this.downloadFile(videoUrl, videoPath);
      await this.downloadFile(audioUrl, audioPath);

      // Get video duration
      const { stdout: videoDur } = await execAsync(
        `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`,
      );
      const duration = parseFloat(videoDur.trim()) || 5;

      // Merge with shortest flag and duration limit
      await execAsync(
        `ffmpeg -i "${videoPath}" -i "${audioPath}" -c:v copy -c:a aac -b:a 128k -map 0:v:0 -map 1:a:0 -shortest -t ${duration} -y "${outputPath}"`,
      );

      // Upload merged video
      const outputBuffer = await fs.readFile(outputPath);
      const uploadPath = `${uploadPrefix}/merged_${Date.now()}.mp4`;
      const { url } = await this.supabase.uploadFile(
        'processed-videos',
        uploadPath,
        outputBuffer,
        'video/mp4',
      );

      this.logger.log(`Audio merged and uploaded: ${url}`);
      return url;
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Create a ZIP file from frame URLs (for LoRA training)
   * Returns URL of the uploaded ZIP
   */
  async createTrainingZip(frameUrls: string[], uploadPrefix: string): Promise<string> {
    const archiver = await import('archiver');
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-zip-'));

    try {
      const framesDir = path.join(tempDir, 'frames');
      await fs.mkdir(framesDir, { recursive: true });

      // Download frames (convert to PNG if needed)
      for (let i = 0; i < frameUrls.length; i++) {
        const framePath = path.join(framesDir, `${String(i).padStart(3, '0')}.png`);
        await this.downloadImageAsPng(frameUrls[i], framePath);
      }

      // Create ZIP
      const zipPath = path.join(tempDir, 'training_images.zip');
      const output = (await import('fs')).createWriteStream(zipPath);
      const archive = archiver.default('zip', { zlib: { level: 5 } });

      await new Promise<void>((resolve, reject) => {
        output.on('close', resolve);
        archive.on('error', reject);
        archive.pipe(output);
        archive.directory(framesDir, false);
        archive.finalize();
      });

      // Upload ZIP
      const zipBuffer = await fs.readFile(zipPath);
      const uploadPath = `${uploadPrefix}/training_images_${Date.now()}.zip`;
      const { url } = await this.supabase.uploadFile(
        'lora-training',
        uploadPath,
        zipBuffer,
        'application/zip',
      );

      this.logger.log(`Training ZIP created and uploaded: ${url}`);
      return url;
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Download file from URL to local path
   */
  private async downloadFile(url: string, destPath: string): Promise<void> {
    // Handle data URLs
    if (url.startsWith('data:')) {
      const base64Data = url.split(',')[1];
      await fs.writeFile(destPath, Buffer.from(base64Data, 'base64'));
      return;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(destPath, Buffer.from(arrayBuffer));
  }

  /**
   * Download image and convert to PNG if needed
   * Handles JPEG images that need to be saved as PNG for ffmpeg
   */
  private async downloadImageAsPng(url: string, destPath: string): Promise<void> {
    // Handle data URLs
    if (url.startsWith('data:')) {
      const base64Data = url.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');

      // Check if it's already PNG
      if (this.isPngBuffer(buffer)) {
        await fs.writeFile(destPath, buffer);
        return;
      }

      // Convert to PNG using ffmpeg
      const tempPath = destPath.replace('.png', '_temp.jpg');
      await fs.writeFile(tempPath, buffer);
      await execAsync(`ffmpeg -i "${tempPath}" -y "${destPath}"`);
      await fs.unlink(tempPath).catch(() => {});
      return;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Check if it's already PNG (magic bytes: 89 50 4E 47)
    if (this.isPngBuffer(buffer)) {
      await fs.writeFile(destPath, buffer);
      return;
    }

    // It's likely JPEG or another format - convert to PNG using ffmpeg
    const tempPath = destPath.replace('.png', '_temp.jpg');
    await fs.writeFile(tempPath, buffer);
    await execAsync(`ffmpeg -i "${tempPath}" -y "${destPath}"`);
    await fs.unlink(tempPath).catch(() => {});
  }

  /**
   * Check if buffer is PNG format by magic bytes
   */
  private isPngBuffer(buffer: Buffer): boolean {
    // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
    return buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4E &&
      buffer[3] === 0x47;
  }
}
