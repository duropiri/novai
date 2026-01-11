import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queues.constants';
import { JobsService } from '../jobs.service';
import { GeminiService } from '../../../services/gemini.service';
import { FalService } from '../../../services/fal.service';
import { SupabaseService } from '../../files/supabase.service';

interface PhotoJobData {
  jobId: string;
  diagramId: string;
  sourceImageUrl: string;
  name: string;
}

interface LoraJobData {
  jobId: string;
  diagramId: string;
  loraId: string;
  triggerWord: string;
  weightsUrl: string;
  name: string;
}

@Processor(QUEUES.CHARACTER_DIAGRAM)
export class CharacterProcessor extends WorkerHost {
  private readonly logger = new Logger(CharacterProcessor.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly geminiService: GeminiService,
    private readonly falService: FalService,
    private readonly supabase: SupabaseService,
  ) {
    super();
  }

  async process(job: Job<PhotoJobData | LoraJobData>): Promise<void> {
    // Validate job data before processing
    if (!job.data?.jobId || !job.data?.diagramId) {
      this.logger.warn(`Skipping job with invalid data: ${JSON.stringify(job.data)}`);
      return;
    }

    // Route to appropriate processor based on job name
    if (job.name === 'generate-from-lora') {
      return this.processFromLora(job as Job<LoraJobData>);
    }
    // Default to photo-based (handles both 'generate' and 'generate-from-photo')
    return this.processFromPhoto(job as Job<PhotoJobData>);
  }

  /**
   * Process character diagram from uploaded photo
   */
  private async processFromPhoto(job: Job<PhotoJobData>): Promise<void> {
    const { jobId, diagramId, sourceImageUrl } = job.data;

    try {
      await this.jobsService.markJobProcessing(jobId);
      await this.supabase.updateCharacterDiagram(diagramId, { status: 'processing' });

      this.logger.log(`Processing character diagram from photo ${jobId}`, {
        diagramId,
        sourceImageUrl,
      });

      // Generate character diagram using Google Gemini
      const result = await this.geminiService.generateCharacterDiagram(sourceImageUrl);

      this.logger.log(`Character diagram generated for ${diagramId}`);

      // Convert base64 to buffer
      const imageBuffer = Buffer.from(result.imageBase64, 'base64');

      // Upload to Supabase storage
      const filePath = `${diagramId}/diagram.${result.mimeType.includes('png') ? 'png' : 'jpg'}`;
      const { url: fileUrl } = await this.supabase.uploadFile(
        'character-images',
        filePath,
        imageBuffer,
        result.mimeType,
      );

      // Update character diagram with result
      // Cost: ~$0.02 per image with Gemini
      const costCents = 2;
      await this.supabase.updateCharacterDiagram(diagramId, {
        status: 'ready',
        file_url: fileUrl,
        cost_cents: costCents,
      });

      // Mark job as completed
      await this.jobsService.markJobCompleted(
        jobId,
        {
          fileUrl,
          mimeType: result.mimeType,
        },
        costCents,
      );

      this.logger.log(`Character diagram job ${jobId} completed successfully`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed character diagram job ${jobId}: ${errorMessage}`);

      if (diagramId) {
        await this.supabase.updateCharacterDiagram(diagramId, {
          status: 'failed',
          error_message: errorMessage,
        });
      }

      if (jobId) {
        await this.jobsService.markJobFailed(jobId, errorMessage);
      }
      throw error;
    }
  }

  /**
   * Process character diagram from LoRA model
   * Step 1: Generate reference photo using Flux + LoRA
   * Step 2: Pass that photo to existing character diagram pipeline (same as photo upload)
   */
  private async processFromLora(job: Job<LoraJobData>): Promise<void> {
    const { jobId, diagramId, loraId, triggerWord, weightsUrl, name } = job.data;

    try {
      await this.jobsService.markJobProcessing(jobId);
      await this.supabase.updateCharacterDiagram(diagramId, { status: 'processing' });

      this.logger.log(`Processing character diagram from LoRA ${loraId}`, {
        diagramId,
        triggerWord,
        name,
      });

      // Step 1: Generate reference photo using Flux + LoRA
      this.logger.log('Step 1: Generating reference photo from LoRA...');

      // Face-focused portrait - prioritize face quality for character diagram
      // Gemini will handle the diagram layout, we just need a clear face reference
      const prompt = `Portrait photograph of ${triggerWord}, head and shoulders, neutral expression, looking directly at camera, soft studio lighting, plain gray background.
Face in sharp focus, high detail. Symmetrical front-facing view. Natural skin texture.
Simple clothing visible at shoulders and neckline only. Photorealistic, professional headshot quality.`;

      const negativePrompt = `full body, legs, feet, wide shot, fashion pose, side view, turned away, looking away, over the shoulder, blurry face, distorted features, tilted head, excessive accessories`;

      const referenceResult = await this.falService.runFluxLoraGeneration({
        prompt,
        negative_prompt: negativePrompt,
        lora_url: weightsUrl,
        lora_scale: 0.75, // Balance identity preservation with pose control
        image_size: { width: 1024, height: 1024 }, // Square crop for face focus
        num_images: 1,
        guidance_scale: 7.5,
        num_inference_steps: 30,
      });

      const generatedPhotoUrl = referenceResult.images[0].url;
      this.logger.log(`Reference photo generated: ${generatedPhotoUrl}`);

      // Save reference image URL to diagram record
      await this.supabase.updateCharacterDiagram(diagramId, {
        source_image_url: generatedPhotoUrl,
      });

      // Step 2: Generate character diagram using Google Gemini (same as photo flow)
      this.logger.log('Step 2: Creating character diagram from reference photo...');

      const result = await this.geminiService.generateCharacterDiagram(generatedPhotoUrl);

      this.logger.log(`Character diagram generated for ${diagramId}`);

      // Convert base64 to buffer
      const imageBuffer = Buffer.from(result.imageBase64, 'base64');

      // Upload to Supabase storage
      const filePath = `${diagramId}/diagram.${result.mimeType.includes('png') ? 'png' : 'jpg'}`;
      const { url: fileUrl } = await this.supabase.uploadFile(
        'character-images',
        filePath,
        imageBuffer,
        result.mimeType,
      );

      // Update character diagram with result
      // Cost: ~$0.03 for LoRA generation + ~$0.02 for Gemini = ~$0.05 total
      const costCents = 5;
      await this.supabase.updateCharacterDiagram(diagramId, {
        status: 'ready',
        file_url: fileUrl,
        cost_cents: costCents,
      });

      // Mark job as completed
      await this.jobsService.markJobCompleted(
        jobId,
        {
          fileUrl,
          mimeType: result.mimeType,
          referencePhotoUrl: generatedPhotoUrl,
        },
        costCents,
      );

      this.logger.log(`Character diagram job ${jobId} (LoRA-based) completed successfully`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed LoRA-based character diagram job ${jobId}: ${errorMessage}`);

      if (diagramId) {
        await this.supabase.updateCharacterDiagram(diagramId, {
          status: 'failed',
          error_message: errorMessage,
        });
      }

      if (jobId) {
        await this.jobsService.markJobFailed(jobId, errorMessage);
      }
      throw error;
    }
  }
}
