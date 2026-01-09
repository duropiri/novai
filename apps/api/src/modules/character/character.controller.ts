import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { CharacterService, CreateCharacterDiagramDto } from './character.service';
import { DbCharacterDiagram } from '../files/supabase.service';

class CreateCharacterRequestDto {
  name?: string;
  sourceImageUrl!: string;
}

@Controller('characters')
export class CharacterController {
  constructor(private readonly characterService: CharacterService) {}

  @Post()
  async create(@Body() dto: CreateCharacterRequestDto): Promise<DbCharacterDiagram> {
    if (!dto.sourceImageUrl?.trim()) {
      throw new HttpException('Source image URL is required', HttpStatus.BAD_REQUEST);
    }

    const createDto: CreateCharacterDiagramDto = {
      name: dto.name?.trim(),
      sourceImageUrl: dto.sourceImageUrl.trim(),
    };

    try {
      return await this.characterService.create(createDto);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create character diagram';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get()
  async findAll(@Query('status') status?: string): Promise<DbCharacterDiagram[]> {
    const validStatuses = ['pending', 'processing', 'ready', 'failed'];
    if (status && !validStatuses.includes(status)) {
      throw new HttpException(
        `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.characterService.findAll(status);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<DbCharacterDiagram> {
    const diagram = await this.characterService.findOne(id);
    if (!diagram) {
      throw new HttpException('Character diagram not found', HttpStatus.NOT_FOUND);
    }
    return diagram;
  }

  @Delete(':id')
  async delete(@Param('id') id: string): Promise<{ success: boolean }> {
    try {
      await this.characterService.delete(id);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete character diagram';
      if (message === 'Character diagram not found') {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      if (message.includes('Cannot delete')) {
        throw new HttpException(message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
