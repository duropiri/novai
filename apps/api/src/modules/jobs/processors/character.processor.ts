import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queues.constants';
import { JobsService } from '../jobs.service';
import { GeminiService } from '../../../services/gemini.service';
import { SupabaseService } from '../../files/supabase.service';

interface CharacterJobData {
  jobId: string;
  diagramId: string;
  sourceImageUrl: string;
  name: string;
}

@Processor(QUEUES.CHARACTER_DIAGRAM)
export class CharacterProcessor extends WorkerHost {
  private readonly logger = new Logger(CharacterProcessor.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly geminiService: GeminiService,
    private readonly supabase: SupabaseService,
  ) {
    super();
  }

  async process(job: Job<CharacterJobData>): Promise<void> {
    const { jobId, diagramId, sourceImageUrl } = job.data;

    try {
      await this.jobsService.markJobProcessing(jobId);
      await this.supabase.updateCharacterDiagram(diagramId, { status: 'processing' });

      this.logger.log(`Processing character diagram job ${jobId}`, {
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

      // Update diagram status
      await this.supabase.updateCharacterDiagram(diagramId, {
        status: 'failed',
        error_message: errorMessage,
      });

      // Mark job as failed
      await this.jobsService.markJobFailed(jobId, errorMessage);
      throw error;
    }
  }
}
