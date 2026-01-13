import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../modules/files/supabase.service';

export interface LocalImageGenerationParams {
  prompt: string;
  negativePrompt?: string;
  sourceImage?: string; // Base64 for img2img
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  denoisingStrength?: number;
}

export interface LocalFaceSwapParams {
  baseImageUrl: string;
  faceImageUrl: string;
  faceRestorerVisibility?: number;
}

@Injectable()
export class LocalAIService implements OnModuleInit {
  private readonly logger = new Logger(LocalAIService.name);
  private a1111Url: string;
  private comfyuiUrl: string;
  private enabled: boolean;

  constructor(
    private configService: ConfigService,
    private supabase: SupabaseService,
  ) {
    this.a1111Url = this.configService.get<string>('A1111_API_URL') || 'http://localhost:7860';
    this.comfyuiUrl = this.configService.get<string>('COMFYUI_API_URL') || 'http://localhost:8188';
    this.enabled = this.configService.get<string>('LOCAL_AI_ENABLED') === 'true';
  }

  async onModuleInit() {
    if (this.enabled) {
      this.logger.log('Local AI fallback enabled');
      this.logger.log(`A1111 URL: ${this.a1111Url}`);
      this.logger.log(`ComfyUI URL: ${this.comfyuiUrl}`);

      // Check connectivity on startup
      const available = await this.isAvailable();
      if (available) {
        this.logger.log('Local AI (Automatic1111) is available');
      } else {
        this.logger.warn('Local AI (Automatic1111) is not available - fallback will not work');
      }
    } else {
      this.logger.log('Local AI fallback disabled');
    }
  }

