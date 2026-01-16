import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queues.constants';
import { FFmpegService } from '../../../services/ffmpeg.service';
import { GeminiService } from '../../../services/gemini.service';
import { SupabaseService } from '../../files/supabase.service';

interface ProcessScanVideoJob {
  sessionId: string;
  videoUrl: string;
  verificationNumbers: string[];
}

interface FaceAngleAnalysis {
  frameIndex: number;
  frameUrl: string;
  angle: string;
  confidence: number;
  quality: number;
  expression?: string;
}

@Processor(QUEUES.SCAN_VIDEO)
export class ScanProcessor extends WorkerHost {
  private readonly logger = new Logger(ScanProcessor.name);

  constructor(
    private readonly ffmpeg: FFmpegService,
    private readonly gemini: GeminiService,
    private readonly supabase: SupabaseService,
  ) {
    super();
  }

  async process(job: Job<ProcessScanVideoJob>): Promise<FaceAngleAnalysis[]> {
    const { sessionId, videoUrl, verificationNumbers } = job.data;

    this.logger.log(`Processing scan video for session ${sessionId}`);
    await job.updateProgress(5);

    try {
      // Step 1: Get video info
      const videoInfo = await this.ffmpeg.getVideoInfo(videoUrl);
      this.logger.log(`Video info: ${JSON.stringify(videoInfo)}`);
      await job.updateProgress(10);

      // Step 2: Upscale video and extract frames at 4 FPS for full 3D face coverage
      // For a 26-second video (8s numbers + 6*3s poses), this gives ~104 frames
      // More frames = better angle coverage for training quality LoRAs
      const framesPerSecond = 4;
      const frameInterval = Math.round(videoInfo.fps / framesPerSecond);

      this.logger.log(`Upscaling and extracting frames every ${frameInterval} frames (${framesPerSecond} fps)...`);
      const frameUrls = await this.ffmpeg.extractFrames(
        videoUrl,
        {
          interval: frameInterval,
          upscale: true, // Upscale for higher quality frames
          targetResolution: 1080, // Target 1080p for face scans
        },
        `scan-frames/${sessionId}`,
      );
      this.logger.log(`Extracted ${frameUrls.length} frames`);
      await job.updateProgress(40);

      // Step 3: Analyze frames with Gemini for face angles and quality
      const analyzedFrames = await this.analyzeFramesWithGemini(frameUrls, job);
      this.logger.log(`Analyzed ${analyzedFrames.length} frames with faces`);
      await job.updateProgress(80);

      // Step 4: Select best frames for each angle
      const selectedFrames = this.selectBestFrames(analyzedFrames);
      this.logger.log(`Selected ${selectedFrames.length} best frames`);

      // Step 5: Save captures to database
      await this.saveCaptures(sessionId, selectedFrames);
      await job.updateProgress(100);

      this.logger.log(`Scan video processing complete for session ${sessionId}`);
      return selectedFrames;
    } catch (error) {
      this.logger.error(`Failed to process scan video: ${error}`);
      throw error;
    }
  }

