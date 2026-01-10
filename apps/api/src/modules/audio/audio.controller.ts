import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { IsString, IsNotEmpty, IsOptional, IsNumber, IsUrl } from 'class-validator';
import { Type } from 'class-transformer';
import { AudioService, CreateAudioFileDto } from './audio.service';
import { DbAudioFile } from '../files/supabase.service';

class CreateAudioRequestDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  collectionId!: string;

  @IsUrl()
  @IsNotEmpty()
  fileUrl!: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  durationSeconds?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  fileSizeBytes?: number;
}

class UpdateAudioRequestDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  collectionId?: string;
}

@Controller('audio')
export class AudioController {
  constructor(private readonly audioService: AudioService) {}

  @Post()
  async create(@Body() dto: CreateAudioRequestDto): Promise<DbAudioFile> {
    if (!dto.name?.trim()) {
      throw new HttpException('Name is required', HttpStatus.BAD_REQUEST);
    }
    if (!dto.collectionId?.trim()) {
      throw new HttpException('Collection ID is required', HttpStatus.BAD_REQUEST);
    }
    if (!dto.fileUrl?.trim()) {
      throw new HttpException('File URL is required', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.audioService.create({
        name: dto.name.trim(),
        collectionId: dto.collectionId.trim(),
        fileUrl: dto.fileUrl.trim(),
        durationSeconds: dto.durationSeconds,
        fileSizeBytes: dto.fileSizeBytes,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create audio file';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get()
  async findAll(@Query('collectionId') collectionId?: string): Promise<DbAudioFile[]> {
    return this.audioService.findAll(collectionId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<DbAudioFile> {
    const audio = await this.audioService.findOne(id);
    if (!audio) {
      throw new HttpException('Audio file not found', HttpStatus.NOT_FOUND);
    }
    return audio;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAudioRequestDto,
  ): Promise<DbAudioFile> {
    const updates: Partial<Pick<DbAudioFile, 'name' | 'collection_id'>> = {};

    if (dto.name !== undefined) {
      if (!dto.name.trim()) {
        throw new HttpException('Name cannot be empty', HttpStatus.BAD_REQUEST);
      }
      updates.name = dto.name.trim();
    }

    if (dto.collectionId !== undefined) {
      updates.collection_id = dto.collectionId || null;
    }

    if (Object.keys(updates).length === 0) {
      throw new HttpException('No updates provided', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.audioService.update(id, updates);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update audio file';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete(':id')
  async delete(@Param('id') id: string): Promise<{ success: boolean }> {
    try {
      await this.audioService.delete(id);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete audio file';
      if (message === 'Audio file not found') {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
