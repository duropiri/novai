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
import { VideosService, CreateVideoDto } from './videos.service';
import { DbVideo } from '../files/supabase.service';

class CreateVideoRequestDto {
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
  @IsUrl()
  thumbnailUrl?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  durationSeconds?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  width?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  height?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  fileSizeBytes?: number;
}

class UpdateVideoRequestDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  collectionId?: string;
}

@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  async create(@Body() dto: CreateVideoRequestDto): Promise<DbVideo> {
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
      return await this.videosService.create({
        name: dto.name.trim(),
        collectionId: dto.collectionId.trim(),
        fileUrl: dto.fileUrl.trim(),
        thumbnailUrl: dto.thumbnailUrl?.trim(),
        durationSeconds: dto.durationSeconds,
        width: dto.width,
        height: dto.height,
        fileSizeBytes: dto.fileSizeBytes,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create video';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get()
  async findAll(
    @Query('type') type?: string,
    @Query('collectionId') collectionId?: string,
  ): Promise<DbVideo[]> {
    if (type && !['source', 'face_swapped', 'variant'].includes(type)) {
      throw new HttpException(
        'Type must be "source", "face_swapped", or "variant"',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.videosService.findAll({ type, collectionId });
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<DbVideo> {
    const video = await this.videosService.findOne(id);
    if (!video) {
      throw new HttpException('Video not found', HttpStatus.NOT_FOUND);
    }
    return video;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateVideoRequestDto,
  ): Promise<DbVideo> {
    const updates: Partial<Pick<DbVideo, 'name' | 'collection_id'>> = {};

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
      return await this.videosService.update(id, updates);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update video';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete(':id')
  async delete(@Param('id') id: string): Promise<{ success: boolean }> {
    try {
      await this.videosService.delete(id);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete video';
      if (message === 'Video not found') {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
