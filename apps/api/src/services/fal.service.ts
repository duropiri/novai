import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fal } from '@fal-ai/client';

// fal.ai API types - Legacy FLUX Fast Training
export interface FalLoraTrainingInput {
  images_data_url: string; // URL to ZIP file containing training images
  trigger_word?: string; // The trigger word for the LoRA (default: "ohwx")
  steps?: number; // Training steps (default: 1000, max: 10000)
  is_style?: boolean; // Style mode vs character mode (default: false)
  create_masks?: boolean; // Auto-segment faces (default: true)
  is_input_format_already_preprocessed?: boolean;
}

export interface FalLoraTrainingOutput {
  diffusers_lora_file: {
    url: string;
    content_type: string;
    file_name: string;
    file_size: number;
  };
  config_file: {
    url: string;
    content_type: string;
    file_name: string;
    file_size: number;
  };
}

// WAN 2.2 Image Trainer types
export interface Wan22TrainingInput {
  training_data_url: string; // URL to ZIP file containing training images
  trigger_phrase: string; // The trigger phrase for the LoRA
  steps?: number; // Training steps (default: 1000)
  learning_rate?: number; // Learning rate (default: 0.0007)
  is_style?: boolean; // Style mode vs character mode (default: false)
  include_synthetic_captions?: boolean; // Use AI-generated captions (default: false)
  use_face_detection?: boolean; // Auto-detect faces (default: true)
  use_face_cropping?: boolean; // Crop to faces (default: false)
  use_masks?: boolean; // Use segmentation masks (default: true)
}

export interface Wan22TrainingOutput {
  // HIGH NOISE LoRA - PRIMARY for inference
  high_noise_lora: {
    url: string;
    content_type: string;
    file_name: string;
    file_size: number;
  };
  // Diffusers format LoRA - reference only
  diffusers_lora_file: {
    url: string;
    content_type: string;
    file_name: string;
    file_size: number;
  };
  // Config file - reference only
  config_file: {
    url: string;
    content_type: string;
    file_name: string;
    file_size: number;
  };
}

export interface FalQueueStatus {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  request_id: string;
  response_url?: string;
  logs?: Array<{ message: string; timestamp: string }>;
}

export interface FalImageGenerationInput {
  prompt: string;
  image_url?: string; // For img2img / Kontext
  loras?: Array<{
    path: string;
    scale?: number;
  }>;
  image_size?: {
    width: number;
    height: number;
  };
  num_images?: number;
  guidance_scale?: number;
  num_inference_steps?: number;
  seed?: number;
}

export interface FalImageGenerationOutput {
  images: Array<{
    url: string;
    width: number;
    height: number;
    content_type: string;
  }>;
  seed: number;
  prompt: string;
}

@Injectable()
export class FalService implements OnModuleInit {
  private readonly logger = new Logger(FalService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://queue.fal.run';

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('FAL_API_KEY') || '';
    if (!this.apiKey) {
      this.logger.warn('FAL_API_KEY not configured. fal.ai operations will fail.');
    }
  }

  async onModuleInit() {
    // Configure the fal.ai client with API key
    if (this.apiKey) {
      fal.config({
        credentials: this.apiKey,
      });
      this.logger.log('fal.ai client configured');
      this.logger.log(`FAL_API_KEY present: ${this.apiKey.length > 0}, length: ${this.apiKey.length}`);
      this.logger.log(`FAL_API_KEY prefix: ${this.apiKey.substring(0, 10)}...`);

      // Check connectivity to fal.ai
      await this.checkConnectivity();
    } else {
      this.logger.error('FAL_API_KEY is NOT configured!');
    }
  }

