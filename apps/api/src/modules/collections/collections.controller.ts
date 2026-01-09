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
import { CollectionsService, CreateCollectionDto, CollectionWithStats } from './collections.service';
import { DbCollection, DbVideo, DbAudioFile } from '../files/supabase.service';

class CreateCollectionRequestDto {
  name!: string;
  type!: 'video' | 'audio';
}

class UpdateCollectionRequestDto {
  name!: string;
}

@Controller('collections')
export class CollectionsController {
  constructor(private readonly collectionsService: CollectionsService) {}

  @Post()
  async create(@Body() dto: CreateCollectionRequestDto): Promise<DbCollection> {
    if (!dto.name?.trim()) {
      throw new HttpException('Name is required', HttpStatus.BAD_REQUEST);
    }
    if (!dto.type || !['video', 'audio'].includes(dto.type)) {
      throw new HttpException('Type must be "video" or "audio"', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.collectionsService.create({
        name: dto.name.trim(),
        type: dto.type,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create collection';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get()
  async findAll(@Query('type') type?: string): Promise<CollectionWithStats[]> {
    if (type && !['video', 'audio'].includes(type)) {
      throw new HttpException('Type must be "video" or "audio"', HttpStatus.BAD_REQUEST);
    }
    return this.collectionsService.findAll(type as 'video' | 'audio' | undefined);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<CollectionWithStats> {
    const collection = await this.collectionsService.findOne(id);
    if (!collection) {
      throw new HttpException('Collection not found', HttpStatus.NOT_FOUND);
    }
    return collection;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCollectionRequestDto,
  ): Promise<DbCollection> {
    if (!dto.name?.trim()) {
      throw new HttpException('Name is required', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.collectionsService.update(id, dto.name.trim());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update collection';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete(':id')
  async delete(@Param('id') id: string): Promise<{ success: boolean }> {
    try {
      await this.collectionsService.delete(id);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete collection';
      if (message === 'Collection not found') {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      if (message.includes('Cannot delete')) {
        throw new HttpException(message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':id/videos')
  async getVideos(@Param('id') id: string): Promise<DbVideo[]> {
    const collection = await this.collectionsService.findOne(id);
    if (!collection) {
      throw new HttpException('Collection not found', HttpStatus.NOT_FOUND);
    }
    if (collection.type !== 'video') {
      throw new HttpException('This is not a video collection', HttpStatus.BAD_REQUEST);
    }
    return this.collectionsService.getVideos(id);
  }

  @Get(':id/audio')
  async getAudioFiles(@Param('id') id: string): Promise<DbAudioFile[]> {
    const collection = await this.collectionsService.findOne(id);
    if (!collection) {
      throw new HttpException('Collection not found', HttpStatus.NOT_FOUND);
    }
    if (collection.type !== 'audio') {
      throw new HttpException('This is not an audio collection', HttpStatus.BAD_REQUEST);
    }
    return this.collectionsService.getAudioFiles(id);
  }
}
