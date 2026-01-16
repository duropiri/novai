import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SupabaseService } from '../files/supabase.service';
import { QUEUES } from '../jobs/queues.constants';

// Board type definitions
export type BoardType = 'emotion' | 'playful' | 'glamour' | 'casual' | 'angles';

export const BOARD_TYPES: BoardType[] = ['emotion', 'playful', 'glamour', 'casual', 'angles'];

// Expression definitions for each board type
export const BOARD_EXPRESSIONS: Record<BoardType, string[]> = {
  emotion: ['Happy', 'Sad', 'Angry', 'Surprised', 'Fearful', 'Disgusted', 'Neutral', 'Contempt'],
  playful: ['Winking', 'Smirking', 'Tongue Out', 'Blowing Kiss', 'Giggling', 'Teasing', 'Cheeky', 'Mischievous'],
  glamour: ['Sultry Gaze', 'Raised Eyebrow', 'Mysterious Smile', 'Side Glance', 'Pouting', 'Alluring', 'Intense', 'Dreamy'],
  casual: ['Laughing', 'Thinking', 'Curious', 'Excited', 'Bored', 'Sleepy', 'Confused', 'Hopeful'],
  angles: ['Front Neutral', 'Front Smile', '3/4 Left', '3/4 Right', 'Profile Left', 'Profile Right', 'Looking Up', 'Looking Down'],
};

// All expressions combined
export const ALL_EXPRESSIONS = Object.values(BOARD_EXPRESSIONS).flat();

// Subject profile for prompt generation
export interface SubjectProfile {
  hairColor: string;
  hairStyle: string;
  eyeColor: string;
  skinTone: string;
  faceShape: string;
  distinguishing: string;
  gender: string;
  ageDesc: string;
}

export interface ExpressionBoard {
  id: string;
  name: string | null;
  status: 'pending' | 'generating' | 'ready' | 'failed';
  source_type: 'image' | 'lora' | 'video' | 'zip' | 'character' | 'reference_kit';
  source_image_url: string | null;
  lora_id: string | null;
  character_diagram_id: string | null;
  reference_kit_id: string | null;
  grid_size: '2x4' | '2x8' | '4x8' | '5x8';
  board_types: BoardType[];
  expressions: string[];
  subject_profile: SubjectProfile | null;
  board_url: string | null;
  cell_urls: Record<string, string> | null;
  progress: number;
  error_message: string | null;
  cost_cents: number | null;
  created_at: string;
  completed_at: string | null;
}

export interface CreateExpressionBoardDto {
  name?: string;
  sourceType: 'image' | 'lora' | 'video' | 'zip' | 'character' | 'reference_kit';
  sourceImageUrl?: string;
  loraId?: string;
  characterDiagramId?: string;
  referenceKitId?: string;
  boardTypes?: BoardType[];
}

@Injectable()
export class ExpressionBoardService {
  private readonly logger = new Logger(ExpressionBoardService.name);

  constructor(
    private supabaseService: SupabaseService,
    @InjectQueue(QUEUES.EXPRESSION_BOARD) private expressionBoardQueue: Queue,
  ) {}

  async create(dto: CreateExpressionBoardDto): Promise<{ id: string; status: string; estimatedCost: number; totalExpressions: number }> {
    // Validate identity source
    this.validateIdentitySource(dto);

    // Default to all board types if none specified
    const boardTypes = dto.boardTypes?.length ? dto.boardTypes : BOARD_TYPES;

    // Collect all expressions for selected board types
    const expressions: string[] = [];
    for (const boardType of boardTypes) {
      expressions.push(...BOARD_EXPRESSIONS[boardType]);
    }

    // Determine grid size based on number of expressions
    let gridSize: '2x4' | '2x8' | '4x8' | '5x8';
    if (expressions.length <= 8) {
      gridSize = '2x4';
    } else if (expressions.length <= 16) {
      gridSize = '2x8';
    } else if (expressions.length <= 32) {
      gridSize = '4x8';
    } else {
      gridSize = '5x8';
    }

    // Estimate cost: ~$0.02 per generation
    const estimatedCost = expressions.length * 2; // in cents

    // Create record in database
    const { data, error } = await this.supabaseService.getClient()
      .from('expression_boards')
      .insert({
        name: dto.name || null,
        status: 'pending',
        source_type: dto.sourceType,
        source_image_url: dto.sourceImageUrl || null,
        lora_id: dto.loraId || null,
        character_diagram_id: dto.characterDiagramId || null,
        reference_kit_id: dto.referenceKitId || null,
        grid_size: gridSize,
        board_types: boardTypes,
        expressions,
        progress: 0,
      })
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to create expression board', error);
      throw new BadRequestException('Failed to create expression board');
    }

    // Queue job for processing
    await this.expressionBoardQueue.add('generate', {
      expressionBoardId: data.id,
    });

    this.logger.log(`Created expression board ${data.id} with ${expressions.length} expressions (${boardTypes.join(', ')})`);

    return {
      id: data.id,
      status: 'pending',
      estimatedCost,
      totalExpressions: expressions.length,
    };
  }

  async list(): Promise<ExpressionBoard[]> {
    const { data, error } = await this.supabaseService.getClient()
      .from('expression_boards')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to list expression boards', error);
      throw new BadRequestException('Failed to list expression boards');
    }

    return data || [];
  }

  async findOne(id: string): Promise<ExpressionBoard> {
    const { data, error } = await this.supabaseService.getClient()
      .from('expression_boards')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Expression board ${id} not found`);
    }

    return data;
  }

  async delete(id: string): Promise<void> {
    const board = await this.findOne(id);

    // If generating, cancel the job first
    if (board.status === 'generating') {
      await this.cancel(id);
    }

    const { error } = await this.supabaseService.getClient()
      .from('expression_boards')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error('Failed to delete expression board', error);
      throw new BadRequestException('Failed to delete expression board');
    }

    this.logger.log(`Deleted expression board ${id}`);
  }

  async cancel(id: string): Promise<void> {
    const board = await this.findOne(id);

    if (board.status !== 'generating' && board.status !== 'pending') {
      throw new BadRequestException('Can only cancel pending or generating boards');
    }

    // Remove job from queue if pending
    const jobs = await this.expressionBoardQueue.getJobs(['waiting', 'active', 'delayed']);
    for (const job of jobs) {
      if (job.data?.expressionBoardId === id) {
        await job.remove();
        this.logger.log(`Removed job ${job.id} for expression board ${id}`);
      }
    }

    // Update status to failed/cancelled
    await this.supabaseService.getClient()
      .from('expression_boards')
      .update({
        status: 'failed',
        error_message: 'Cancelled by user',
      })
      .eq('id', id);

    this.logger.log(`Cancelled expression board ${id}`);
  }

  async updateProgress(id: string, progress: number): Promise<void> {
    await this.supabaseService.getClient()
      .from('expression_boards')
      .update({ progress, status: 'generating' })
      .eq('id', id);
  }

  async updateSubjectProfile(id: string, profile: SubjectProfile): Promise<void> {
    await this.supabaseService.getClient()
      .from('expression_boards')
      .update({ subject_profile: profile })
      .eq('id', id);
  }

  async markCompleted(
    id: string,
    boardUrl: string,
    cellUrls: Record<string, string>,
    costCents: number,
  ): Promise<void> {
    await this.supabaseService.getClient()
      .from('expression_boards')
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
      .from('expression_boards')
      .update({
        status: 'failed',
        error_message: errorMessage,
      })
      .eq('id', id);
  }

  private validateIdentitySource(dto: CreateExpressionBoardDto): void {
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
