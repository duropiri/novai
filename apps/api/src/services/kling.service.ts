import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

// Kling API Types
export interface CameraControl {
  type: 'simple' | 'custom';
  config?: {
    horizontal?: number; // -10 to 10
    vertical?: number; // -10 to 10
    pan?: number; // -10 to 10
    tilt?: number; // -10 to 10
    roll?: number; // -10 to 10
    zoom?: number; // -10 to 10
  };
}

export interface KlingTask {
  taskId: string;
  status: string;
}

export interface KlingTaskResult {
  taskId: string;
  status: string;
  progress?: number;
  videos?: Array<{ url: string; duration?: number }>;
  images?: Array<{ url: string }>;
}

export type KlingModel =
  | 'kling-v1'
  | 'kling-v1-5'
  | 'kling-v1-6'
  | 'kling-v2'
  | 'kling-v2-1'
  | 'kling-v2-5'
  | 'kling-v2-6'
  | 'kling-v2-master';

@Injectable()
export class KlingService implements OnModuleInit {
  private readonly logger = new Logger(KlingService.name);
  private accessKey: string;
  private secretKey: string;
  private baseUrl: string;
  private enabled: boolean;

  constructor(private configService: ConfigService) {
    this.accessKey = this.configService.get<string>('KLING_ACCESS_KEY') || '';
    this.secretKey = this.configService.get<string>('KLING_SECRET_KEY') || '';
    this.baseUrl = this.configService.get<string>('KLING_API_URL') || 'https://api.klingai.com';
    this.enabled = !!(this.accessKey && this.secretKey);
  }

  async onModuleInit() {
    if (this.enabled) {
      this.logger.log('Direct Kling API enabled');
      this.logger.log(`API URL: ${this.baseUrl}`);
      this.logger.log(`Access Key: ${this.accessKey.substring(0, 8)}...`);
    } else {
      this.logger.warn('Direct Kling API not configured - will fall back to fal.ai');
    }
  }

  /**
   * Check if direct Kling API is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Generate JWT token for authentication
   */
  private generateToken(): string {
    const now = Math.floor(Date.now() / 1000);

    const payload = {
      iss: this.accessKey, // Issuer = Access Key
      exp: now + 1800, // Expires in 30 minutes
      nbf: now - 5, // Not valid before (5 seconds ago for clock skew)
    };

    return jwt.sign(payload, this.secretKey, {
      algorithm: 'HS256',
      header: { alg: 'HS256', typ: 'JWT' },
    });
  }

