import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SupabaseService } from '../files/supabase.service';
import { QUEUES } from '../jobs/queues.constants';

// Standard 8 emotions for 2x4 grid
export const STANDARD_EMOTIONS = [
  'Happy', 'Sad',
  'Angry', 'Surprised',
  'Disgusted', 'Fearful',
  'Neutral', 'Contempt',
];

// Extended 16 emotions for 2x8 grid
export const EXTENDED_EMOTIONS = [
  ...STANDARD_EMOTIONS,
  'Excited', 'Confused',
  'Proud', 'Embarrassed',
  'Hopeful', 'Bored',
  'Amused', 'Thoughtful',
];

export interface EmotionBoard {
  id: string;
  name: string | null;
  status: 'pending' | 'generating' | 'ready' | 'failed';
  source_type: 'image' | 'lora' | 'video' | 'zip' | 'character' | 'reference_kit';
  source_image_url: string | null;
  lora_id: string | null;
  character_diagram_id: string | null;
  reference_kit_id: string | null;
  grid_size: '2x4' | '2x8';
  emotions: string[];
  board_url: string | null;
  cell_urls: Record<string, string> | null;
  progress: number;
  error_message: string | null;
  cost_cents: number | null;
  created_at: string;
  completed_at: string | null;
}

export interface CreateEmotionBoardDto {
  name?: string;
  sourceType: 'image' | 'lora' | 'video' | 'zip' | 'character' | 'reference_kit';
  sourceImageUrl?: string;
  loraId?: string;
  characterDiagramId?: string;
  referenceKitId?: string;
  gridSize?: '2x4' | '2x8';
  emotions?: string[];
}

@Injectable()
export class EmotionBoardService {
  private readonly logger = new Logger(EmotionBoardService.name);

  constructor(
    private supabaseService: SupabaseService,
    @InjectQueue(QUEUES.EMOTION_BOARD) private emotionBoardQueue: Queue,
  ) {}

  async create(dto: CreateEmotionBoardDto): Promise<{ id: string; status: string; estimatedCost: number }> {
    // Validate identity source
    this.validateIdentitySource(dto);

    const gridSize = dto.gridSize || '2x4';
    const defaultEmotions = gridSize === '2x4' ? STANDARD_EMOTIONS : EXTENDED_EMOTIONS;
    const emotions = dto.emotions?.length ? dto.emotions : defaultEmotions;

    // Estimate cost: ~$0.03 per cell (generation + face swap)
    const estimatedCost = emotions.length * 3; // in cents

    // Create record in database
    const { data, error } = await this.supabaseService.getClient()
      .from('emotion_boards')
      .insert({
        name: dto.name || null,
        status: 'pending',
        source_type: dto.sourceType,
        source_image_url: dto.sourceImageUrl || null,
        lora_id: dto.loraId || null,
        character_diagram_id: dto.characterDiagramId || null,
        reference_kit_id: dto.referenceKitId || null,
        grid_size: gridSize,
        emotions,
        progress: 0,
      })
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to create emotion board', error);
      throw new BadRequestException('Failed to create emotion board');
    }

    // Queue job for processing
    await this.emotionBoardQueue.add('generate', {
      emotionBoardId: data.id,
    });

    this.logger.log(`Created emotion board ${data.id} with ${emotions.length} emotions`);

    return {
      id: data.id,
      status: 'pending',
      estimatedCost,
    };
  }

  async list(): Promise<EmotionBoard[]> {
    const { data, error } = await this.supabaseService.getClient()
      .from('emotion_boards')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to list emotion boards', error);
      throw new BadRequestException('Failed to list emotion boards');
    }

    return data || [];
  }

  async findOne(id: string): Promise<EmotionBoard> {
    const { data, error } = await this.supabaseService.getClient()
      .from('emotion_boards')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Emotion board ${id} not found`);
    }

    return data;
  }

  async delete(id: string): Promise<void> {
    const board = await this.findOne(id);

    // Don't allow deleting while generating
    if (board.status === 'generating') {
      throw new BadRequestException('Cannot delete emotion board while generating');
    }

    const { error } = await this.supabaseService.getClient()
      .from('emotion_boards')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error('Failed to delete emotion board', error);
      throw new BadRequestException('Failed to delete emotion board');
    }

    this.logger.log(`Deleted emotion board ${id}`);
  }

  async updateProgress(id: string, progress: number): Promise<void> {
    await this.supabaseService.getClient()
      .from('emotion_boards')
      .update({ progress, status: 'generating' })
      .eq('id', id);
  }

  async markCompleted(
    id: string,
    boardUrl: string,
    cellUrls: Record<string, string>,
    costCents: number,
  ): Promise<void> {
    await this.supabaseService.getClient()
      .from('emotion_boards')
      .update({
        status: 'ready',
        progress: 100,
        board_url: boardUrl,
        cell_urls: cellUrls,
        cost_cents: costCents,
        completed_at: new Date().toISOString(),
      })
      .eq('id', id);
  }

  async markFailed(id: string, errorMessage: string): Promise<void> {
    await this.supabaseService.getClient()
      .from('emotion_boards')
      .update({
        status: 'failed',
        error_message: errorMessage,
      })
      .eq('id', id);
  }

  private validateIdentitySource(dto: CreateEmotionBoardDto): void {
    const sources = [
      dto.sourceImageUrl,
      dto.loraId,
      dto.characterDiagramId,
      dto.referenceKitId,
    ].filter(Boolean);

    if (sources.length === 0) {
      throw new BadRequestException('At least one identity source must be provided');
    }

    // For image/video/zip source types, sourceImageUrl is required
    if (['image', 'video', 'zip'].includes(dto.sourceType) && !dto.sourceImageUrl) {
      throw new BadRequestException(`sourceImageUrl is required for source type '${dto.sourceType}'`);
    }

    // For lora source type, loraId is required
    if (dto.sourceType === 'lora' && !dto.loraId) {
      throw new BadRequestException('loraId is required for source type \'lora\'');
    }

    // For character source type, characterDiagramId is required
    if (dto.sourceType === 'character' && !dto.characterDiagramId) {
      throw new BadRequestException('characterDiagramId is required for source type \'character\'');
    }

    // For reference_kit source type, referenceKitId is required
    if (dto.sourceType === 'reference_kit' && !dto.referenceKitId) {
      throw new BadRequestException('referenceKitId is required for source type \'reference_kit\'');
    }
  }
}
