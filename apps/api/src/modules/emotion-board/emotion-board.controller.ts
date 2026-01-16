import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  EmotionBoardService,
  CreateEmotionBoardDto,
  EmotionBoard,
  STANDARD_EMOTIONS,
  EXTENDED_EMOTIONS,
} from './emotion-board.service';

@Controller('emotion-board')
export class EmotionBoardController {
  constructor(private readonly emotionBoardService: EmotionBoardService) {}

  @Post()
  async create(
    @Body() dto: CreateEmotionBoardDto,
  ): Promise<{ id: string; status: string; estimatedCost: number }> {
    return this.emotionBoardService.create(dto);
  }

  @Get()
  async list(): Promise<EmotionBoard[]> {
    return this.emotionBoardService.list();
  }

  @Get('emotions')
  getEmotions(): { standard: string[]; extended: string[] } {
    return {
      standard: STANDARD_EMOTIONS,
      extended: EXTENDED_EMOTIONS,
    };
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<EmotionBoard> {
    return this.emotionBoardService.findOne(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string): Promise<void> {
    return this.emotionBoardService.delete(id);
  }
}