  /**
   * Analyze frames using Gemini Vision to detect face angles and quality
   */
  private async analyzeFramesWithGemini(
    frameUrls: string[],
    job: Job,
  ): Promise<FaceAngleAnalysis[]> {
    const results: FaceAngleAnalysis[] = [];
    const BATCH_SIZE = 5;

    for (let i = 0; i < frameUrls.length; i += BATCH_SIZE) {
      const batch = frameUrls.slice(i, Math.min(i + BATCH_SIZE, frameUrls.length));

      const batchPromises = batch.map(async (frameUrl, batchIdx) => {
        const frameIndex = i + batchIdx;
        try {
          const analysis = await this.analyzeFrameWithGemini(frameUrl, frameIndex);
          if (analysis) {
            return analysis;
          }
        } catch (error) {
          this.logger.warn(`Failed to analyze frame ${frameIndex}: ${error}`);
        }
        return null;
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults.filter((r): r is FaceAngleAnalysis => r !== null));

      // Update progress
      const progressPct = 40 + Math.round((i / frameUrls.length) * 40);
      await job.updateProgress(progressPct);
    }

    return results;
  }

  /**
   * Analyze a single frame with Gemini
   */
  private async analyzeFrameWithGemini(
    frameUrl: string,
    frameIndex: number,
  ): Promise<FaceAngleAnalysis | null> {
    const prompt = `Analyze this image for face detection and pose estimation.

Return ONLY a JSON object with:
{
  "hasFace": boolean,
  "angle": "front" | "quarter_left" | "quarter_right" | "profile_left" | "profile_right" | "up" | "down",
  "confidence": number (0-1, how confident in the angle detection),
  "quality": number (0-1, image quality - sharpness, lighting, face visibility),
  "expression": "neutral" | "smile" | "surprised" | "serious" | "other"
}

Angle definitions:
- "front": Face looking directly at camera
- "quarter_left": Face turned ~45° to their left (camera's right)
- "quarter_right": Face turned ~45° to their right (camera's left)
- "profile_left": Face turned ~90° showing left profile
- "profile_right": Face turned ~90° showing right profile
- "up": Face tilted up, chin raised
- "down": Face tilted down, looking down

Be precise about the angle. Only return valid JSON.`;

    try {
      const response = await this.gemini.analyzeImageStructured(frameUrl, prompt);

      // Parse JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return null;
      }

      const analysis = JSON.parse(jsonMatch[0]);

      if (!analysis.hasFace) {
        return null;
      }

      return {
        frameIndex,
        frameUrl,
        angle: analysis.angle || 'front',
        confidence: analysis.confidence || 0.5,
        quality: analysis.quality || 0.5,
        expression: analysis.expression,
      };
    } catch (error) {
      this.logger.warn(`Gemini analysis failed for frame ${frameIndex}: ${error}`);
      return null;
    }
  }

  /**
   * Select best frames for each angle category
   */
  private selectBestFrames(frames: FaceAngleAnalysis[]): FaceAngleAnalysis[] {
    const angleGroups = new Map<string, FaceAngleAnalysis[]>();

    // Group frames by angle
    for (const frame of frames) {
      const group = angleGroups.get(frame.angle) || [];
      group.push(frame);
      angleGroups.set(frame.angle, group);
    }

    const selected: FaceAngleAnalysis[] = [];

    // Select best 3-5 frames for each angle for full 3D coverage
    for (const [angle, group] of angleGroups) {
      // Sort by combined score (quality + confidence)
      const sorted = group.sort((a, b) => {
        const scoreA = a.quality * 0.6 + a.confidence * 0.4;
        const scoreB = b.quality * 0.6 + b.confidence * 0.4;
        return scoreB - scoreA;
      });

      // Take more frames for better 3D coverage
      // Front: 5 frames (most important for identity)
      // Quarter views: 4 frames each (capture subtle angle variations)
      // Profiles: 3 frames each (side views)
      // Up/Down: 2 frames each (less critical but useful)
      const count = angle === 'front' ? 5 :
                   angle.includes('quarter') ? 4 :
                   angle.includes('profile') ? 3 : 2;

      selected.push(...sorted.slice(0, count));
    }

    // Also include some expression variations if available
    const expressions = ['smile', 'neutral', 'serious'];
    for (const expr of expressions) {
      const exprFrame = frames.find(
        f => f.expression === expr && !selected.includes(f)
      );
      if (exprFrame) {
        selected.push(exprFrame);
      }
    }

    return selected;
  }

  /**
   * Save analyzed captures to database
   */
  private async saveCaptures(
    sessionId: string,
    frames: FaceAngleAnalysis[],
  ): Promise<void> {
    const capturedAngles: Record<string, { url: string; quality: number }> = {};

    for (const frame of frames) {
      // Insert capture record
      await this.supabase.getClient()
        .from('phone_scan_captures')
        .insert({
          session_id: sessionId,
          image_url: frame.frameUrl,
          detected_angle: frame.angle,
          quality_score: frame.quality,
          face_confidence: frame.confidence,
          is_selected: true, // Auto-select the best frames
          is_auto_captured: true,
        });

      // Track best capture for each angle
      if (!capturedAngles[frame.angle] || capturedAngles[frame.angle].quality < frame.quality) {
        capturedAngles[frame.angle] = {
          url: frame.frameUrl,
          quality: frame.quality,
        };
      }
    }

    // Update session with captured angles
    await this.supabase.getClient()
      .from('phone_scan_sessions')
      .update({
        captured_angles: capturedAngles,
        total_captures: frames.length,
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', sessionId);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Scan video job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Scan video job ${job.id} failed: ${error.message}`);
  }
}
