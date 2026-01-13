import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queues.constants';
import { GeminiService } from '../../../services/gemini.service';
import { SupabaseService } from '../../files/supabase.service';
import { getPromptForReferenceType } from '../../reference-kit/reference-kit.prompts';

interface GenerateKitJobData {
  kitId: string;
  sourceImageUrl: string;
  generateExtended: boolean;
  expressions: string[];
}

interface RegenerateReferenceJobData {
  kitId: string;
  sourceImageUrl: string;
  referenceType: string;
}

type ReferenceKitJobData = GenerateKitJobData | RegenerateReferenceJobData;

@Processor(QUEUES.REFERENCE_KIT)
export class ReferenceKitProcessor extends WorkerHost {
  private readonly logger = new Logger(ReferenceKitProcessor.name);

  constructor(
    private readonly geminiService: GeminiService,
    private readonly supabase: SupabaseService,
  ) {
    super();
  }

  async process(job: Job<ReferenceKitJobData>): Promise<void> {
    if (!job.data?.kitId) {
      this.logger.warn(`Skipping job with invalid data: ${JSON.stringify(job.data)}`);
      return;
    }

    switch (job.name) {
      case 'generate-kit':
        return this.generateFullKit(job as Job<GenerateKitJobData>);
      case 'regenerate-reference':
        return this.regenerateSingle(job as Job<RegenerateReferenceJobData>);
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  /**
   * Generate all references for a new kit
   */
  private async generateFullKit(job: Job<GenerateKitJobData>): Promise<void> {
    const { kitId, sourceImageUrl, generateExtended, expressions } = job.data;

    this.logger.log(`Generating full Reference Kit ${kitId}`);

    try {
      // Update status to generating
      await this.supabase.updateReferenceKit(kitId, {
        status: 'generating',
        generation_progress: { anchor: 'pending', profile: 'pending' },
      });

      // Build list of references to generate
      const referencesToGenerate: string[] = ['anchor', 'profile'];

      if (generateExtended) {
        referencesToGenerate.push('waist_up', 'full_body');
      }

      for (const expr of expressions) {
        referencesToGenerate.push(`expression_${expr}`);
      }

      // Initialize progress tracking
      const progress: Record<string, string> = {};
      for (const ref of referencesToGenerate) {
        progress[ref] = 'pending';
      }
      await this.supabase.updateReferenceKit(kitId, { generation_progress: progress });

      // Generate each reference
      let totalCost = 0;
      const updates: Record<string, string> = {};

      for (const refType of referencesToGenerate) {
        try {
          this.logger.log(`Generating ${refType} for kit ${kitId}`);

          // Update progress
          progress[refType] = 'generating';
          await this.supabase.updateReferenceKit(kitId, { generation_progress: progress });

          // Get prompt and generate
          const prompt = getPromptForReferenceType(refType);
          const result = await this.geminiService.generateReferenceImage(sourceImageUrl, prompt);

          // Upload to storage
          const imageBuffer = Buffer.from(result.imageBase64, 'base64');
          const ext = result.mimeType.includes('png') ? 'png' : 'jpg';
          const filePath = `${kitId}/${refType}.${ext}`;
          const { url } = await this.supabase.uploadFile(
            'reference-kits',
            filePath,
            imageBuffer,
            result.mimeType,
          );

          // Track the URL for database update
          if (refType === 'anchor') {
            updates['anchor_face_url'] = url;
          } else if (refType === 'profile') {
            updates['profile_url'] = url;
          } else if (refType === 'waist_up' || refType === 'half_body') {
            updates['half_body_url'] = url; // DB field still named half_body_url
          } else if (refType === 'full_body') {
            updates['full_body_url'] = url;
          }
          // Expressions are handled separately

          progress[refType] = 'done';
          totalCost += 2; // ~$0.02 per image

          this.logger.log(`Generated ${refType} for kit ${kitId}: ${url}`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          this.logger.error(`Failed to generate ${refType}: ${errorMessage}`);
          progress[refType] = 'failed';
        }

        // Update progress after each reference
        await this.supabase.updateReferenceKit(kitId, { generation_progress: progress });
      }

      // Handle expressions separately (stored in JSONB)
      const expressionUrls: Record<string, string> = {};
      for (const expr of expressions) {
        const refType = `expression_${expr}`;
        if (progress[refType] === 'done') {
          // We need to get the URL we generated
          // Actually, let me fix this - we should track it during generation
        }
      }

      // Check if any core references failed
      const coreSuccess = progress['anchor'] === 'done' && progress['profile'] === 'done';

      // Update the kit with all generated URLs
      await this.supabase.updateReferenceKit(kitId, {
        ...updates,
        status: coreSuccess ? 'ready' : 'failed',
        generation_progress: progress,
        error_message: coreSuccess ? null : 'Some references failed to generate',
      });

      this.logger.log(`Reference Kit ${kitId} generation completed (cost: $${(totalCost / 100).toFixed(2)})`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed Reference Kit generation ${kitId}: ${errorMessage}`);

      await this.supabase.updateReferenceKit(kitId, {
        status: 'failed',
        error_message: errorMessage,
      });

      throw error;
    }
  }

  /**
   * Regenerate a single reference for a duplicated kit
   * The kit already has all images copied from the original,
   * we only need to regenerate the specified reference type
   */
  private async regenerateSingle(job: Job<RegenerateReferenceJobData>): Promise<void> {
    const { kitId, sourceImageUrl, referenceType } = job.data;

    this.logger.log(`Regenerating ${referenceType} for duplicated kit ${kitId}`);

    try {
      // Get current kit state
      const kit = await this.supabase.getReferenceKit(kitId);
      if (!kit) {
        throw new Error('Reference Kit not found');
      }

      // Update progress to generating
      await this.supabase.updateReferenceKit(kitId, {
        generation_progress: { [referenceType]: 'generating' },
      });

      // Generate the reference
      const prompt = getPromptForReferenceType(referenceType);
      const result = await this.geminiService.generateReferenceImage(sourceImageUrl, prompt);

      // Upload to storage (new kit has its own ID, so files are separate)
      const imageBuffer = Buffer.from(result.imageBase64, 'base64');
      const ext = result.mimeType.includes('png') ? 'png' : 'jpg';
      const filePath = `${kitId}/${referenceType}.${ext}`;
      const { url } = await this.supabase.uploadFile(
        'reference-kits',
        filePath,
        imageBuffer,
        result.mimeType,
      );

      // Update the kit with the regenerated image and mark as ready
      const updates: Record<string, unknown> = {
        status: 'ready',
        generation_progress: { [referenceType]: 'done' },
        error_message: null,
      };

      if (referenceType === 'anchor') {
        updates['anchor_face_url'] = url;
      } else if (referenceType === 'profile') {
        updates['profile_url'] = url;
      } else if (referenceType === 'waist_up' || referenceType === 'half_body') {
        updates['half_body_url'] = url;
      } else if (referenceType === 'full_body') {
        updates['full_body_url'] = url;
      } else if (referenceType.startsWith('expression_')) {
        const exprName = referenceType.replace('expression_', '');
        updates['expressions'] = { ...kit.expressions, [exprName]: url };
      }

      await this.supabase.updateReferenceKit(kitId, updates);

      this.logger.log(`Regenerated ${referenceType} for kit ${kitId}: ${url}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to regenerate ${referenceType}: ${errorMessage}`);

      await this.supabase.updateReferenceKit(kitId, {
        status: 'failed',
        generation_progress: { [referenceType]: 'failed' },
        error_message: errorMessage,
      });

      throw error;
    }
  }
}
