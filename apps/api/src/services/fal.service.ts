import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// fal.ai API types
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
export class FalService {
  private readonly logger = new Logger(FalService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://queue.fal.run';

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('FAL_API_KEY') || '';
    if (!this.apiKey) {
      this.logger.warn('FAL_API_KEY not configured. fal.ai operations will fail.');
    }
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
    this.logger.log('Submitting LoRA training job to fal.ai');

    const response = await this.request<{ request_id: string }>(
      'fal-ai/flux-lora-fast-training',
      'POST',
      input,
    );

    this.logger.log(`LoRA training submitted with request_id: ${response.request_id}`);
    return response;
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

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const status = await this.getLoraTrainingStatus(requestId);

      if (onProgress) {
        onProgress(status);
      }

      if (status.status === 'COMPLETED') {
        return this.getLoraTrainingResult(requestId);
      }

      if (status.status === 'FAILED') {
        throw new Error('LoRA training failed');
      }

      this.logger.debug(`LoRA training status: ${status.status} (attempt ${attempt + 1}/${maxAttempts})`);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`LoRA training timed out after ${maxAttempts} attempts`);
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
}
