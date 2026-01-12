import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queues.constants';
import { JobsService } from '../jobs.service';
import { FalService } from '../../../services/fal.service';
import { SupabaseService } from '../../files/supabase.service';

interface FaceSwapJobData {
  jobId: string;
  videoId: string;
  videoUrl: string;
  faceImageUrl: string;
  characterDiagramId: string;
  loraId?: string;
  durationSeconds?: number;
  swapMethod?: 'kling' | 'wan_replace';
  // WAN settings
  resolution?: '480p' | '580p' | '720p';
  videoQuality?: 'low' | 'medium' | 'high' | 'maximum';
  useTurbo?: boolean;
  inferenceSteps?: number;
}

// Face swap pricing per frame (in cents)
const FACE_SWAP_COST_PER_FRAME = 0.5; // $0.005/frame

// WAN pricing per second by resolution
const WAN_COST_PER_SECOND: Record<string, number> = {
  '480p': 4, // $0.04/second = 4 cents
  '580p': 6, // $0.06/second = 6 cents
  '720p': 8, // $0.08/second = 8 cents
};

// Maximum time to wait for a face swap job (30 minutes)
const MAX_JOB_DURATION_MS = 30 * 60 * 1000;

// Timeout error class for identification
class JobTimeoutError extends Error {
  constructor(durationMs: number) {
    super(`Job timed out after ${Math.round(durationMs / 60000)} minutes`);
    this.name = 'JobTimeoutError';
  }
}