  /**
   * Check connectivity to external services on startup
   */
  private async checkConnectivity(): Promise<void> {
    const services = [
      { name: 'fal.ai API', url: 'https://fal.run' },
      { name: 'fal.ai Queue', url: 'https://queue.fal.run' },
    ];

    this.logger.log('Checking external service connectivity...');

    for (const service of services) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const res = await fetch(service.url, {
          method: 'HEAD',
          signal: controller.signal,
        });
        clearTimeout(timeout);

        this.logger.log(`✅ ${service.name}: reachable (${res.status})`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`⚠️ ${service.name}: ${message}`);
      }
    }
  }

  /**
   * Retry wrapper for transient network failures
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    maxRetries = 3,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Check if it's a network error worth retrying
        const isNetworkError =
          lastError.message.includes('fetch failed') ||
          lastError.message.includes('ECONNREFUSED') ||
          lastError.message.includes('ETIMEDOUT') ||
          lastError.message.includes('ENOTFOUND') ||
          lastError.message.includes('network') ||
          lastError.message.includes('socket');

        if (!isNetworkError || attempt === maxRetries) {
          this.logger.error(
            `${operationName} failed after ${attempt} attempt(s): ${lastError.message}`,
          );
          throw lastError;
        }

        const delay = 2000 * attempt; // Exponential backoff: 2s, 4s, 6s
        this.logger.warn(
          `${operationName} attempt ${attempt}/${maxRetries} failed: ${lastError.message}. Retrying in ${delay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  /**
   * Enhanced error message for fetch failures
   */
  private formatNetworkError(error: Error, context: string): Error {
    if (error.message.includes('fetch failed')) {
      return new Error(
        `Network error during ${context}: Cannot reach external API. ` +
          `Check your internet connection and try again. Original: ${error.message}`,
      );
    }
    if (error.message.includes('ECONNREFUSED')) {
      return new Error(
        `Connection refused during ${context}: The external service may be down. ` +
          `Original: ${error.message}`,
      );
    }
    if (error.message.includes('ETIMEDOUT')) {
      return new Error(
        `Connection timeout during ${context}: The request took too long. ` +
          `Original: ${error.message}`,
      );
    }
    return error;
  }

  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' = 'POST',
    body?: unknown,
  ): Promise<T> {
    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}/${endpoint}`;

    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Key ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`fal.ai API error (${response.status}): ${error}`);
    }

    return response.json();
  }

  // ============================================
  // LORA TRAINING
  // ============================================

  /**
   * Submit a LoRA training job to fal.ai
   * Returns a request_id for polling
   */
  async submitLoraTraining(input: FalLoraTrainingInput): Promise<{ request_id: string }> {
    this.logger.log('=== LORA TRAINING SUBMISSION START ===');
    this.logger.log(`Input: ${JSON.stringify(input, null, 2)}`);
    this.logger.log(`FAL API Key configured: ${!!this.apiKey}, length: ${this.apiKey?.length || 0}`);

    try {
      const response = await this.withRetry(
        () =>
          this.request<{ request_id: string }>(
            'fal-ai/flux-lora-fast-training',
            'POST',
            input,
          ),
        'LoRA training submission',
        3,
      );

      this.logger.log(`=== LORA TRAINING SUBMISSION SUCCESSFUL ===`);
      this.logger.log(`Request ID from fal.ai: ${response.request_id}`);
      return response;
    } catch (error) {
      const originalError = error instanceof Error ? error : new Error(String(error));
      const formattedError = this.formatNetworkError(originalError, 'LoRA training submission');
      this.logger.error(`=== LORA TRAINING SUBMISSION FAILED ===`);
      this.logger.error(`Error: ${formattedError.message}`);
      throw formattedError;
    }
  }

  /**
   * Check the status of a LoRA training job
   */
  async getLoraTrainingStatus(requestId: string): Promise<FalQueueStatus> {
    const response = await this.request<FalQueueStatus>(
      `fal-ai/flux-lora-fast-training/requests/${requestId}/status`,
      'GET',
    );
    return response;
  }

  /**
   * Get the result of a completed LoRA training job
   */
  async getLoraTrainingResult(requestId: string): Promise<FalLoraTrainingOutput> {
    const response = await this.request<FalLoraTrainingOutput>(
      `fal-ai/flux-lora-fast-training/requests/${requestId}`,
      'GET',
    );
    return response;
  }

  /**
   * Poll for LoRA training completion
   * Returns the result when complete, or throws on failure
   */
  async pollLoraTraining(
    requestId: string,
    options: {
      intervalMs?: number;
      maxAttempts?: number;
      onProgress?: (status: FalQueueStatus) => void;
    } = {},
  ): Promise<FalLoraTrainingOutput> {
    const { intervalMs = 15000, maxAttempts = 120, onProgress } = options;

    this.logger.log(`=== LORA TRAINING POLLING START ===`);
    this.logger.log(`Request ID: ${requestId}`);
    this.logger.log(`Max attempts: ${maxAttempts}, Interval: ${intervalMs}ms`);

    const startTime = Date.now();

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const status = await this.getLoraTrainingStatus(requestId);
        const elapsed = Math.round((Date.now() - startTime) / 1000);

        this.logger.log(
          `[Poll ${attempt + 1}/${maxAttempts}] Status: ${status.status}, RequestID: ${requestId}, Elapsed: ${elapsed}s`,
        );

        // Log any messages from fal.ai
        if (status.logs?.length) {
          for (const log of status.logs.slice(-3)) {
            // Log last 3 messages
            this.logger.log(`  [fal.ai] ${log.message}`);
          }
        }

        if (onProgress) {
          onProgress(status);
        }

        if (status.status === 'COMPLETED') {
          this.logger.log(`=== LORA TRAINING COMPLETED ===`);
          this.logger.log(`Request ID: ${requestId}`);
          this.logger.log(`Total time: ${elapsed}s`);

          const result = await this.getLoraTrainingResult(requestId);
          this.logger.log(`Result: ${JSON.stringify(result, null, 2)}`);
          return result;
        }

        if (status.status === 'FAILED') {
          this.logger.error(`=== LORA TRAINING FAILED ON FAL.AI ===`);
          this.logger.error(`Status: ${JSON.stringify(status, null, 2)}`);
          throw new Error('LoRA training failed on fal.ai');
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      } catch (pollError) {
        // Handle network errors during polling (retry the poll, not the whole job)
        const errorMsg = pollError instanceof Error ? pollError.message : String(pollError);
        if (
          errorMsg.includes('fetch failed') ||
          errorMsg.includes('ECONNREFUSED') ||
          errorMsg.includes('ETIMEDOUT')
        ) {
          this.logger.warn(`Poll ${attempt + 1} network error: ${errorMsg}. Continuing...`);
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
          continue;
        }
        throw pollError;
      }
    }

    const totalTime = Math.round((Date.now() - startTime) / 1000);
    this.logger.error(`=== LORA TRAINING TIMEOUT ===`);
    this.logger.error(`Request ID: ${requestId}`);
    this.logger.error(`Timed out after ${totalTime}s (${maxAttempts} attempts)`);
    throw new Error(`LoRA training timed out after ${maxAttempts} attempts (${totalTime}s)`);
  }

  // ============================================
  // WAN 2.2 IMAGE TRAINER (New Primary Method)
  // ============================================

  /**
   * Run WAN 2.2 LoRA training using fal.subscribe
   * IMPORTANT: Returns high_noise_lora which should be used as the PRIMARY LoRA for inference
   *
   * @param input Training parameters
   * @param options Progress callback and status update
   * @returns Training output with high_noise_lora (primary), diffusers_lora_file, and config_file
   */
  async runWan22Training(
    input: Wan22TrainingInput,
    options: {
      onQueueUpdate?: (update: { status: string; logs?: Array<{ message: string }> }) => void;
      onProgress?: (progress: number) => void;
    } = {},
  ): Promise<Wan22TrainingOutput> {
    this.logger.log('=== WAN 2.2 LORA TRAINING START ===');
    this.logger.log(`Training data URL: ${input.training_data_url}`);
    this.logger.log(`Trigger phrase: ${input.trigger_phrase}`);
    this.logger.log(`Steps: ${input.steps || 1000}`);
    this.logger.log(`Learning rate: ${input.learning_rate || 0.0007}`);
    this.logger.log(`Is style: ${input.is_style || false}`);

    try {
      const result = await fal.subscribe('fal-ai/wan-22-image-trainer', {
        input: {
          training_data_url: input.training_data_url,
          trigger_phrase: input.trigger_phrase,
          steps: input.steps || 1000,
          learning_rate: input.learning_rate || 0.0007,
          is_style: input.is_style || false,
          include_synthetic_captions: input.include_synthetic_captions || false,
          use_face_detection: input.use_face_detection ?? true,
          use_face_cropping: input.use_face_cropping || false,
          use_masks: input.use_masks ?? true,
        },
        logs: true,
        onQueueUpdate: (update) => {
          this.logger.log(`WAN 2.2 queue status: ${update.status}`);

          // Parse progress from logs
          if (update.status === 'IN_PROGRESS' && 'logs' in update && update.logs?.length) {
            const lastLog = update.logs[update.logs.length - 1]?.message || '';
            const progress = this.parseTrainingProgress(lastLog);
            if (progress !== null && options.onProgress) {
              options.onProgress(progress);
            }
          }

          if (options.onQueueUpdate) {
            options.onQueueUpdate({
              status: update.status,
              logs: 'logs' in update ? update.logs : undefined,
            });
          }
        },
      });

      this.logger.log('=== WAN 2.2 LORA TRAINING COMPLETED ===');

      // Type assertion for the result
      const typedResult = result.data as Wan22TrainingOutput;

      // Validate result structure
      if (!typedResult?.high_noise_lora?.url) {
        this.logger.error(`WAN 2.2 result missing high_noise_lora: ${JSON.stringify(result)}`);
        throw new Error('WAN 2.2 training did not return high_noise_lora');
      }

      this.logger.log(`[LoRA] Training complete`);
      this.logger.log(`[LoRA] Primary LoRA (high noise): ${typedResult.high_noise_lora.url}`);
      this.logger.log(`[LoRA] Diffusers LoRA (reference): ${typedResult.diffusers_lora_file?.url || 'N/A'}`);
      this.logger.log(`[LoRA] Config (reference): ${typedResult.config_file?.url || 'N/A'}`);

      return typedResult;
    } catch (error) {
      const originalError = error instanceof Error ? error : new Error(String(error));
      const formattedError = this.formatNetworkError(originalError, 'WAN 2.2 training');

      this.logger.error(`=== WAN 2.2 LORA TRAINING FAILED ===`);
      this.logger.error(`Error: ${formattedError.message}`);
      this.logger.error(`Stack: ${originalError.stack || ''}`);

      throw formattedError;
    }
  }

  /**
   * Parse training progress from log messages
   * Looks for patterns like "step 500/1000" or "Step: 500/1000"
   */
  private parseTrainingProgress(log: string): number | null {
    if (!log) return null;

    // Match patterns like "step 500/1000", "Step: 500 / 1000", etc.
    const match = log.match(/step\s*:?\s*(\d+)\s*\/\s*(\d+)/i);
    if (match) {
      const current = parseInt(match[1], 10);
      const total = parseInt(match[2], 10);
      if (total > 0) {
        return Math.round((current / total) * 100);
      }
    }
    return null;
  }

  // ============================================
  // IMAGE GENERATION (FLUX with LoRA)
  // ============================================

  /**
   * Submit an image generation job with optional LoRA
   */
  async submitImageGeneration(input: FalImageGenerationInput): Promise<{ request_id: string }> {
    this.logger.log('Submitting image generation to fal.ai');

    // Use FLUX dev with LoRA endpoint
    const endpoint = input.loras?.length
      ? 'fal-ai/flux-lora'
      : 'fal-ai/flux/dev';

    const response = await this.request<{ request_id: string }>(
      endpoint,
      'POST',
      input,
    );

    return response;
  }

  /**
   * Get image generation status
   */
  async getImageGenerationStatus(requestId: string, hasLora: boolean): Promise<FalQueueStatus> {
    const endpoint = hasLora ? 'fal-ai/flux-lora' : 'fal-ai/flux/dev';
    return this.request<FalQueueStatus>(
      `${endpoint}/requests/${requestId}/status`,
      'GET',
    );
  }

  /**
   * Get image generation result
   */
  async getImageGenerationResult(requestId: string, hasLora: boolean): Promise<FalImageGenerationOutput> {
    const endpoint = hasLora ? 'fal-ai/flux-lora' : 'fal-ai/flux/dev';
    return this.request<FalImageGenerationOutput>(
      `${endpoint}/requests/${requestId}`,
      'GET',
    );
  }

  // ============================================
  // FLUX KONTEXT (for character diagrams)
  // ============================================

  /**
   * Submit a FLUX Kontext image edit job
   * Used for generating character diagrams while preserving outfit
   */
  async submitKontextEdit(input: {
    prompt: string;
    image_url: string;
    guidance_scale?: number;
    num_images?: number;
    seed?: number;
  }): Promise<{ request_id: string }> {
    this.logger.log('Submitting FLUX Kontext edit to fal.ai');

    const response = await this.request<{ request_id: string }>(
      'fal-ai/flux-pro/kontext',
      'POST',
      input,
    );

    return response;
  }

  /**
   * Get Kontext edit status
   */
  async getKontextStatus(requestId: string): Promise<FalQueueStatus> {
    return this.request<FalQueueStatus>(
      `fal-ai/flux-pro/kontext/requests/${requestId}/status`,
      'GET',
    );
  }

  /**
   * Get Kontext edit result
   */
  async getKontextResult(requestId: string): Promise<FalImageGenerationOutput> {
    return this.request<FalImageGenerationOutput>(
      `fal-ai/flux-pro/kontext/requests/${requestId}`,
      'GET',
    );
  }

  /**
   * Poll for Kontext completion
   */
  async pollKontext(
    requestId: string,
    options: {
      intervalMs?: number;
      maxAttempts?: number;
    } = {},
  ): Promise<FalImageGenerationOutput> {
    const { intervalMs = 3000, maxAttempts = 60 } = options;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const status = await this.getKontextStatus(requestId);

      if (status.status === 'COMPLETED') {
        return this.getKontextResult(requestId);
      }

      if (status.status === 'FAILED') {
        throw new Error('Kontext generation failed');
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Kontext generation timed out after ${maxAttempts} attempts`);
  }

  // ============================================
  // VIDEO FACE SWAP (WAN with LoRA)
  // ============================================

  /**
   * Submit a video generation with face/identity from LoRA
   * Uses WAN image-to-video with LoRA for identity preservation
   */
  async submitVideoWithLora(input: {
    image_url: string; // Source face image (from character diagram)
    prompt: string; // Description prompt
    lora_url: string; // LoRA weights URL
    lora_scale?: number; // LoRA influence (default 0.8)
    duration?: number; // Video duration in seconds (5 or 10)
    aspect_ratio?: '16:9' | '9:16' | '1:1';
  }): Promise<{ request_id: string }> {
    this.logger.log('Submitting video generation with LoRA to fal.ai');

    // Use WAN 2.1 image-to-video with LoRA
    const response = await this.request<{ request_id: string }>(
      'fal-ai/wan/v2.1/image-to-video',
      'POST',
      {
        image_url: input.image_url,
        prompt: input.prompt,
        loras: [
          {
            path: input.lora_url,
            scale: input.lora_scale ?? 0.8,
          },
        ],
        duration: input.duration ?? 5,
        aspect_ratio: input.aspect_ratio ?? '16:9',
      },
    );

    this.logger.log(`Video generation submitted with request_id: ${response.request_id}`);
    return response;
  }

  /**
   * Get video generation status
   */
  async getVideoGenerationStatus(requestId: string): Promise<FalQueueStatus> {
    return this.request<FalQueueStatus>(
      `fal-ai/wan/v2.1/image-to-video/requests/${requestId}/status`,
      'GET',
    );
  }

  /**
   * Get video generation result
   */
  async getVideoGenerationResult(requestId: string): Promise<{
    video: { url: string };
    seed: number;
  }> {
    return this.request<{ video: { url: string }; seed: number }>(
      `fal-ai/wan/v2.1/image-to-video/requests/${requestId}`,
      'GET',
    );
  }

  /**
   * Poll for video generation completion
   */
  async pollVideoGeneration(
    requestId: string,
    options: {
      intervalMs?: number;
      maxAttempts?: number;
      onProgress?: (status: FalQueueStatus) => void;
    } = {},
  ): Promise<{ video: { url: string }; seed: number }> {
    const { intervalMs = 10000, maxAttempts = 180, onProgress } = options; // Up to 30 minutes

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const status = await this.getVideoGenerationStatus(requestId);

      if (onProgress) {
        onProgress(status);
      }

      if (status.status === 'COMPLETED') {
        return this.getVideoGenerationResult(requestId);
      }

      if (status.status === 'FAILED') {
        throw new Error('Video generation failed');
      }

      this.logger.debug(`Video generation status: ${status.status} (attempt ${attempt + 1}/${maxAttempts})`);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Video generation timed out after ${maxAttempts} attempts`);
  }

  // ============================================
  // WAN ANIMATE REPLACE (character replacement preserving scene)
  // ============================================

  /**
   * Run WAN Animate Replace using fal.ai client
   * Replaces the character in a video while preserving the scene's lighting,
   * background, and color tone. This is actual character replacement.
   */
  async runWanAnimateReplace(input: {
    video_url: string; // Original video (the viral/template video)
    image_url: string; // Character diagram (person to swap in)
    resolution?: '480p' | '580p' | '720p';
    num_inference_steps?: number; // 2-40, higher = better quality but slower
    video_quality?: 'low' | 'medium' | 'high' | 'maximum';
    video_write_mode?: 'fast' | 'balanced' | 'small';
    use_turbo?: boolean;
    onProgress?: (status: { status: string; request_id?: string; logs?: Array<{ message: string }> }) => void;
  }): Promise<{ video: { url: string }; seed: number; prompt?: string }> {
    const endpoint = 'fal-ai/wan/v2.2-14b/animate/replace';
    this.logger.log('=== WAN Animate Replace START ===');
    this.logger.log(`Endpoint: ${endpoint}`);
    this.logger.log(`Video URL: ${input.video_url}`);
    this.logger.log(`Image URL: ${input.image_url}`);
    this.logger.log(`FAL API Key configured: ${!!this.apiKey}, length: ${this.apiKey?.length || 0}`);

    try {
      const apiInput = {
        video_url: input.video_url,
        image_url: input.image_url,
        resolution: input.resolution ?? '720p',
        num_inference_steps: input.num_inference_steps ?? 20,
        video_quality: input.video_quality ?? 'high',
        video_write_mode: input.video_write_mode ?? 'balanced',
        use_turbo: input.use_turbo ?? true,
        enable_safety_checker: false,
      };

      this.logger.log(`API Input: ${JSON.stringify(apiInput, null, 2)}`);

      // Step 1: Submit to queue with retry for network failures
      this.logger.log('Step 1: Submitting to fal.ai queue...');
      const submitResult = await this.withRetry(
        () => fal.queue.submit(endpoint, { input: apiInput }),
        'fal.ai queue submission',
        3,
      );

      const requestId = submitResult.request_id;
      this.logger.log(`=== SUBMISSION SUCCESSFUL ===`);
      this.logger.log(`Request ID from fal.ai: ${requestId}`);
      this.logger.log(`Full submit response: ${JSON.stringify(submitResult, null, 2)}`);

      if (!requestId) {
        throw new Error('fal.ai did not return a request_id - submission may have failed silently');
      }

      // Notify progress callback with request_id
      if (input.onProgress) {
        input.onProgress({ status: 'SUBMITTED', request_id: requestId });
      }

      // Step 2: Poll for status
      this.logger.log('Step 2: Polling for completion...');
      let pollCount = 0;
      const maxPolls = 360; // 30 minutes at 5 second intervals
      const pollInterval = 5000;

      while (pollCount < maxPolls) {
        pollCount++;

        const status = await fal.queue.status(endpoint, {
          requestId,
          logs: true,
        });

        // Type assertion for status with optional logs
        const statusWithLogs = status as { status: string; logs?: Array<{ message: string }> };

        this.logger.log(`[Poll ${pollCount}] Status: ${statusWithLogs.status}, RequestID: ${requestId}`);

        // Log any new logs
        if (statusWithLogs.logs?.length) {
          for (const log of statusWithLogs.logs) {
            this.logger.log(`  [fal.ai] ${log.message}`);
          }
        }

        if (input.onProgress) {
          input.onProgress({
            status: statusWithLogs.status,
            request_id: requestId,
            logs: statusWithLogs.logs,
          });
        }

        if (statusWithLogs.status === 'COMPLETED') {
          // Get the result
          this.logger.log('Step 3: Fetching result...');
          const result = await fal.queue.result(endpoint, { requestId });

          this.logger.log('=== WAN Animate Replace COMPLETED ===');
          this.logger.log(`Request ID: ${requestId}`);
          this.logger.log(`Total polls: ${pollCount}`);
          this.logger.log(`Result: ${JSON.stringify(result, null, 2)}`);

          const typedResult = result.data as {
            video: { url: string };
            seed: number;
            prompt?: string;
          };

          if (!typedResult?.video?.url) {
            this.logger.error(`No video URL in result`);
            throw new Error('WAN Animate Replace returned no video URL');
          }

          return typedResult;
        }

        if (statusWithLogs.status === 'FAILED') {
          this.logger.error(`Job failed on fal.ai: ${JSON.stringify(statusWithLogs, null, 2)}`);
          throw new Error('WAN Animate Replace failed on fal.ai');
        }

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }

      throw new Error(`WAN Animate Replace timed out after ${maxPolls} polls`);
    } catch (error) {
      const originalError = error instanceof Error ? error : new Error(String(error));
      const formattedError = this.formatNetworkError(originalError, 'WAN Animate Replace');

      this.logger.error(`=== WAN Animate Replace FAILED ===`);
      this.logger.error(`Error: ${formattedError.message}`);
      this.logger.error(`Stack: ${originalError.stack || ''}`);

      if (error && typeof error === 'object') {
        const errorObj = error as Record<string, unknown>;
        if (errorObj.body) {
          this.logger.error(`Error body: ${JSON.stringify(errorObj.body, null, 2)}`);
        }
        if (errorObj.status) {
          this.logger.error(`Error status: ${errorObj.status}`);
        }
      }

      throw formattedError;
    }
  }

  // ============================================
  // KLING MOTION CONTROL (for face swap via motion transfer)
  // ============================================

  /**
   * Run Kling motion control using fal.ai client
   * Takes motion from reference video and applies it to a character image
   * This is the primary method for "face swap" - keeps motion, changes identity
   * Uses fal.subscribe() which handles polling automatically
   */
  async runKlingMotionControl(input: {
    prompt?: string;
    image_url: string; // Character/identity reference (character diagram)
    video_url: string; // Motion reference (source video)
    character_orientation?: 'video' | 'image'; // 'video' for complex motion, 'image' for camera movements
    onProgress?: (status: { status: string; logs?: Array<{ message: string }> }) => void;
  }): Promise<{ video: { url: string; file_name: string; content_type: string; file_size: number } }> {
    this.logger.log('Running Kling motion control via fal.ai client');
    this.logger.log(`Input: image_url=${input.image_url.substring(0, 50)}..., video_url=${input.video_url.substring(0, 50)}...`);

    try {
      const result = await fal.subscribe('fal-ai/kling-video/v2.6/pro/motion-control', {
        input: {
          image_url: input.image_url,
          video_url: input.video_url,
          character_orientation: input.character_orientation ?? 'video',
          keep_original_sound: false,
        },
        logs: true,
        onQueueUpdate: (update) => {
          this.logger.log(`Kling queue status: ${update.status}`);
          if (input.onProgress) {
            input.onProgress({
              status: update.status,
              logs: 'logs' in update ? update.logs : undefined,
            });
          }
        },
      });

      this.logger.log('Kling motion control completed');

      // Type assertion for the result
      const typedResult = result.data as { video: { url: string; file_name: string; content_type: string; file_size: number } };

      if (!typedResult?.video?.url) {
        throw new Error('Kling returned no video URL');
      }

      return typedResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Kling motion control failed: ${message}`);
      throw error;
    }
  }

  // Legacy methods kept for compatibility but now unused
  async submitKlingMotionControl(input: {
    prompt: string;
    image_url: string;
    video_url: string;
    character_orientation?: 'video' | 'image';
  }): Promise<{ request_id: string }> {
    // This method is deprecated - use runKlingMotionControl instead
    throw new Error('Use runKlingMotionControl instead - it handles the full flow');
  }

  async getKlingMotionControlStatus(requestId: string): Promise<FalQueueStatus> {
    return this.request<FalQueueStatus>(
      `fal-ai/kling-video/v2.6/pro/motion-control/requests/${requestId}/status`,
      'GET',
    );
  }

  async getKlingMotionControlResult(requestId: string): Promise<{
    video: { url: string; file_name: string; content_type: string; file_size: number };
  }> {
    return this.request<{
      video: { url: string; file_name: string; content_type: string; file_size: number };
    }>(
      `fal-ai/kling-video/v2.6/pro/motion-control/requests/${requestId}`,
      'GET',
    );
  }

  async pollKlingMotionControl(
    requestId: string,
    options: {
      intervalMs?: number;
      maxAttempts?: number;
      onProgress?: (status: FalQueueStatus) => void;
    } = {},
  ): Promise<{ video: { url: string; file_name: string; content_type: string; file_size: number } }> {
    // This method is deprecated - use runKlingMotionControl instead
    throw new Error('Use runKlingMotionControl instead - it handles polling automatically');
  }

  // ============================================
  // FLUX LORA IMAGE GENERATION
  // ============================================

  /**
   * Run FLUX LoRA image generation using fal.ai client
   * Generates images using a trained LoRA model
   */
  async runFluxLoraGeneration(input: {
    prompt: string;
    negative_prompt?: string;
    lora_url: string;
    lora_scale?: number;
    image_size?: { width: number; height: number };
    num_images?: number;
    guidance_scale?: number;
    num_inference_steps?: number;
    onProgress?: (status: { status: string }) => void;
  }): Promise<{ images: Array<{ url: string; width: number; height: number }> }> {
    this.logger.log('Running FLUX LoRA image generation via fal.ai client');
    this.logger.log(`Prompt: ${input.prompt.substring(0, 50)}...`);

    try {
      // Build input with optional negative_prompt (SDK types may not include it)
      const apiInput: Record<string, unknown> = {
        prompt: input.prompt,
        loras: [
          {
            path: input.lora_url,
            scale: input.lora_scale ?? 0.9,
          },
        ],
        image_size: input.image_size ?? { width: 768, height: 1152 }, // Portrait 2:3
        num_images: input.num_images ?? 1,
        output_format: 'jpeg',
        guidance_scale: input.guidance_scale ?? 7.5,
        num_inference_steps: input.num_inference_steps ?? 30,
      };

      if (input.negative_prompt) {
        apiInput.negative_prompt = input.negative_prompt;
      }

      const result = await fal.subscribe('fal-ai/flux-lora', {
        input: apiInput as Parameters<typeof fal.subscribe<'fal-ai/flux-lora'>>[1]['input'],
        logs: true,
        onQueueUpdate: (update) => {
          this.logger.log(`FLUX LoRA queue status: ${update.status}`);
          if (input.onProgress) {
            input.onProgress({ status: update.status });
          }
        },
      });

      this.logger.log('FLUX LoRA generation completed');

      // Type assertion for the result
      const typedResult = result.data as {
        images: Array<{ url: string; width: number; height: number; content_type: string }>;
      };

      if (!typedResult?.images?.length) {
        throw new Error('FLUX LoRA returned no images');
      }

      return {
        images: typedResult.images.map((img) => ({
          url: img.url,
          width: img.width,
          height: img.height,
        })),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`FLUX LoRA generation failed: ${message}`);
      throw error;
    }
  }

  /**
   * Run FLUX LoRA image-to-image generation
   * Transforms an existing image using a LoRA model
   * Useful for replacing a person in an image with the LoRA character
   */
  async runFluxLoraImageToImage(input: {
    image_url: string; // Source image to transform
    prompt?: string; // Optional prompt (describes what you want)
    lora_url: string;
    lora_scale?: number;
    strength?: number; // 0.0 preserves original, 1.0 completely remakes
    num_images?: number;
    onProgress?: (status: { status: string }) => void;
  }): Promise<{ images: Array<{ url: string; width: number; height: number }> }> {
    this.logger.log('Running FLUX LoRA image-to-image via fal.ai client');
    this.logger.log(`Source image: ${input.image_url.substring(0, 50)}...`);

    try {
      const apiInput = {
        image_url: input.image_url,
        prompt: input.prompt || '',
        loras: [
          {
            path: input.lora_url,
            scale: input.lora_scale ?? 0.8,
          },
        ],
        strength: input.strength ?? 0.85,
        num_images: input.num_images ?? 1,
        output_format: 'jpeg',
        guidance_scale: 3.5,
        num_inference_steps: 28,
      };

      const result = await fal.subscribe('fal-ai/flux-lora/image-to-image', {
        input: apiInput as Parameters<typeof fal.subscribe<'fal-ai/flux-lora/image-to-image'>>[1]['input'],
        logs: true,
        onQueueUpdate: (update) => {
          this.logger.log(`FLUX LoRA img2img queue status: ${update.status}`);
          if (input.onProgress) {
            input.onProgress({ status: update.status });
          }
        },
      });

      this.logger.log('FLUX LoRA image-to-image completed');

      const typedResult = result.data as {
        images: Array<{ url: string; width: number; height: number; content_type: string }>;
      };

      if (!typedResult?.images?.length) {
        throw new Error('FLUX LoRA img2img returned no images');
      }

      return {
        images: typedResult.images.map((img) => ({
          url: img.url,
          width: img.width,
          height: img.height,
        })),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`FLUX LoRA img2img failed: ${message}`);
      throw error;
    }
  }

  // ============================================
  // FLUX PULID - Identity-Preserving Generation
  // ============================================

  /**
   * Generate an image using Flux PuLID for natural identity preservation.
   * This produces much more natural results than basic face swap by generating
   * a new image with the identity rather than pasting faces.
   *
   * @param input.prompt - Description of the scene/pose to generate
   * @param input.reference_image_url - Face/identity reference (character diagram)
   * @param input.image_size - Output image dimensions
   * @param input.id_weight - How strongly to preserve identity (0-1, default 1)
   * @param input.start_step - When to apply identity (0-4, lower = more similar, higher = more editable)
   * @param input.num_inference_steps - Quality vs speed (default 20)
   */
  async runFluxPulid(input: {
    prompt: string;
    reference_image_url: string;
    image_size?: 'square_hd' | 'square' | 'portrait_4_3' | 'portrait_16_9' | 'landscape_4_3' | 'landscape_16_9';
    id_weight?: number;
    start_step?: number;
    num_inference_steps?: number;
    seed?: number;
    negative_prompt?: string;
  }): Promise<{ images: Array<{ url: string; width: number; height: number }> }> {
    this.logger.log('Running Flux PuLID generation', {
      prompt: input.prompt.substring(0, 50),
      hasReference: !!input.reference_image_url,
      imageSize: input.image_size,
      idWeight: input.id_weight,
    });

    try {
      const result = await this.withRetry(
        () =>
          fal.subscribe('fal-ai/flux-pulid', {
            input: {
              prompt: input.prompt,
              reference_image_url: input.reference_image_url,
              image_size: input.image_size || 'square_hd',
              id_weight: input.id_weight ?? 1.0,
              start_step: input.start_step ?? 0, // 0 for realistic, 4 for stylized
              num_inference_steps: input.num_inference_steps ?? 20,
              seed: input.seed,
              negative_prompt: input.negative_prompt || 'blurry, low quality, distorted face, deformed',
              guidance_scale: 4,
              true_cfg: 1,
              max_sequence_length: '128' as const,
            },
            logs: true,
          }),
        'fal.ai flux-pulid',
        3,
      );

      const typedResult = result.data as {
        images: Array<{
          url: string;
          width: number;
          height: number;
          content_type: string;
        }>;
        seed: number;
      };

      if (!typedResult?.images || typedResult.images.length === 0) {
        throw new Error('Flux PuLID returned no images');
      }

      this.logger.log(`Flux PuLID completed: ${typedResult.images.length} image(s) generated`);

      return {
        images: typedResult.images.map((img) => ({
          url: img.url,
          width: img.width,
          height: img.height,
        })),
      };
    } catch (error) {
      const originalError = error instanceof Error ? error : new Error(String(error));
      const formattedError = this.formatNetworkError(originalError, 'Flux PuLID');
      this.logger.error(`Flux PuLID failed: ${formattedError.message}`);
      throw formattedError;
    }
  }

  // ============================================
  // IMAGE FACE SWAP (for frame-by-frame processing)
  // ============================================

  /**
   * Run face swap on a single image using fal.subscribe
   * Swaps the face from swap_image onto the base_image
   * This is the primary method for video face swap (called per frame)
   */
  async runFaceSwap(input: {
    base_image_url: string; // Frame from source video
    swap_image_url: string; // Face source (character diagram)
  }): Promise<{ image: { url: string; width: number; height: number } }> {
    try {
      // Use retry for network failures (important for frame-by-frame processing)
      const result = await this.withRetry(
        () =>
          fal.subscribe('fal-ai/face-swap', {
            input: {
              base_image_url: input.base_image_url,
              swap_image_url: input.swap_image_url,
            },
            logs: true,
          }),
        'fal.ai face-swap',
        2, // Fewer retries per frame to avoid long delays
      );

      const typedResult = result.data as {
        image: { url: string; width: number; height: number; content_type: string };
      };

      if (!typedResult?.image?.url) {
        throw new Error('Face swap returned no image URL');
      }

      return {
        image: {
          url: typedResult.image.url,
          width: typedResult.image.width,
          height: typedResult.image.height,
        },
      };
    } catch (error) {
      const originalError = error instanceof Error ? error : new Error(String(error));
      const formattedError = this.formatNetworkError(originalError, 'face swap');
      this.logger.error(`Face swap failed: ${formattedError.message}`);
      throw formattedError;
    }
  }

  /**
   * Submit an image face swap (legacy - prefer runFaceSwap)
   */
  async submitImageFaceSwap(input: {
    base_image_url: string;
    swap_image_url: string;
  }): Promise<{ request_id: string }> {
    this.logger.log('Submitting face swap to fal.ai');

    const response = await this.request<{ request_id: string }>(
      'fal-ai/face-swap',
      'POST',
      {
        base_image_url: input.base_image_url,
        swap_image_url: input.swap_image_url,
      },
    );

    return response;
  }

  /**
   * Get face swap status
   */
  async getFaceSwapStatus(requestId: string): Promise<FalQueueStatus> {
    return this.request<FalQueueStatus>(
      `fal-ai/face-swap/requests/${requestId}/status`,
      'GET',
    );
  }

  /**
   * Get face swap result
   */
  async getFaceSwapResult(requestId: string): Promise<{
    image: { url: string; width: number; height: number };
  }> {
    return this.request<{ image: { url: string; width: number; height: number } }>(
      `fal-ai/face-swap/requests/${requestId}`,
      'GET',
    );
  }

  /**
   * Poll for face swap completion
   */
  async pollFaceSwap(
    requestId: string,
    options: {
      intervalMs?: number;
      maxAttempts?: number;
    } = {},
  ): Promise<{ image: { url: string; width: number; height: number } }> {
    const { intervalMs = 2000, maxAttempts = 60 } = options;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const status = await this.getFaceSwapStatus(requestId);

      if (status.status === 'COMPLETED') {
        return this.getFaceSwapResult(requestId);
      }

      if (status.status === 'FAILED') {
        throw new Error('Face swap failed');
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Face swap timed out after ${maxAttempts} attempts`);
  }

  // ============================================
  // VIDEO GENERATION MODELS FOR NANO KLING
  // ============================================

  /**
   * Run WAN v2.2 video generation with motion control
   * Fast option for video generation from regenerated frame
   */
  async runWanVideoGeneration(input: {
    image_url: string; // Regenerated frame
    video_url: string; // Motion reference video
    resolution?: '480p' | '580p' | '720p';
    onProgress?: (status: { status: string; logs?: Array<{ message: string }> }) => void;
  }): Promise<{ video: { url: string; file_name: string; content_type: string; file_size: number } }> {
    this.logger.log('Running WAN v2.2 video generation via fal.ai client');
    this.logger.log(`Input: image_url=${input.image_url.substring(0, 50)}..., video_url=${input.video_url.substring(0, 50)}...`);

    try {
      const result = await fal.subscribe('fal-ai/wan/v2.2-14b/animate/replace', {
        input: {
          image_url: input.image_url,
          video_url: input.video_url,
          resolution: input.resolution ?? '720p',
        },
        logs: true,
        onQueueUpdate: (update) => {
          this.logger.log(`WAN queue status: ${update.status}`);
          if (input.onProgress) {
            input.onProgress({
              status: update.status,
              logs: 'logs' in update ? update.logs : undefined,
            });
          }
        },
      });

      this.logger.log('WAN video generation completed');

      // Type assertion for the result
      const typedResult = result.data as { video: { url: string; file_name: string; content_type: string; file_size: number } };

      if (!typedResult?.video?.url) {
        throw new Error('WAN returned no video URL');
      }

      return typedResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`WAN video generation failed: ${message}`);
      throw error;
    }
  }

  /**
   * Run Sora-style premium video generation
   * Uses Luma Dream Machine as a premium alternative (highest quality)
   * Note: When OpenAI Sora API becomes available, this can be updated
   */
  async runSoraVideoGeneration(input: {
    image_url: string; // Regenerated frame
    video_url: string; // Motion reference video (for prompt extraction)
    prompt?: string; // Optional custom prompt
    onProgress?: (status: { status: string; logs?: Array<{ message: string }> }) => void;
  }): Promise<{ video: { url: string; file_name: string; content_type: string; file_size: number } }> {
    this.logger.log('Running premium video generation (Luma Dream Machine) via fal.ai client');
    this.logger.log(`Input: image_url=${input.image_url.substring(0, 50)}...`);

    try {
      // Use Luma Dream Machine for premium quality image-to-video
      // This provides cinematic quality similar to Sora
      const result = await fal.subscribe('fal-ai/luma-dream-machine/image-to-video', {
        input: {
          image_url: input.image_url,
          prompt: input.prompt || 'Continue this scene naturally with smooth, cinematic motion. Maintain the exact appearance of the person.',
          aspect_ratio: '9:16', // Portrait for social content
          loop: false,
        },
        logs: true,
        onQueueUpdate: (update) => {
          this.logger.log(`Luma queue status: ${update.status}`);
          if (input.onProgress) {
            input.onProgress({
              status: update.status,
              logs: 'logs' in update ? update.logs : undefined,
            });
          }
        },
      });

      this.logger.log('Luma video generation completed');

      // Type assertion for the result
      const typedResult = result.data as { video: { url: string; file_name?: string; content_type?: string; file_size?: number } };

      if (!typedResult?.video?.url) {
        throw new Error('Luma returned no video URL');
      }

      // Normalize the result format
      return {
        video: {
          url: typedResult.video.url,
          file_name: typedResult.video.file_name || 'video.mp4',
          content_type: typedResult.video.content_type || 'video/mp4',
          file_size: typedResult.video.file_size || 0,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Premium video generation failed: ${message}`);
      throw error;
    }
  }

  /**
   * Run Sora 2 Pro video generation using OpenAI's Sora API
   * Premium video generation with highest quality and realism
   *
   * API Parameters:
   * - model: 'sora-2' or 'sora-2-pro'
   * - prompt: string describing the video
   * - seconds: 4, 8, or 12 (NOT 'duration')
   * - size: '720x1280' (portrait) or '1280x720' (landscape)
   * - input_reference: File for image-to-video (requires multipart/form-data)
   */
  async runSora2ProVideoGeneration(input: {
    image_url: string; // Starting image for image-to-video
    video_url: string; // Motion reference (unused for Sora, kept for interface compatibility)
    prompt?: string; // Optional custom prompt
    seconds?: 4 | 8 | 12; // Video duration
    onProgress?: (status: { status: string; logs?: Array<{ message: string }> }) => void;
  }): Promise<{ video: { url: string; file_name: string; content_type: string; file_size: number } }> {
    this.logger.log('Running Sora 2 Pro video generation via OpenAI');
    this.logger.log(`Input: image_url=${input.image_url.substring(0, 50)}...`);

    const openaiApiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    try {
      if (input.onProgress) {
        input.onProgress({ status: 'STARTING', logs: [{ message: 'Initializing OpenAI Sora...' }] });
      }

      const prompt = input.prompt || 'Continue this scene naturally with smooth, cinematic motion. Maintain the exact appearance of the person. High quality, photorealistic.';
      this.logger.log(`Sora prompt: ${prompt}`);

      if (input.onProgress) {
        input.onProgress({ status: 'GENERATING', logs: [{ message: 'Downloading reference image...' }] });
      }

      // Download the reference image for input_reference
      const imageBuffer = await this.downloadFileAsBuffer(input.image_url);
      this.logger.log(`Downloaded image: ${imageBuffer.length} bytes`);

      if (input.onProgress) {
        input.onProgress({ status: 'GENERATING', logs: [{ message: 'Submitting to Sora API...' }] });
      }

      // Use FormData for multipart request (required for input_reference)
      const formData = new FormData();
      formData.append('model', 'sora-2-pro');
      formData.append('prompt', prompt);
      formData.append('seconds', String(input.seconds || 8)); // Allowed: 4, 8, 12
      formData.append('size', '1280x720'); // Landscape for video content

      // Create a Blob from the buffer for the input_reference
      // Convert Buffer to Uint8Array for Blob compatibility
      const imageBlob = new Blob([new Uint8Array(imageBuffer)], { type: 'image/jpeg' });
      formData.append('input_reference', imageBlob, 'reference.jpg');

      // Submit to OpenAI Sora API
      const createResponse = await fetch('https://api.openai.com/v1/videos', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
        },
        body: formData,
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        this.logger.error(`Sora API error: ${createResponse.status} - ${errorText}`);
        throw new Error(`OpenAI Sora API error (${createResponse.status}): ${errorText}`);
      }

      const createResult = await createResponse.json();
      this.logger.log(`Sora job created: ${JSON.stringify(createResult)}`);

      const jobId = createResult?.id;
      if (!jobId) {
        throw new Error('OpenAI Sora did not return a job ID');
      }

      if (input.onProgress) {
        input.onProgress({ status: 'IN_PROGRESS', logs: [{ message: `Job ${jobId} created, waiting for completion...` }] });
      }

      // Poll for completion
      const videoUrl = await this.pollSoraCompletion(openaiApiKey, jobId, input.onProgress);

      if (input.onProgress) {
        input.onProgress({ status: 'COMPLETED', logs: [{ message: 'Video generation complete' }] });
      }

      this.logger.log('Sora 2 Pro video generation completed');

      return {
        video: {
          url: videoUrl,
          file_name: 'sora_video.mp4',
          content_type: 'video/mp4',
          file_size: 0,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Sora 2 Pro video generation failed: ${message}`);

      if (error instanceof Error && error.stack) {
        this.logger.error(`Stack: ${error.stack}`);
      }

      throw error;
    }
  }

  /**
   * Poll OpenAI Sora API for job completion
   */
  private async pollSoraCompletion(
    apiKey: string,
    videoId: string,
    onProgress?: (status: { status: string; logs?: Array<{ message: string }> }) => void,
    maxAttempts = 120, // 10 minutes at 5s intervals
    intervalMs = 5000,
  ): Promise<string> {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));

      const response = await fetch(`https://api.openai.com/v1/videos/${videoId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn(`Sora poll error: ${response.status} - ${errorText}`);
        continue; // Keep polling on transient errors
      }

      const video = await response.json();
      const progress = video?.progress || 0;

      this.logger.log(`Sora status: ${video?.status}, progress: ${progress}%`);

      if (onProgress) {
        onProgress({
          status: video?.status || 'POLLING',
          logs: [{ message: `Poll ${i + 1}: ${video?.status} (${progress}%)` }],
        });
      }

      if (video?.status === 'completed') {
        // Get the video URL - might be in different fields
        const videoUrl = video?.url || video?.video_url || video?.output?.url;
        if (!videoUrl) {
          throw new Error('Sora completed but no video URL returned');
        }
        return videoUrl;
      }

      if (video?.status === 'failed') {
        throw new Error(`Sora generation failed: ${video?.error || 'Unknown error'}`);
      }
    }

    throw new Error('Sora generation timed out after 10 minutes');
  }

  /**
   * Download a file from URL as a Buffer
   */
  private async downloadFileAsBuffer(url: string): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // ==================== POSE DETECTION ====================

  /**
   * Run DWPose for skeleton detection
   * Returns pose data and skeleton visualization image
   */
  async runDWPose(input: {
    image_url: string;
  }): Promise<{
    image: { url: string };
    poses: Array<{
      body: Array<{ x: number; y: number; score: number }>;
      face?: Array<{ x: number; y: number; score: number }>;
      hands?: Array<{ x: number; y: number; score: number }>;
    }>;
  }> {
    this.logger.log('Running DWPose skeleton detection');

    try {
      const result = await fal.subscribe('fal-ai/dwpose', {
        input: {
          image_url: input.image_url,
        },
        logs: true,
      });

      this.logger.log('DWPose detection completed');

      const typedResult = result.data as {
        image: { url: string };
        poses?: Array<{
          body: Array<{ x: number; y: number; score: number }>;
          face?: Array<{ x: number; y: number; score: number }>;
          hands?: Array<{ x: number; y: number; score: number }>;
        }>;
      };

      return {
        image: typedResult.image,
        poses: typedResult.poses || [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`DWPose detection failed: ${message}`);
      throw error;
    }
  }

  /**
   * Run full pose detection using DWPose only
   * DWPose includes body, face, and hand keypoints in one call
   * Face detection endpoint doesn't exist on fal.ai, so we use DWPose for everything
   */
  async runFullPoseDetection(input: {
    image_url: string;
  }): Promise<{
    skeleton_url: string;
    body: {
      keypoints: Array<{ x: number; y: number; score: number }>;
    } | null;
    face: {
      bbox: [number, number, number, number];
      landmarks: Array<{ x: number; y: number }>;
      mouth_open: number;
      eye_aspect_ratio: number;
    } | null;
    hands: Array<{ x: number; y: number; score: number }> | null;
  }> {
    this.logger.log('Running full pose detection with DWPose');

    // DWPose gives us body + face + hands in one call
    const poseResult = await this.runDWPose({ image_url: input.image_url });
    const bodyPose = poseResult.poses?.[0];

    // DWPose skeleton image includes face visualization
    // We don't have separate face landmarks, but the skeleton is sufficient for motion tracking
    return {
      skeleton_url: poseResult.image.url,
      body: bodyPose
        ? {
            keypoints: bodyPose.body || [],
          }
        : null,
      // Face detection not available - return null
      // The skeleton image still includes face visualization from DWPose
      face: null,
      hands: bodyPose?.hands || null,
    };
  }

  /**
   * Describe facial expression from landmarks for prompt generation
   */
  describeFacialExpression(face: {
    mouth_open?: number;
    eye_aspect_ratio?: number;
    landmarks?: Array<{ x: number; y: number }>;
  }): string {
    const descriptions: string[] = [];

    if (face.mouth_open && face.mouth_open > 0.3) {
      if (face.mouth_open > 0.6) {
        descriptions.push('mouth wide open');
      } else {
        descriptions.push('mouth slightly open');
      }
    } else {
      descriptions.push('mouth closed');
    }

    if (face.eye_aspect_ratio) {
      if (face.eye_aspect_ratio < 0.15) {
        descriptions.push('eyes closed or squinting');
      } else if (face.eye_aspect_ratio > 0.35) {
        descriptions.push('eyes wide open');
      }
    }

    return descriptions.length > 0 ? descriptions.join(', ') : 'neutral expression';
  }

  // ==================== UPSCALING ====================

  /**
   * Run Real-ESRGAN for fast image upscaling
   * Good for general purpose upscaling with optional face enhancement
   */
  async runRealEsrgan(input: {
    image_url: string;
    scale?: 2 | 4;
    face_enhance?: boolean;
  }): Promise<{ image: { url: string; width: number; height: number } }> {
    this.logger.log(`Running Real-ESRGAN upscaling (scale: ${input.scale || 4}x)`);

    try {
      const result = await fal.subscribe('fal-ai/real-esrgan', {
        input: {
          image_url: input.image_url,
          scale: input.scale ?? 4,
          face_enhance: input.face_enhance ?? true,
        },
        logs: true,
      });

      this.logger.log('Real-ESRGAN upscaling completed');

      const typedResult = result.data as {
        image: { url: string; width: number; height: number };
      };

      return typedResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Real-ESRGAN upscaling failed: ${message}`);
      throw error;
    }
  }

  /**
   * Run Clarity Upscaler (Topaz-style quality upscaling)
   * Better quality than Real-ESRGAN but slower
   */
  async runClarityUpscaler(input: {
    image_url: string;
    scale_factor?: number; // 1-4
    creativity?: number; // 0-1, lower = more faithful
    resemblance?: number; // 0-1, higher = more similar
    prompt?: string;
  }): Promise<{ image: { url: string } }> {
    this.logger.log(`Running Clarity upscaler (scale: ${input.scale_factor || 2}x)`);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (fal.subscribe as any)('fal-ai/clarity-upscaler', {
        input: {
          image_url: input.image_url,
          upscale_factor: input.scale_factor ?? 2,
          creativity: input.creativity ?? 0.2, // Low for faithful upscale
          prompt: input.prompt,
        },
        logs: true,
      });

      this.logger.log('Clarity upscaling completed');

      const typedResult = result.data as { image: { url: string } };

      return typedResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Clarity upscaling failed: ${message}`);
      throw error;
    }
  }

  /**
   * Run Creative Upscaler (AI-enhanced upscaling with detail generation)
   * Adds AI-generated details for best visual quality
   */
  async runCreativeUpscaler(input: {
    image_url: string;
    scale?: 2 | 4;
    creativity?: number; // 0-1, higher = more AI enhancement
    detail?: number; // 0-1, higher = more detail
    resemblance?: number; // 0-1, higher = more similar to original
  }): Promise<{ image: { url: string } }> {
    this.logger.log(`Running Creative upscaler (scale: ${input.scale || 2}x)`);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (fal.subscribe as any)('fal-ai/creative-upscaler', {
        input: {
          image_url: input.image_url,
          scale: input.scale ?? 2,
          creativity: input.creativity ?? 0.5,
          detail: input.detail ?? 1.0,
        },
        logs: true,
      });

      this.logger.log('Creative upscaling completed');

      const typedResult = result.data as { image: { url: string } };

      return typedResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Creative upscaling failed: ${message}`);
      throw error;
    }
  }

  /**
   * Upscale an image using the specified method
   * Convenience method that routes to the appropriate upscaler
   */
  async upscaleImage(
    imageUrl: string,
    method: 'real-esrgan' | 'clarity' | 'creative',
    resolution: '2k' | '4k' = '2k',
  ): Promise<{ url: string }> {
    const scale = resolution === '4k' ? 4 : 2;

    switch (method) {
      case 'real-esrgan':
        const esrganResult = await this.runRealEsrgan({
          image_url: imageUrl,
          scale: scale as 2 | 4,
          face_enhance: true,
        });
        return { url: esrganResult.image.url };

      case 'clarity':
        const clarityResult = await this.runClarityUpscaler({
          image_url: imageUrl,
          scale_factor: scale,
          creativity: 0.2,
          resemblance: 0.9,
        });
        return { url: clarityResult.image.url };

      case 'creative':
        const creativeResult = await this.runCreativeUpscaler({
          image_url: imageUrl,
          scale: scale as 2 | 4,
          creativity: 0.5,
          detail: 1.0,
          resemblance: 0.8,
        });
        return { url: creativeResult.image.url };

      default:
        throw new Error(`Unknown upscale method: ${method}`);
    }
  }
}
