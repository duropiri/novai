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
  ExpressionBoardService,
  CreateExpressionBoardDto,
  ExpressionBoard,
  BOARD_TYPES,
  BOARD_EXPRESSIONS,
  BoardType,
} from './expression-board.service';

@Controller('expression-board')
export class ExpressionBoardController {
  constructor(private readonly expressionBoardService: ExpressionBoardService) {}

  @Post()
  async create(
    @Body() dto: CreateExpressionBoardDto,
  ): Promise<{ id: string; status: string; estimatedCost: number; totalExpressions: number }> {
    return this.expressionBoardService.create(dto);
  }

  @Get()
  async list(): Promise<ExpressionBoard[]> {
    return this.expressionBoardService.list();
  }

  @Get('board-types')
  getBoardTypes(): { types: BoardType[]; expressions: Record<BoardType, string[]> } {
    return {
      types: BOARD_TYPES,
      expressions: BOARD_EXPRESSIONS,
    };
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<ExpressionBoard> {
    return this.expressionBoardService.findOne(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string): Promise<void> {
    return this.expressionBoardService.delete(id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancel(@Param('id') id: string): Promise<void> {
    return this.expressionBoardService.cancel(id);
  }
}