  /**
   * Check if local AI is enabled in config
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Check if local AI (Automatic1111) is available
   */
  async isAvailable(): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.a1111Url}/sdapi/v1/options`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      return response.ok;
    } catch (error) {
      this.logger.debug(`Local AI not available: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }

  /**
   * Check if ComfyUI is available
   */
  async isComfyUIAvailable(): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.comfyuiUrl}/system_stats`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Generate image with Automatic1111 (SDXL)
   * Returns the URL of the generated image
   */
  async generateImage(params: LocalImageGenerationParams): Promise<string> {
    this.logger.log('Generating image with local Automatic1111');

    const endpoint = params.sourceImage
      ? `${this.a1111Url}/sdapi/v1/img2img`
      : `${this.a1111Url}/sdapi/v1/txt2img`;

    const body: Record<string, unknown> = {
      prompt: params.prompt,
      negative_prompt: params.negativePrompt || 'low quality, blurry, bad anatomy, extra fingers, distorted face, deformed, ugly, watermark, text',
      width: params.width || 1024,
      height: params.height || 1024,
      steps: params.steps || 30,
      cfg_scale: params.cfgScale || 7,
      sampler_name: 'DPM++ 2M Karras',
    };

    if (params.sourceImage) {
      body.init_images = [params.sourceImage];
      body.denoising_strength = params.denoisingStrength ?? 0.5;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Local AI image generation failed: ${error}`);
    }

    const result = await response.json();

    if (!result.images || result.images.length === 0) {
      throw new Error('Local AI returned no images');
    }

    // Result contains base64 image
    const base64Image = result.images[0];

    // Upload to storage and return URL
    const buffer = Buffer.from(base64Image, 'base64');
    const url = await this.uploadToStorage(buffer, 'local-gen.png');

    this.logger.log('Local AI image generation complete');
    return url;
  }

  /**
   * Face swap with local ReActor/InsightFace extension
   */
  async faceSwap(params: LocalFaceSwapParams): Promise<string> {
    this.logger.log('Performing face swap with local ReActor');

    const [baseImage, faceImage] = await Promise.all([
      this.urlToBase64(params.baseImageUrl),
      this.urlToBase64(params.faceImageUrl),
    ]);

    // Using ReActor extension in A1111
    const response = await fetch(`${this.a1111Url}/sdapi/v1/img2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        init_images: [baseImage],
        denoising_strength: 0.1, // Very low to preserve the image
        prompt: '',
        negative_prompt: '',
        steps: 20,
        width: 1024,
        height: 1024,
        alwayson_scripts: {
          reactor: {
            args: {
              enabled: true,
              source_image: faceImage,
              face_restorer_name: 'CodeFormer',
              face_restorer_visibility: params.faceRestorerVisibility ?? 1,
              restore_first: 1,
              upscaler_name: 'None',
              upscaler_scale: 1,
              upscaler_visibility: 0,
              swap_in_source_face_index: 0,
              swap_in_generated_face_index: 0,
              gender_source: 0,
              gender_target: 0,
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Local face swap failed: ${error}`);
    }

    const result = await response.json();

    if (!result.images || result.images.length === 0) {
      throw new Error('Local face swap returned no images');
    }

    const buffer = Buffer.from(result.images[0], 'base64');
    const url = await this.uploadToStorage(buffer, 'local-faceswap.png');

    this.logger.log('Local face swap complete');
    return url;
  }

  /**
   * Upscale with local Real-ESRGAN
   */
  async upscale(imageUrl: string, scale: number = 2): Promise<string> {
    this.logger.log(`Upscaling image with local Real-ESRGAN (${scale}x)`);

    const base64Image = await this.urlToBase64(imageUrl);

    const response = await fetch(`${this.a1111Url}/sdapi/v1/extra-single-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: base64Image,
        upscaler_1: 'R-ESRGAN 4x+',
        upscaling_resize: scale,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Local upscaling failed: ${error}`);
    }

    const result = await response.json();

    if (!result.image) {
      throw new Error('Local upscaling returned no image');
    }

    const buffer = Buffer.from(result.image, 'base64');
    const url = await this.uploadToStorage(buffer, 'local-upscaled.png');

    this.logger.log('Local upscaling complete');
    return url;
  }

  /**
   * Generate video with AnimateDiff via ComfyUI
   * This is more complex and requires a workflow setup
   */
  async generateVideo(imageUrl: string, prompt: string): Promise<string> {
    this.logger.log('Generating video with local AnimateDiff (ComfyUI)');

    // Check if ComfyUI is available
    const available = await this.isComfyUIAvailable();
    if (!available) {
      throw new Error('ComfyUI is not available for video generation');
    }

    // Build AnimateDiff workflow
    const workflow = this.buildAnimateDiffWorkflow(imageUrl, prompt);

    // Queue workflow in ComfyUI
    const response = await fetch(`${this.comfyuiUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ComfyUI workflow queue failed: ${error}`);
    }

    const { prompt_id } = await response.json();

    // Poll for completion
    const videoPath = await this.pollComfyUIResult(prompt_id);

    // Upload video to storage
    const videoBuffer = await this.downloadComfyUIOutput(videoPath);
    const url = await this.uploadVideoToStorage(videoBuffer, 'local-video.mp4');

    this.logger.log('Local video generation complete');
    return url;
  }

  /**
   * Build AnimateDiff workflow for ComfyUI
   */
  private buildAnimateDiffWorkflow(imageUrl: string, prompt: string): Record<string, unknown> {
    // Simplified AnimateDiff workflow
    // In production, this would be a full workflow JSON exported from ComfyUI
    return {
      '1': {
        class_type: 'LoadImage',
        inputs: { image: imageUrl },
      },
      '2': {
        class_type: 'CLIPTextEncode',
        inputs: { text: prompt, clip: ['4', 0] },
      },
      '3': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'low quality, blurry, distorted', clip: ['4', 0] },
      },
      '4': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' },
      },
      '5': {
        class_type: 'ADE_AnimateDiffLoaderGen1',
        inputs: {
          model_name: 'mm_sd_v15_v2.ckpt',
          model: ['4', 0],
        },
      },
      // ... additional nodes for full AnimateDiff pipeline
    };
  }

  /**
   * Poll ComfyUI for workflow completion
   */
  private async pollComfyUIResult(promptId: string, maxPolls = 120): Promise<string> {
    const pollInterval = 5000; // 5 seconds

    for (let i = 0; i < maxPolls; i++) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));

      const response = await fetch(`${this.comfyuiUrl}/history/${promptId}`);
      const history = await response.json();

      if (history[promptId]?.status?.completed) {
        // Get output file path
        const outputs = history[promptId].outputs;
        for (const nodeId of Object.keys(outputs)) {
          if (outputs[nodeId].gifs?.[0]) {
            return outputs[nodeId].gifs[0].filename;
          }
          if (outputs[nodeId].videos?.[0]) {
            return outputs[nodeId].videos[0].filename;
          }
        }
        throw new Error('ComfyUI workflow completed but no video output found');
      }

      if (history[promptId]?.status?.status_str === 'error') {
        throw new Error('ComfyUI workflow failed');
      }
    }

    throw new Error('ComfyUI workflow timed out');
  }

  /**
   * Download output file from ComfyUI
   */
  private async downloadComfyUIOutput(filename: string): Promise<Buffer> {
    const response = await fetch(`${this.comfyuiUrl}/view?filename=${filename}&type=output`);
    if (!response.ok) {
      throw new Error(`Failed to download ComfyUI output: ${filename}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Convert URL to base64
   */
  private async urlToBase64(url: string): Promise<string> {
    // Handle data URLs
    if (url.startsWith('data:')) {
      return url.split(',')[1];
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${url}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return buffer.toString('base64');
  }

  /**
   * Upload image buffer to Supabase storage
   */
  private async uploadToStorage(buffer: Buffer, filename: string): Promise<string> {
    const uniqueFilename = `local-ai/${Date.now()}-${filename}`;
    const result = await this.supabase.uploadFile('character-images', uniqueFilename, buffer, 'image/png');
    return result.url;
  }

  /**
   * Upload video buffer to Supabase storage
   */
  private async uploadVideoToStorage(buffer: Buffer, filename: string): Promise<string> {
    const uniqueFilename = `local-ai/${Date.now()}-${filename}`;
    const result = await this.supabase.uploadFile('processed-videos', uniqueFilename, buffer, 'video/mp4');
    return result.url;
  }
}