  /**
   * Make authenticated API request
   */
  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' = 'GET',
    body?: unknown,
  ): Promise<T> {
    const token = this.generateToken();
    const url = `${this.baseUrl}${endpoint}`;

    this.logger.debug(`Kling API ${method} ${endpoint}`);

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();

    if (data.code !== 0) {
      this.logger.error(`Kling API error: ${JSON.stringify(data)}`);
      throw new Error(`Kling API error: ${data.message || JSON.stringify(data)}`);
    }

    return data;
  }

  // ==========================================
  // TEXT TO VIDEO
  // ==========================================
  async textToVideo(params: {
    prompt: string;
    negativePrompt?: string;
    model?: KlingModel;
    duration?: '5' | '10';
    aspectRatio?: '16:9' | '9:16' | '1:1';
    mode?: 'std' | 'pro';
    cfgScale?: number;
    cameraControl?: CameraControl;
  }): Promise<KlingTask> {
    this.logger.log(`Creating text-to-video task with model ${params.model || 'kling-v1-6'}`);

    const result = await this.request<{ data: { task_id: string; task_status: string } }>(
      '/v1/videos/text2video',
      'POST',
      {
        model_name: params.model || 'kling-v1-6',
        prompt: params.prompt,
        negative_prompt: params.negativePrompt || '',
        duration: params.duration || '5',
        aspect_ratio: params.aspectRatio || '16:9',
        mode: params.mode || 'pro',
        cfg_scale: params.cfgScale || 0.5,
        camera_control: params.cameraControl,
      },
    );

    this.logger.log(`Text-to-video task created: ${result.data.task_id}`);

    return {
      taskId: result.data.task_id,
      status: result.data.task_status,
    };
  }

  // ==========================================
  // IMAGE TO VIDEO (Primary for face swap)
  // ==========================================
  async imageToVideo(params: {
    imageUrl: string;
    prompt?: string;
    negativePrompt?: string;
    model?: KlingModel;
    duration?: '5' | '10';
    mode?: 'std' | 'pro';
    cfgScale?: number;
    cameraControl?: CameraControl;
  }): Promise<KlingTask> {
    this.logger.log(`Creating image-to-video task with model ${params.model || 'kling-v1-6'}`);

    const result = await this.request<{ data: { task_id: string; task_status: string } }>(
      '/v1/videos/image2video',
      'POST',
      {
        model_name: params.model || 'kling-v1-6',
        image: params.imageUrl,
        prompt: params.prompt || '',
        negative_prompt: params.negativePrompt || '',
        duration: params.duration || '5',
        mode: params.mode || 'pro',
        cfg_scale: params.cfgScale || 0.5,
        camera_control: params.cameraControl,
      },
    );

    this.logger.log(`Image-to-video task created: ${result.data.task_id}`);

    return {
      taskId: result.data.task_id,
      status: result.data.task_status,
    };
  }

  // ==========================================
  // IMAGE TO VIDEO WITH MOTION CONTROL
  // This is the key method for face swap - copies motion from reference video
  // ==========================================
  async imageToVideoWithMotion(params: {
    imageUrl: string;
    motionVideoUrl: string;
    prompt?: string;
    model?: KlingModel;
    duration?: '5' | '10';
    mode?: 'std' | 'pro';
    onProgress?: (status: { status: string; progress?: number }) => void;
  }): Promise<KlingTask> {
    this.logger.log(`Creating motion-controlled video with model ${params.model || 'kling-v1-6'}`);
    this.logger.log(`Image: ${params.imageUrl.substring(0, 50)}...`);
    this.logger.log(`Motion video: ${params.motionVideoUrl.substring(0, 50)}...`);

    // Note: The motion control endpoint may vary - checking Kling docs
    // Using the motion transfer endpoint
    const result = await this.request<{ data: { task_id: string; task_status: string } }>(
      '/v1/videos/image2video',
      'POST',
      {
        model_name: params.model || 'kling-v1-6',
        image: params.imageUrl,
        video_url: params.motionVideoUrl, // Motion reference
        prompt: params.prompt || 'Continue the motion naturally, photorealistic, high quality',
        duration: params.duration || '5',
        mode: params.mode || 'pro',
      },
    );

    this.logger.log(`Motion-controlled video task created: ${result.data.task_id}`);

    return {
      taskId: result.data.task_id,
      status: result.data.task_status,
    };
  }

  // ==========================================
  // VIDEO EXTEND
  // ==========================================
  async extendVideo(params: { videoUrl: string; prompt?: string }): Promise<KlingTask> {
    this.logger.log('Creating video extend task');

    const result = await this.request<{ data: { task_id: string; task_status: string } }>(
      '/v1/videos/video2video/extend',
      'POST',
      {
        video: params.videoUrl,
        prompt: params.prompt || '',
      },
    );

    return {
      taskId: result.data.task_id,
      status: result.data.task_status,
    };
  }

  // ==========================================
  // LIP SYNC
  // ==========================================
  async lipSync(params: { videoUrl: string; audioUrl: string }): Promise<KlingTask> {
    this.logger.log('Creating lip sync task');

    const result = await this.request<{ data: { task_id: string; task_status: string } }>(
      '/v1/videos/lipsync',
      'POST',
      {
        video: params.videoUrl,
        audio: params.audioUrl,
      },
    );

    return {
      taskId: result.data.task_id,
      status: result.data.task_status,
    };
  }

  // ==========================================
  // VIRTUAL TRY-ON
  // ==========================================
  async virtualTryOn(params: {
    humanImageUrl: string;
    clothImageUrl: string;
  }): Promise<KlingTask> {
    this.logger.log('Creating virtual try-on task');

    const result = await this.request<{ data: { task_id: string; task_status: string } }>(
      '/v1/images/kolors-virtual-try-on',
      'POST',
      {
        human_image: params.humanImageUrl,
        cloth_image: params.clothImageUrl,
      },
    );

    return {
      taskId: result.data.task_id,
      status: result.data.task_status,
    };
  }

  // ==========================================
  // IMAGE GENERATION
  // ==========================================
  async generateImage(params: {
    prompt: string;
    negativePrompt?: string;
    aspectRatio?: string;
    imageCount?: number;
  }): Promise<KlingTask> {
    this.logger.log('Creating image generation task');

    const result = await this.request<{ data: { task_id: string; task_status: string } }>(
      '/v1/images/generations',
      'POST',
      {
        model_name: 'kling-v1',
        prompt: params.prompt,
        negative_prompt: params.negativePrompt || '',
        aspect_ratio: params.aspectRatio || '1:1',
        n: params.imageCount || 1,
      },
    );

    return {
      taskId: result.data.task_id,
      status: result.data.task_status,
    };
  }

  // ==========================================
  // QUERY TASK STATUS
  // ==========================================
  async getVideoTaskStatus(taskId: string): Promise<KlingTaskResult> {
    const result = await this.request<{
      data: {
        task_id: string;
        task_status: string;
        task_progress?: number;
        task_status_msg?: string;
        task_result?: {
          videos?: Array<{ url: string; duration?: number }>;
        };
      };
    }>(`/v1/videos/image2video/${taskId}`, 'GET');

    return {
      taskId: result.data.task_id,
      status: result.data.task_status,
      progress: result.data.task_progress,
      videos: result.data.task_result?.videos || [],
    };
  }

  async getImageTaskStatus(taskId: string): Promise<KlingTaskResult> {
    const result = await this.request<{
      data: {
        task_id: string;
        task_status: string;
        task_progress?: number;
        task_result?: {
          images?: Array<{ url: string }>;
        };
      };
    }>(`/v1/images/generations/${taskId}`, 'GET');

    return {
      taskId: result.data.task_id,
      status: result.data.task_status,
      progress: result.data.task_progress,
      images: result.data.task_result?.images || [],
    };
  }

  // ==========================================
  // WAIT FOR TASK COMPLETION
  // ==========================================
  async waitForVideoCompletion(
    taskId: string,
    options: {
      maxWaitMs?: number;
      pollIntervalMs?: number;
      onProgress?: (status: { status: string; progress?: number }) => void;
    } = {},
  ): Promise<KlingTaskResult> {
    const { maxWaitMs = 600000, pollIntervalMs = 5000, onProgress } = options;
    const startTime = Date.now();

    this.logger.log(`Waiting for video task ${taskId} to complete...`);

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const result = await this.getVideoTaskStatus(taskId);
        const status = result.status;
        const progress = result.progress || 0;

        this.logger.log(`Task ${taskId}: ${status} (${progress}%)`);

        if (onProgress) {
          onProgress({ status, progress });
        }

        if (status === 'succeed' || status === 'completed') {
          this.logger.log(`Task ${taskId} completed successfully`);
          return {
            ...result,
            status: 'completed',
          };
        }

        if (status === 'failed') {
          throw new Error(`Kling task failed: ${taskId}`);
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      } catch (error) {
        // Handle transient errors during polling
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes('task failed')) {
          throw error;
        }
        this.logger.warn(`Polling error (will retry): ${errorMsg}`);
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    }

    throw new Error(`Kling task ${taskId} timed out after ${maxWaitMs / 1000}s`);
  }

  async waitForImageCompletion(
    taskId: string,
    options: {
      maxWaitMs?: number;
      pollIntervalMs?: number;
      onProgress?: (status: { status: string; progress?: number }) => void;
    } = {},
  ): Promise<KlingTaskResult> {
    const { maxWaitMs = 300000, pollIntervalMs = 3000, onProgress } = options;
    const startTime = Date.now();

    this.logger.log(`Waiting for image task ${taskId} to complete...`);

    while (Date.now() - startTime < maxWaitMs) {
      const result = await this.getImageTaskStatus(taskId);
      const status = result.status;
      const progress = result.progress || 0;

      this.logger.log(`Task ${taskId}: ${status} (${progress}%)`);

      if (onProgress) {
        onProgress({ status, progress });
      }

      if (status === 'succeed' || status === 'completed') {
        return {
          ...result,
          status: 'completed',
        };
      }

      if (status === 'failed') {
        throw new Error(`Kling image task failed: ${taskId}`);
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Kling image task ${taskId} timed out`);
  }

  // ==========================================
  // CONVENIENCE METHOD FOR FACE SWAP PIPELINE
  // ==========================================
  /**
   * Generate video from image with motion reference
   * This is the main method used by the face swap processor
   */
  async generateVideoWithMotion(params: {
    imageUrl: string;
    motionVideoUrl: string;
    model?: KlingModel;
    duration?: '5' | '10';
    onProgress?: (status: { status: string; progress?: number; logs?: Array<{ message: string }> }) => void;
  }): Promise<{ video: { url: string } }> {
    // Create the task
    const task = await this.imageToVideoWithMotion({
      imageUrl: params.imageUrl,
      motionVideoUrl: params.motionVideoUrl,
      model: params.model || 'kling-v1-6',
      duration: params.duration || '5',
      mode: 'pro',
    });

    // Wait for completion
    const result = await this.waitForVideoCompletion(task.taskId, {
      onProgress: params.onProgress
        ? (status) =>
            params.onProgress!({
              ...status,
              logs: [{ message: `Kling: ${status.status} (${status.progress || 0}%)` }],
            })
        : undefined,
    });

    if (!result.videos || result.videos.length === 0) {
      throw new Error('Kling did not return a video');
    }

    return {
      video: {
        url: result.videos[0].url,
      },
    };
  }
}
