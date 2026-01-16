import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queues.constants';
import { GeminiService } from '../../../services/gemini.service';
import { FalService } from '../../../services/fal.service';
import { FFmpegService } from '../../../services/ffmpeg.service';
import { SupabaseService } from '../../files/supabase.service';
import {
  EmotionBoardService,
  STANDARD_EMOTIONS,
  EXTENDED_EMOTIONS,
} from '../../emotion-board/emotion-board.service';

interface EmotionBoardJobData {
  emotionBoardId: string;
}

@Processor(QUEUES.EMOTION_BOARD)
export class EmotionBoardProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(EmotionBoardProcessor.name);

  constructor(
    private readonly geminiService: GeminiService,
    private readonly falService: FalService,
    private readonly ffmpegService: FFmpegService,
    private readonly supabase: SupabaseService,
    private readonly emotionBoardService: EmotionBoardService,
  ) {
    super();
  }

  onModuleInit() {
    this.logger.log('=== EmotionBoardProcessor initialized ===');
    this.logger.log(`Queue name: ${QUEUES.EMOTION_BOARD}`);
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

  async process(job: Job<EmotionBoardJobData>): Promise<void> {
    const { emotionBoardId } = job.data;

    this.logger.log(`=== EMOTION BOARD JOB STARTED ===`);
    this.logger.log(`Emotion Board ID: ${emotionBoardId}`);

    try {
      // Get the emotion board record
      const board = await this.emotionBoardService.findOne(emotionBoardId);

      this.logger.log(`Processing emotion board: ${board.name || emotionBoardId}`);
      this.logger.log(`Source type: ${board.source_type}`);
      this.logger.log(`Grid size: ${board.grid_size}`);
      this.logger.log(`Emotions: ${board.emotions.length}`);

      // Get the face reference URL based on source type
      const faceReferenceUrl = await this.resolveFaceReference(board);
      this.logger.log(`Face reference URL: ${faceReferenceUrl}`);

      // Update status to generating
      await this.emotionBoardService.updateProgress(emotionBoardId, 5);

      const emotions = board.emotions;
      const cellUrls: Record<string, string> = {};
      const cellData: Array<{ url: string; label: string }> = [];
      let totalCost = 0;

      // Generate each emotion cell
      for (let i = 0; i < emotions.length; i++) {
        const emotion = emotions[i];
        const progress = Math.round(5 + (i / emotions.length) * 85);
        await this.emotionBoardService.updateProgress(emotionBoardId, progress);

        this.logger.log(`Generating cell ${i + 1}/${emotions.length}: ${emotion}`);

        try {
          // Generate base image with emotion using Nano Banana Pro
          const prompt = this.buildEmotionPrompt(emotion);
          const baseResult = await this.geminiService.runNanoBananaGeneration({
            prompt,
            num_images: 1,
            aspect_ratio: '1:1',
          });

          if (!baseResult.images || baseResult.images.length === 0) {
            throw new Error(`Failed to generate base image for ${emotion}`);
          }

          const baseImageUrl = baseResult.images[0].url;
          totalCost += 2; // ~$0.02 per generation

          // Face swap the identity onto the base image
          let finalCellUrl = baseImageUrl;
          try {
            const swapResult = await this.falService.runFaceSwap({
              base_image_url: baseImageUrl,
              swap_image_url: faceReferenceUrl,
            });

            if (swapResult.image?.url) {
              finalCellUrl = swapResult.image.url;
              totalCost += 1; // ~$0.01 per face swap
            }
          } catch (swapError) {
            this.logger.warn(`Face swap failed for ${emotion}, using base image: ${swapError}`);
          }

          // Upload to permanent storage
          const cellBuffer = await this.downloadBuffer(finalCellUrl);
          const cellPath = `${emotionBoardId}/cell_${emotion.toLowerCase()}_${Date.now()}.jpg`;
          const { url: uploadedCellUrl } = await this.supabase.uploadFile(
            'emotion-boards',
            cellPath,
            cellBuffer,
            'image/jpeg',
          );

          cellUrls[emotion] = uploadedCellUrl;
          cellData.push({ url: uploadedCellUrl, label: emotion });

          this.logger.log(`Cell ${emotion} generated: ${uploadedCellUrl}`);
        } catch (cellError) {
          this.logger.error(`Failed to generate cell for ${emotion}: ${cellError}`);
          // Continue with other cells
        }
      }

      // Check if we have enough cells
      if (cellData.length === 0) {
        throw new Error('No emotion cells were generated successfully');
      }

      // Assemble the grid
      await this.emotionBoardService.updateProgress(emotionBoardId, 92);
      this.logger.log('Assembling emotion grid...');

      const gridUrl = await this.ffmpegService.assembleEmotionGrid(
        cellData,
        2, // 2 columns
        emotionBoardId,
      );

      // Mark as completed
      await this.emotionBoardService.markCompleted(
        emotionBoardId,
        gridUrl,
        cellUrls,
        totalCost,
      );

      this.logger.log(`=== EMOTION BOARD COMPLETED ===`);
      this.logger.log(`Board URL: ${gridUrl}`);
      this.logger.log(`Cells generated: ${cellData.length}/${emotions.length}`);
      this.logger.log(`Total cost: $${(totalCost / 100).toFixed(2)}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Emotion board generation failed: ${errorMessage}`);
      await this.emotionBoardService.markFailed(emotionBoardId, errorMessage);
      throw error;
    }
  }

  /**
   * Resolve the face reference URL based on source type
   */
  private async resolveFaceReference(board: {
    source_type: string;
    source_image_url: string | null;
    lora_id: string | null;
    character_diagram_id: string | null;
    reference_kit_id: string | null;
  }): Promise<string> {
    switch (board.source_type) {
      case 'image':
      case 'video':
      case 'zip':
        if (!board.source_image_url) {
          throw new Error('Source image URL is required for this source type');
        }
        return board.source_image_url;

      case 'lora':
        if (!board.lora_id) {
          throw new Error('LoRA ID is required for lora source type');
        }
        // Get LoRA's training image or generate a reference face
        const { data: lora } = await this.supabase.getClient()
          .from('lora_models')
          .select('training_images_url, trigger_word')
          .eq('id', board.lora_id)
          .single();

        if (!lora) {
          throw new Error('LoRA model not found');
        }

        // Generate a reference face from the LoRA
        const facePrompt = `${lora.trigger_word || 'person'} portrait photo, face closeup, looking at camera, neutral expression, plain background, high quality`;
        const faceResult = await this.geminiService.runNanoBananaGeneration({
          prompt: facePrompt,
          num_images: 1,
          aspect_ratio: '1:1',
        });

        if (!faceResult.images?.[0]?.url) {
          throw new Error('Failed to generate reference face from LoRA');
        }
        return faceResult.images[0].url;

      case 'character':
        if (!board.character_diagram_id) {
          throw new Error('Character diagram ID is required for character source type');
        }
        const { data: diagram } = await this.supabase.getClient()
          .from('character_diagrams')
          .select('source_image_url')
          .eq('id', board.character_diagram_id)
          .single();

        if (!diagram?.source_image_url) {
          throw new Error('Character diagram source image not found');
        }
        return diagram.source_image_url;

      case 'reference_kit':
        if (!board.reference_kit_id) {
          throw new Error('Reference kit ID is required for reference_kit source type');
        }
        const kit = await this.supabase.getReferenceKit(board.reference_kit_id);
        if (!kit?.anchor_face_url) {
          throw new Error('Reference kit anchor face not found');
        }
        return kit.anchor_face_url;

      default:
        throw new Error(`Unknown source type: ${board.source_type}`);
    }
  }

  /**
   * Build a prompt for generating a specific emotion expression
   */
  private buildEmotionPrompt(emotion: string): string {
    const emotionDescriptions: Record<string, string> = {
      Happy: 'smiling broadly, happy and joyful expression, bright eyes',
      Sad: 'frowning, tearful, melancholic expression, downcast eyes',
      Angry: 'furious expression, furrowed brow, intense glare, clenched jaw',
      Surprised: 'wide eyes, raised eyebrows, open mouth, shocked expression',
      Disgusted: 'wrinkled nose, upper lip raised, repulsed expression',
      Fearful: 'wide fearful eyes, raised eyebrows, tense expression, scared',
      Neutral: 'calm neutral expression, relaxed face, composed look',
      Contempt: 'one corner of lip raised, dismissive smirk, superior expression',
      Excited: 'very enthusiastic, beaming smile, sparkling eyes, energetic expression',
      Confused: 'puzzled expression, tilted head, furrowed brow, questioning look',
      Proud: 'confident smile, chin slightly raised, self-assured expression',
      Embarrassed: 'blushing cheeks, awkward smile, shy expression, averted gaze',
      Hopeful: 'optimistic expression, soft smile, bright hopeful eyes',
      Bored: 'uninterested expression, half-closed eyes, slack jaw',
      Amused: 'light laugh, genuine smile, playful expression, crinkled eyes',
      Thoughtful: 'contemplative expression, slightly narrowed eyes, pensive look',
    };

    const description = emotionDescriptions[emotion] || `${emotion.toLowerCase()} expression`;

    return `Portrait photo of a person showing ${emotion.toLowerCase()} emotion. ${description}. Studio lighting, clean neutral background, high quality portrait photography, face centered in frame, looking at camera. Photorealistic, 8k quality.`;
  }

  /**
   * Download file to buffer
   */
  private async downloadBuffer(url: string): Promise<Buffer> {
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
