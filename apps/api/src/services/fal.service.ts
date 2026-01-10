import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fal } from '@fal-ai/client';

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

  onModuleInit() {
    // Configure the fal.ai client with API key
    if (this.apiKey) {
      fal.config({
        credentials: this.apiKey,
      });
      this.logger.log('fal.ai client configured');
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
    onProgress?: (status: { status: string; logs?: Array<{ message: string }> }) => void;
  }): Promise<{ video: { url: string }; seed: number; prompt?: string }> {
    this.logger.log('Running WAN Animate Replace via fal.ai client');
    this.logger.log(`Input: video_url=${input.video_url.substring(0, 50)}..., image_url=${input.image_url.substring(0, 50)}...`);

    try {
      // Use type assertion since SDK types may not include all valid parameters
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

      const result = await fal.subscribe('fal-ai/wan/v2.2-14b/animate/replace', {
        input: apiInput as Parameters<typeof fal.subscribe<'fal-ai/wan/v2.2-14b/animate/replace'>>[1]['input'],
        logs: true,
        onQueueUpdate: (update) => {
          this.logger.log(`WAN Animate Replace queue status: ${update.status}`);
          if (input.onProgress) {
            input.onProgress({
              status: update.status,
              logs: 'logs' in update ? update.logs : undefined,
            });
          }
        },
      });

      this.logger.log('WAN Animate Replace completed');

      // Type assertion for the result
      const typedResult = result.data as {
        video: { url: string };
        seed: number;
        prompt?: string;
      };

      if (!typedResult?.video?.url) {
        throw new Error('WAN Animate Replace returned no video URL');
      }

      return typedResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`WAN Animate Replace failed: ${message}`);
      throw error;
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
    lora_url: string;
    lora_scale?: number;
    aspect_ratio?: '1:1' | '16:9' | '9:16' | '4:5' | '3:4';
    num_images?: number;
    onProgress?: (status: { status: string }) => void;
  }): Promise<{ images: Array<{ url: string; width: number; height: number }> }> {
    this.logger.log('Running FLUX LoRA image generation via fal.ai client');
    this.logger.log(`Prompt: ${input.prompt.substring(0, 50)}...`);

    // Map aspect ratios to fal.ai image_size format
    const aspectRatioMap: Record<string, 'square' | 'landscape_16_9' | 'portrait_16_9' | 'portrait_4_3'> = {
      '1:1': 'square',
      '16:9': 'landscape_16_9',
      '9:16': 'portrait_16_9',
      '4:5': 'portrait_4_3',
      '3:4': 'portrait_4_3',
    };

    try {
      const imageSize = aspectRatioMap[input.aspect_ratio ?? '1:1'] || 'square';

      const result = await fal.subscribe('fal-ai/flux-lora', {
        input: {
          prompt: input.prompt,
          loras: [
            {
              path: input.lora_url,
              scale: input.lora_scale ?? 0.8,
            },
          ],
          image_size: imageSize,
          num_images: input.num_images ?? 1,
          output_format: 'jpeg',
          guidance_scale: 3.5,
          num_inference_steps: 28,
        },
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
      const result = await fal.subscribe('fal-ai/face-swap', {
        input: {
          base_image_url: input.base_image_url,
          swap_image_url: input.swap_image_url,
        },
        logs: true,
      });

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
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Face swap failed: ${message}`);
      throw error;
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
}