@Processor(QUEUES.FACE_SWAP)
export class FaceSwapProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(FaceSwapProcessor.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly falService: FalService,
    private readonly supabase: SupabaseService,
  ) {
    super();
  }

  onModuleInit() {
    this.logger.log('=== FaceSwapProcessor initialized ===');
    this.logger.log(`Queue name: ${QUEUES.FACE_SWAP}`);
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.log(`Job ${job.id} is now active`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} failed: ${error.message}`);
  }

  @OnWorkerEvent('error')
  onError(error: Error) {
    this.logger.error(`Worker error: ${error.message}`);
  }

  async process(job: Job<FaceSwapJobData>): Promise<void> {
    this.logger.log('=== FACE SWAP JOB STARTED ===');
    this.logger.log(`BullMQ Job ID: ${job.id}, Job Name: ${job.name}`);
    this.logger.log(`Raw job.data: ${JSON.stringify(job.data, null, 2)}`);

    const { jobId } = job.data;

    // CRITICAL: Validate jobId is present - this was causing "stuck" jobs
    if (!jobId) {
      const errorMsg = `FATAL: jobId is undefined in job data! BullMQ job ID: ${job.id}, name: ${job.name}. This indicates the job was enqueued without proper data.`;
      this.logger.error(errorMsg);
      this.logger.error(`Full job.data keys: ${Object.keys(job.data).join(', ')}`);
      throw new Error(errorMsg);
    }

    if (jobId === 'undefined' || typeof jobId !== 'string') {
      const errorMsg = `FATAL: jobId has invalid value: "${jobId}" (type: ${typeof jobId}). BullMQ job ID: ${job.id}`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    this.logger.log(`=== VALIDATED: jobId = ${jobId} ===`);

    // Route based on job name
    if (job.name === 'kling-motion') {
      return this.processKlingMotion(job);
    }
    // Default to WAN replace (handles 'wan-replace' and legacy 'swap')
    return this.processWanReplace(job);
  }

  /**
   * WAN Animate Replace - generates new video with character
   */
  private async processWanReplace(job: Job<FaceSwapJobData>): Promise<void> {
    // CRITICAL: Capture jobId at method start and verify
    const jobId = job.data.jobId;
    this.logger.log(`=== processWanReplace ENTRY ===`);
    this.logger.log(`jobId at method entry: "${jobId}" (type: ${typeof jobId})`);

    if (!jobId || jobId === 'undefined') {
      const errorMsg = `FATAL: jobId invalid at processWanReplace entry: "${jobId}"`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    const {
      videoId,
      videoUrl,
      faceImageUrl,
      characterDiagramId,
      loraId,
      durationSeconds = 10,
      resolution = '720p',
      videoQuality = 'high',
      useTurbo = true,
      inferenceSteps = 20,
    } = job.data;

    try {
      this.logger.log(`[${jobId}] Calling markJobProcessing...`);
      await this.jobsService.markJobProcessing(jobId);
      this.logger.log(`[${jobId}] markJobProcessing completed`);
      await this.supabase.updateJob(jobId, { progress: 10 });

      this.logger.log(`Processing WAN Animate Replace for job ${jobId}`, {
        videoUrl,
        faceImageUrl,
        resolution,
        videoQuality,
        useTurbo,
        inferenceSteps,
      });

      let lastProgress = 10;
      const startTime = Date.now();
      let capturedRequestId: string | undefined;

      // Run WAN Animate Replace with timeout protection
      const falPromise = this.falService.runWanAnimateReplace({
        video_url: videoUrl,
        image_url: faceImageUrl,
        resolution,
        video_quality: videoQuality,
        use_turbo: useTurbo,
        num_inference_steps: inferenceSteps,
        onProgress: async (status) => {
          // Check for timeout during progress updates
          const elapsed = Date.now() - startTime;
          if (elapsed > MAX_JOB_DURATION_MS) {
            this.logger.warn(`Job ${jobId} exceeded timeout during progress callback (${Math.round(elapsed / 60000)} min)`);
            return;
          }

          // Capture request_id from fal.ai
          if (status.request_id && status.request_id !== capturedRequestId) {
            capturedRequestId = status.request_id;
            this.logger.log(`=== CAPTURED FAL.AI REQUEST_ID: ${capturedRequestId} ===`);
            // Save to database immediately for dashboard debugging
            await this.supabase.updateJob(jobId, {
              external_request_id: capturedRequestId,
            });
          }

          // Update progress based on status
          if (status.status === 'SUBMITTED') {
            await this.supabase.updateJob(jobId, {
              progress: 15,
              external_status: status.status,
            });
            this.logger.log(`Job ${jobId}: SUBMITTED to fal.ai, request_id: ${capturedRequestId}`);
          } else if (status.status === 'IN_PROGRESS' && lastProgress < 85) {
            lastProgress = Math.min(85, lastProgress + 5);
            await this.supabase.updateJob(jobId, {
              progress: lastProgress,
              external_status: status.status,
            });
            this.logger.log(`Job ${jobId}: ${status.status} - ${lastProgress}% (${Math.round(elapsed / 1000)}s elapsed)`);
          } else if (status.status === 'IN_QUEUE') {
            await this.supabase.updateJob(jobId, {
              external_status: status.status,
              progress: 20,
            });
            this.logger.log(`Job ${jobId}: IN_QUEUE (${Math.round(elapsed / 1000)}s elapsed)`);
          }

          if (status.logs?.length) {
            const lastLog = status.logs[status.logs.length - 1];
            this.logger.log(`WAN log: ${lastLog.message}`);
          }
        },
      });

      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new JobTimeoutError(MAX_JOB_DURATION_MS));
        }, MAX_JOB_DURATION_MS);
      });

      // Race between the actual job and the timeout
      this.logger.log(`[${jobId}] Awaiting fal.ai result (Promise.race with ${MAX_JOB_DURATION_MS/60000} min timeout)...`);
      const result = await Promise.race([falPromise, timeoutPromise]);

      // CRITICAL CHECKPOINT: Verify jobId still valid after async operation
      this.logger.log(`=== FAL.AI RESULT RECEIVED ===`);
      this.logger.log(`jobId after fal.ai: "${jobId}" (type: ${typeof jobId})`);
      if (!jobId || jobId === 'undefined') {
        this.logger.error(`CRITICAL: jobId became invalid after fal.ai call!`);
        throw new Error('jobId lost during fal.ai processing');
      }

      // DEBUG: Log full fal.ai response
      this.logger.log(`[${jobId}] FAL.AI RESULT:`);
      this.logger.log(JSON.stringify(result, null, 2));

      if (!result.video?.url) {
        this.logger.error(`Job ${jobId}: fal.ai returned success but no video URL!`);
        this.logger.error(`Result structure: ${JSON.stringify(Object.keys(result))}`);
        throw new Error('WAN Animate Replace completed but no result URL provided');
      }

      this.logger.log(`WAN Animate Replace completed for job ${jobId}`, {
        resultUrl: result.video.url,
      });

      // DEBUG: Update to 90% and verify
      this.logger.log(`Job ${jobId}: Updating progress to 90%...`);
      try {
        const updated90 = await this.supabase.updateJob(jobId, { progress: 90 });
        this.logger.log(`Job ${jobId}: Progress update result - status: ${updated90.status}, progress: ${updated90.progress}`);
      } catch (progressError) {
        this.logger.error(`Job ${jobId}: FAILED to update progress to 90%:`, progressError);
        throw progressError;
      }

      // Download the result video
      this.logger.log(`Job ${jobId}: Downloading video from fal.ai URL...`);
      let videoBuffer: Buffer;
      try {
        videoBuffer = await this.downloadBuffer(result.video.url);
        this.logger.log(`Job ${jobId}: Downloaded ${videoBuffer.length} bytes`);
      } catch (downloadError) {
        this.logger.error(`Job ${jobId}: FAILED to download video from ${result.video.url}:`, downloadError);
        // Save the fal.ai URL so user can retrieve manually
        await this.supabase.updateJob(jobId, {
          output_payload: { falVideoUrl: result.video.url, downloadFailed: true },
        });
        throw downloadError;
      }

      // Upload to Supabase storage
      this.logger.log(`Job ${jobId}: Uploading to Supabase storage...`);
      const filePath = `${videoId}/swapped_${Date.now()}.mp4`;
      let outputUrl: string;
      try {
        const uploadResult = await this.supabase.uploadFile(
          'processed-videos',
          filePath,
          videoBuffer,
          'video/mp4',
        );
        outputUrl = uploadResult.url;
        this.logger.log(`Job ${jobId}: Uploaded to ${outputUrl}`);
      } catch (uploadError) {
        this.logger.error(`Job ${jobId}: FAILED to upload to Supabase:`, uploadError);
        // Save the fal.ai URL so user can retrieve manually
        await this.supabase.updateJob(jobId, {
          output_payload: { falVideoUrl: result.video.url, uploadFailed: true },
        });
        throw uploadError;
      }

      // Create video record
      this.logger.log(`Job ${jobId}: Creating video record...`);
      let swappedVideo;
      try {
        swappedVideo = await this.supabase.createVideo({
          name: `AI Swap - ${new Date().toLocaleString()}`,
          type: 'face_swapped',
          parent_video_id: videoId,
          character_diagram_id: characterDiagramId,
          file_url: outputUrl,
          duration_seconds: durationSeconds,
          collection_id: null,
          thumbnail_url: null,
          width: null,
          height: null,
          file_size_bytes: videoBuffer.length,
        });
        this.logger.log(`Job ${jobId}: Created video record ${swappedVideo.id}`);
      } catch (createVideoError) {
        this.logger.error(`Job ${jobId}: FAILED to create video record:`, createVideoError);
        // Save both URLs so user can retrieve manually
        await this.supabase.updateJob(jobId, {
          output_payload: { falVideoUrl: result.video.url, supabaseUrl: outputUrl, createVideoFailed: true },
        });
        throw createVideoError;
      }

      // Calculate cost based on resolution and duration
      const costPerSecond = WAN_COST_PER_SECOND[resolution] || 8;
      const costCents = Math.ceil(durationSeconds * costPerSecond);

      // CRITICAL: Re-validate jobId before completion (catches any corruption during processing)
      if (!jobId || jobId === 'undefined') {
        this.logger.error(`FATAL: jobId became invalid before completion! Was: "${jobId}"`);
        throw new Error(`jobId became invalid before completion: ${jobId}`);
      }
      this.logger.log(`=== MARKING JOB COMPLETED: jobId=${jobId} ===`);

      // Mark job completed
      this.logger.log(`Job ${jobId}: Marking job as completed...`);
      try {
        const completedJob = await this.jobsService.markJobCompleted(
          jobId,
          {
            outputVideoId: swappedVideo.id,
            outputUrl,
            loraId,
            characterDiagramId,
            resolution,
          },
          costCents,
        );
        this.logger.log(`Job ${jobId}: markJobCompleted returned - status: ${completedJob.status}, progress: ${completedJob.progress}`);

        // DEBUG: Query back to verify it actually saved
        const verifyJob = await this.jobsService.getJob(jobId);
        this.logger.log(`Job ${jobId}: VERIFICATION - status: ${verifyJob?.status}, progress: ${verifyJob?.progress}`);
        if (verifyJob?.status !== 'completed') {
          this.logger.error(`Job ${jobId}: STATUS MISMATCH! Expected 'completed' but got '${verifyJob?.status}'`);
        }
      } catch (completionError) {
        this.logger.error(`Job ${jobId}: FAILED to mark job completed:`, completionError);
        throw completionError;
      }

      this.logger.log(`Face swap job ${jobId} completed successfully`, {
        swappedVideoId: swappedVideo.id,
        costCents,
      });
    } catch (error) {
      this.logger.error(`=== EXCEPTION CAUGHT IN processWanReplace ===`);
      this.logger.error(`jobId at catch: "${jobId}" (type: ${typeof jobId})`);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : '';
      this.logger.error(`Failed face swap job ${jobId}: ${errorMessage}`);
      this.logger.error(`Stack trace: ${errorStack}`);

      // Log current job state for debugging
      try {
        const currentJob = await this.jobsService.getJob(jobId);
        this.logger.error(`Job ${jobId} final state: status=${currentJob?.status}, progress=${currentJob?.progress}`);
      } catch (queryError) {
        this.logger.error(`Could not query job state: ${queryError}`);
      }

      await this.jobsService.markJobFailed(jobId, errorMessage);
      throw error;
    }
  }

  /**
   * Kling Motion Control method - face swap first frame, then apply motion
   * Higher quality and more reliable than WAN direct
   */
  private async processKlingMotion(job: Job<FaceSwapJobData>): Promise<void> {
    const jobId = job.data.jobId;
    this.logger.log(`=== processKlingMotion ENTRY ===`);
    this.logger.log(`jobId at method entry: "${jobId}" (type: ${typeof jobId})`);

    if (!jobId || jobId === 'undefined') {
      const errorMsg = `FATAL: jobId invalid at processKlingMotion entry: "${jobId}"`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    const {
      videoId,
      videoUrl,
      faceImageUrl,
      characterDiagramId,
      loraId,
      durationSeconds = 10,
    } = job.data;

    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    // Create temp directory
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kling-swap-'));
    this.logger.log(`[${jobId}] Created temp directory: ${tempDir}`);

    try {
      await this.jobsService.markJobProcessing(jobId);
      await this.supabase.updateJob(jobId, { progress: 5 });

      this.logger.log(`[${jobId}] Kling Motion Control method started`);
      this.logger.log(`[${jobId}] Video URL: ${videoUrl}`);
      this.logger.log(`[${jobId}] Face Image URL: ${faceImageUrl}`);

      // Step 1: Download source video and extract first frame
      this.logger.log(`[${jobId}] Step 1: Downloading video and extracting first frame...`);
      await this.supabase.updateJob(jobId, { progress: 10, external_status: 'EXTRACTING_FRAME' });

      const videoBuffer = await this.downloadBuffer(videoUrl);
      const inputVideoPath = path.join(tempDir, 'input.mp4');
      await fs.writeFile(inputVideoPath, videoBuffer);

      const firstFramePath = path.join(tempDir, 'first_frame.png');
      await execAsync(`ffmpeg -i "${inputVideoPath}" -vf "select=eq(n\\,0)" -vframes 1 "${firstFramePath}"`);

      // Read first frame as base64 for face swap
      const firstFrameBuffer = await fs.readFile(firstFramePath);
      const firstFrameBase64 = `data:image/png;base64,${firstFrameBuffer.toString('base64')}`;
      this.logger.log(`[${jobId}] Step 1: First frame extracted (${firstFrameBuffer.length} bytes)`);

      // Step 2: Face swap on first frame
      this.logger.log(`[${jobId}] Step 2: Running face swap on first frame...`);
      await this.supabase.updateJob(jobId, { progress: 25, external_status: 'SWAPPING_FACE' });

      const faceSwapResult = await this.falService.runFaceSwap({
        base_image_url: firstFrameBase64,
        swap_image_url: faceImageUrl,
      });

      if (!faceSwapResult.image?.url) {
        throw new Error('Face swap returned no image URL');
      }

      const swappedFrameUrl = faceSwapResult.image.url;
      this.logger.log(`[${jobId}] Step 2: Face swap completed: ${swappedFrameUrl}`);

      // Step 3: Apply Kling motion control
      this.logger.log(`[${jobId}] Step 3: Applying Kling motion control...`);
      await this.supabase.updateJob(jobId, { progress: 40, external_status: 'APPLYING_MOTION' });

      const klingResult = await this.falService.runKlingMotionControl({
        image_url: swappedFrameUrl,
        video_url: videoUrl,
        character_orientation: 'video', // Use video motion as reference
      });

      if (!klingResult.video?.url) {
        throw new Error('Kling motion control returned no video URL');
      }

      this.logger.log(`[${jobId}] Step 3: Kling motion control completed: ${klingResult.video.url}`);

      // Step 4: Download and upload result
      this.logger.log(`[${jobId}] Step 4: Downloading and uploading result...`);
      await this.supabase.updateJob(jobId, { progress: 85, external_status: 'UPLOADING' });

      const resultVideoBuffer = await this.downloadBuffer(klingResult.video.url);
      const filePath = `${videoId}/kling_swapped_${Date.now()}.mp4`;
      const { url: outputUrl } = await this.supabase.uploadFile(
        'processed-videos',
        filePath,
        resultVideoBuffer,
        'video/mp4',
      );

      this.logger.log(`[${jobId}] Step 4: Uploaded to ${outputUrl}`);

      // Step 5: Create video record
      this.logger.log(`[${jobId}] Step 5: Creating video record...`);
      await this.supabase.updateJob(jobId, { progress: 95 });

      const swappedVideo = await this.supabase.createVideo({
        name: `AI Swap (Kling) - ${new Date().toLocaleString()}`,
        type: 'face_swapped',
        parent_video_id: videoId,
        character_diagram_id: characterDiagramId,
        file_url: outputUrl,
        duration_seconds: durationSeconds,
        collection_id: null,
        thumbnail_url: null,
        width: null,
        height: null,
        file_size_bytes: resultVideoBuffer.length,
      });

      // Calculate cost: $0.40 flat rate for Kling method
      const costCents = 40;

      // Mark job completed
      this.logger.log(`[${jobId}] === MARKING JOB COMPLETED ===`);
      await this.jobsService.markJobCompleted(
        jobId,
        {
          outputVideoId: swappedVideo.id,
          outputUrl,
          loraId,
          characterDiagramId,
          method: 'kling',
        },
        costCents,
      );

      this.logger.log(`[${jobId}] Kling face swap completed successfully`, {
        swappedVideoId: swappedVideo.id,
        costCents,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[${jobId}] Kling face swap failed: ${errorMessage}`);
      await this.jobsService.markJobFailed(jobId, errorMessage);
      throw error;
    } finally {
      // Cleanup temp directory
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        this.logger.warn(`[${jobId}] Failed to cleanup temp directory: ${cleanupError}`);
      }
    }
  }

  /**
   * Frame-by-frame face swap - preserves original motion exactly (DEPRECATED)
   */
  private async processFrameByFrame(job: Job<FaceSwapJobData>): Promise<void> {
    // CRITICAL: Capture jobId at method start and verify
    const jobId = job.data.jobId;
    this.logger.log(`=== processFrameByFrame ENTRY ===`);
    this.logger.log(`jobId at method entry: "${jobId}" (type: ${typeof jobId})`);

    if (!jobId || jobId === 'undefined') {
      const errorMsg = `FATAL: jobId invalid at processFrameByFrame entry: "${jobId}"`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    const {
      videoId,
      videoUrl,
      faceImageUrl,
      characterDiagramId,
      loraId,
      durationSeconds = 10,
    } = job.data;

    this.logger.log(`=== FRAME-BY-FRAME FACE SWAP STARTED ===`);
    this.logger.log(`Job ID: ${jobId}`);
    this.logger.log(`Video URL: ${videoUrl}`);
    this.logger.log(`Face Image URL: ${faceImageUrl}`);
    this.logger.log(`Duration: ${durationSeconds}s`);

    // Validate inputs
    if (!videoUrl) {
      throw new Error('videoUrl is required but was empty');
    }
    if (!faceImageUrl) {
      throw new Error('faceImageUrl is required but was empty');
    }

    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    // Check ffmpeg availability
    this.logger.log(`[${jobId}] Checking ffmpeg availability...`);
    try {
      const { stdout: ffmpegVersion } = await execAsync('ffmpeg -version | head -1');
      this.logger.log(`[${jobId}] ffmpeg available: ${ffmpegVersion.trim()}`);
    } catch (ffmpegError) {
      this.logger.error(`[${jobId}] ffmpeg NOT AVAILABLE: ${ffmpegError}`);
      throw new Error('ffmpeg is not installed or not in PATH');
    }

    // Create temp directory for processing
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'faceswap-'));
    this.logger.log(`[${jobId}] Created temp directory: ${tempDir}`);
    const framesDir = path.join(tempDir, 'frames');
    const swappedDir = path.join(tempDir, 'swapped');
    await fs.mkdir(framesDir);
    await fs.mkdir(swappedDir);

    try {
      await this.jobsService.markJobProcessing(jobId);
      await this.supabase.updateJob(jobId, { progress: 5 });

      this.logger.log(`[${jobId}] Processing frame-by-frame face swap`);

      // Step 1: Download source video
      this.logger.log(`[${jobId}] Step 1: Downloading source video from ${videoUrl}...`);
      const downloadStart = Date.now();
      const videoBuffer = await this.downloadBuffer(videoUrl);
      this.logger.log(`[${jobId}] Step 1: Downloaded ${videoBuffer.length} bytes in ${Date.now() - downloadStart}ms`);
      const inputVideoPath = path.join(tempDir, 'input.mp4');
      await fs.writeFile(inputVideoPath, videoBuffer);
      this.logger.log(`[${jobId}] Step 1: Saved to ${inputVideoPath}`);
      await this.supabase.updateJob(jobId, { progress: 10 });

      // Step 2: Get video info (fps, frame count)
      this.logger.log(`[${jobId}] Step 2: Getting video info with ffprobe...`);
      const ffprobeCmd = `ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate,nb_frames -of csv=p=0 "${inputVideoPath}"`;
      this.logger.log(`[${jobId}] Running: ${ffprobeCmd}`);
      let probeOutput: string;
      try {
        const probeResult = await execAsync(ffprobeCmd);
        probeOutput = probeResult.stdout;
        if (probeResult.stderr) {
          this.logger.warn(`[${jobId}] ffprobe stderr: ${probeResult.stderr}`);
        }
      } catch (probeError: unknown) {
        const err = probeError as { stderr?: string; message?: string };
        this.logger.error(`[${jobId}] ffprobe FAILED: ${err.stderr || err.message}`);
        throw new Error(`ffprobe failed: ${err.stderr || err.message}`);
      }
      this.logger.log(`[${jobId}] ffprobe output: ${probeOutput.trim()}`);

      const [fpsRatio, frameCountStr] = probeOutput.trim().split('\n')[0].split(',');
      const [fpsNum, fpsDen] = fpsRatio.split('/').map(Number);
      const fps = Math.round(fpsNum / (fpsDen || 1));
      let frameCount = parseInt(frameCountStr, 10);

      // If nb_frames not available, estimate from duration
      if (isNaN(frameCount) || frameCount === 0) {
        frameCount = Math.ceil(durationSeconds * fps);
        this.logger.log(`[${jobId}] nb_frames not available, estimated: ${frameCount}`);
      }

      this.logger.log(`[${jobId}] Video info: ${fps} fps, ~${frameCount} frames expected`);

      // Step 3: Extract frames
      this.logger.log(`[${jobId}] Step 3: Extracting frames with ffmpeg...`);
      const extractCmd = `ffmpeg -i "${inputVideoPath}" -vf fps=${fps} "${framesDir}/frame_%06d.png"`;
      this.logger.log(`[${jobId}] Running: ${extractCmd}`);
      const extractStart = Date.now();
      try {
        const extractResult = await execAsync(extractCmd);
        if (extractResult.stderr) {
          // ffmpeg outputs progress to stderr, this is normal
          this.logger.log(`[${jobId}] ffmpeg extraction completed in ${Date.now() - extractStart}ms`);
        }
      } catch (extractError: unknown) {
        const err = extractError as { stderr?: string; message?: string };
        this.logger.error(`[${jobId}] ffmpeg extraction FAILED: ${err.stderr || err.message}`);
        throw new Error(`Frame extraction failed: ${err.stderr || err.message}`);
      }

      const frameFiles = (await fs.readdir(framesDir)).filter((f) => f.endsWith('.png')).sort();
      const actualFrameCount = frameFiles.length;
      this.logger.log(`[${jobId}] Extracted ${actualFrameCount} frames to ${framesDir}`);
      if (actualFrameCount === 0) {
        throw new Error('No frames extracted from video - ffmpeg may have failed silently');
      }
      await this.supabase.updateJob(jobId, { progress: 15 });

      // Step 4: Process each frame with face swap
      this.logger.log(`[${jobId}] Step 4: Processing ${actualFrameCount} frames with fal-ai/face-swap...`);
      this.logger.log(`[${jobId}] Face image URL for swap: ${faceImageUrl}`);
      let processedFrames = 0;
      let successfulSwaps = 0;
      let failedSwaps = 0;
      const swapStartTime = Date.now();

      for (const frameFile of frameFiles) {
        const framePath = path.join(framesDir, frameFile);
        const swappedPath = path.join(swappedDir, frameFile);

        // Read frame as base64 data URL for fal.ai
        const frameBuffer = await fs.readFile(framePath);
        const frameBase64 = `data:image/png;base64,${frameBuffer.toString('base64')}`;

        // Log first frame details for debugging
        if (processedFrames === 0) {
          this.logger.log(`[${jobId}] First frame size: ${frameBuffer.length} bytes`);
          this.logger.log(`[${jobId}] Base64 URL length: ${frameBase64.length} chars`);
        }

        try {
          // Call fal.ai face swap
          if (processedFrames === 0) {
            this.logger.log(`[${jobId}] ==> Calling fal-ai/face-swap for first frame...`);
          }
          const frameStart = Date.now();
          const result = await this.falService.runFaceSwap({
            base_image_url: frameBase64,
            swap_image_url: faceImageUrl,
          });

          if (processedFrames === 0) {
            this.logger.log(`[${jobId}] <== First frame swap completed in ${Date.now() - frameStart}ms`);
            this.logger.log(`[${jobId}] Result image URL: ${result.image?.url}`);
          }

          if (!result.image?.url) {
            throw new Error('Face swap returned no image URL');
          }

          // Download swapped frame
          const swappedBuffer = await this.downloadBuffer(result.image.url);
          await fs.writeFile(swappedPath, swappedBuffer);
          successfulSwaps++;
        } catch (frameError) {
          // If face swap fails for a frame, copy original
          const errorMsg = frameError instanceof Error ? frameError.message : String(frameError);
          if (failedSwaps < 3) {
            // Only log first few failures to avoid spam
            this.logger.warn(`[${jobId}] Face swap failed for ${frameFile}: ${errorMsg}`);
          }
          await fs.copyFile(framePath, swappedPath);
          failedSwaps++;
        }

        processedFrames++;

        // Update progress (15-85% range for frame processing)
        if (processedFrames % 10 === 0 || processedFrames === actualFrameCount) {
          const progress = 15 + Math.round((processedFrames / actualFrameCount) * 70);
          await this.supabase.updateJob(jobId, { progress });
          const elapsed = Math.round((Date.now() - swapStartTime) / 1000);
          const rate = processedFrames / elapsed || 0;
          this.logger.log(`[${jobId}] Processed ${processedFrames}/${actualFrameCount} frames (${progress}%) - ${elapsed}s elapsed, ${rate.toFixed(1)} fps`);
        }
      }

      this.logger.log(`[${jobId}] Step 4 complete: ${successfulSwaps} successful, ${failedSwaps} failed swaps`);

      // Step 5: Reassemble video with audio
      this.logger.log(`[${jobId}] Step 5: Reassembling video...`);
      await this.supabase.updateJob(jobId, { progress: 88 });

      const outputVideoPath = path.join(tempDir, 'output.mp4');
      await execAsync(
        `ffmpeg -framerate ${fps} -i "${swappedDir}/frame_%06d.png" -i "${inputVideoPath}" -map 0:v -map 1:a? -c:v libx264 -pix_fmt yuv420p -preset fast -crf 23 -c:a copy -shortest "${outputVideoPath}"`,
      );

      // Step 6: Upload to Supabase
      this.logger.log(`[${jobId}] Step 6: Uploading result...`);
      await this.supabase.updateJob(jobId, { progress: 92 });

      const outputBuffer = await fs.readFile(outputVideoPath);
      const filePath = `${videoId}/swapped_frames_${Date.now()}.mp4`;
      const { url: outputUrl } = await this.supabase.uploadFile(
        'processed-videos',
        filePath,
        outputBuffer,
        'video/mp4',
      );

      // Create video record
      const swappedVideo = await this.supabase.createVideo({
        name: `Face Swap - ${new Date().toLocaleString()}`,
        type: 'face_swapped',
        parent_video_id: videoId,
        character_diagram_id: characterDiagramId,
        file_url: outputUrl,
        duration_seconds: durationSeconds,
        collection_id: null,
        thumbnail_url: null,
        width: null,
        height: null,
        file_size_bytes: outputBuffer.length,
      });

      // Calculate cost based on frame count
      const costCents = Math.ceil(actualFrameCount * FACE_SWAP_COST_PER_FRAME);

      // CRITICAL: Re-validate jobId before completion
      if (!jobId || jobId === 'undefined') {
        this.logger.error(`[${jobId}] FATAL: jobId became invalid before completion!`);
        throw new Error(`jobId became invalid before completion: ${jobId}`);
      }
      this.logger.log(`[${jobId}] === MARKING JOB COMPLETED ===`);

      // Mark job completed
      await this.jobsService.markJobCompleted(
        jobId,
        {
          outputVideoId: swappedVideo.id,
          outputUrl,
          loraId,
          characterDiagramId,
          frameCount: actualFrameCount,
          method: 'face_swap',
        },
        costCents,
      );

      this.logger.log(`[${jobId}] Frame-by-frame face swap completed`, {
        swappedVideoId: swappedVideo.id,
        frameCount: actualFrameCount,
        costCents,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[${jobId}] Frame-by-frame face swap failed: ${errorMessage}`);
      await this.jobsService.markJobFailed(jobId, errorMessage);
      throw error;
    } finally {
      // Cleanup temp directory
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        this.logger.warn(`[${jobId}] Failed to cleanup temp directory: ${cleanupError}`);
      }
    }
  }

  private async downloadBuffer(url: string): Promise<Buffer> {
    // Handle data URLs (base64)
    if (url.startsWith('data:')) {
      const base64Data = url.split(',')[1];
      return Buffer.from(base64Data, 'base64');
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
