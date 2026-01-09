import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Picsi.ai API types (InsightFace B2B API)
export interface PicsiVideoFaceSwapInput {
  source_video_url: string; // URL to the video to process
  face_image_url: string; // URL to the face image to swap in
  target_face_index?: number; // Which face to replace (default: 0 = first detected)
  model?: 'inswapper_dax' | 'inswapper_128'; // Model to use (default: inswapper_dax for high quality)
}

export interface PicsiJobResponse {
  job_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  created_at: string;
}

export interface PicsiJobStatus {
  job_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number; // 0-100
  result_url?: string; // Available when completed
  error_message?: string; // Available when failed
  credits_used?: number;
  processing_time_seconds?: number;
}

@Injectable()
export class PicsiService {
  private readonly logger = new Logger(PicsiService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.picsi.ai/v1';

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('PICSI_API_KEY') || '';
    if (!this.apiKey) {
      this.logger.warn('PICSI_API_KEY not configured. Picsi.ai operations will fail.');
    }
  }

  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' = 'POST',
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    this.logger.debug(`Picsi API ${method} ${endpoint}`);

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Picsi.ai API error (${response.status}): ${error}`);
    }

    return response.json();
  }

  /**
   * Submit a video face swap job
   * Returns a job_id for polling
   */
  async submitVideoFaceSwap(input: PicsiVideoFaceSwapInput): Promise<PicsiJobResponse> {
    this.logger.log('Submitting video face swap to Picsi.ai', {
      sourceVideo: input.source_video_url,
      faceImage: input.face_image_url,
    });

    const response = await this.request<PicsiJobResponse>('/video/face-swap', 'POST', {
      source_video_url: input.source_video_url,
      face_image_url: input.face_image_url,
      target_face_index: input.target_face_index ?? 0,
      model: input.model ?? 'inswapper_dax',
    });

    this.logger.log(`Video face swap submitted with job_id: ${response.job_id}`);
    return response;
  }

  /**
   * Check the status of a face swap job
   */
  async getJobStatus(jobId: string): Promise<PicsiJobStatus> {
    const response = await this.request<PicsiJobStatus>(`/jobs/${jobId}`, 'GET');
    return response;
  }

  /**
   * Poll for job completion
   * Returns the result when complete, or throws on failure
   */
  async pollForCompletion(
    jobId: string,
    options: {
      intervalMs?: number;
      maxAttempts?: number;
      onProgress?: (status: PicsiJobStatus) => void;
    } = {},
  ): Promise<PicsiJobStatus> {
    const { intervalMs = 5000, maxAttempts = 360, onProgress } = options; // Default: poll for up to 30 minutes

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const status = await this.getJobStatus(jobId);

      if (onProgress) {
        onProgress(status);
      }

      if (status.status === 'completed') {
        this.logger.log(`Face swap job ${jobId} completed`, {
          resultUrl: status.result_url,
          creditsUsed: status.credits_used,
          processingTime: status.processing_time_seconds,
        });
        return status;
      }

      if (status.status === 'failed') {
        throw new Error(`Face swap failed: ${status.error_message || 'Unknown error'}`);
      }

      this.logger.debug(
        `Face swap status: ${status.status} ${status.progress ? `(${status.progress}%)` : ''} (attempt ${attempt + 1}/${maxAttempts})`,
      );
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Face swap timed out after ${maxAttempts} attempts`);
  }

  /**
   * Submit a face swap job and wait for completion
   * Convenience method that combines submit + poll
   */
  async faceSwapVideo(
    input: PicsiVideoFaceSwapInput,
    onProgress?: (status: PicsiJobStatus) => void,
  ): Promise<PicsiJobStatus> {
    const job = await this.submitVideoFaceSwap(input);
    return this.pollForCompletion(job.job_id, { onProgress });
  }

  /**
   * Get account credits balance
   */
  async getCreditsBalance(): Promise<{ credits: number; plan: string }> {
    const response = await this.request<{ credits: number; plan: string }>('/account', 'GET');
    return response;
  }
}
