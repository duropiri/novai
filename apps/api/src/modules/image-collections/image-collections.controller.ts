import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ImageCollectionsService, ImageCollection, ImageItem, DbImageCollectionItem } from './image-collections.service';

class CreateCollectionDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}

class AddImageDto {
  @IsString()
  @IsNotEmpty()
  imageUrl!: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  sourceType?: string;

  @IsString()
  @IsOptional()
  sourceId?: string;
}

@Controller('image-collections')
export class ImageCollectionsController {
  private readonly logger = new Logger(ImageCollectionsController.name);

  constructor(private readonly imageCollectionsService: ImageCollectionsService) {}

  /**
   * List all image collections (smart + custom)
   */
  @Get()
  async listCollections(): Promise<ImageCollection[]> {
    return this.imageCollectionsService.listCollections();
  }

  /**
   * Get all images across all collections
   */
  @Get('all-images')
  async getAllImages(): Promise<ImageItem[]> {
    return this.imageCollectionsService.getAllImages();
  }

  /**
   * Get images in a specific collection
   */
  @Get(':id/images')
  async getCollectionImages(@Param('id') id: string): Promise<ImageItem[]> {
    return this.imageCollectionsService.getCollectionImages(id);
  }

  /**
   * Create a custom collection
   */
  @Post()
  async createCollection(@Body() dto: CreateCollectionDto) {
    if (!dto.name?.trim()) {
      throw new HttpException('Name is required', HttpStatus.BAD_REQUEST);
    }

    try {
      const collection = await this.imageCollectionsService.createCollection(dto.name.trim());
      return {
        id: collection.id,
        name: collection.name,
        type: 'custom',
        count: 0,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create collection';
      this.logger.error(`Failed to create collection: ${message}`);
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Delete a custom collection
   */
  @Delete(':id')
  async deleteCollection(@Param('id') id: string): Promise<{ success: boolean }> {
    try {
      await this.imageCollectionsService.deleteCollection(id);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete collection';
      if (message.includes('Cannot delete smart')) {
        throw new HttpException(message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Add an image to a custom collection
   */
  @Post(':id/images')
  async addToCollection(
    @Param('id') id: string,
    @Body() dto: AddImageDto,
  ): Promise<DbImageCollectionItem> {
    if (!dto.imageUrl?.trim()) {
      throw new HttpException('Image URL is required', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.imageCollectionsService.addToCollection(id, {
        imageUrl: dto.imageUrl.trim(),
        name: dto.name?.trim(),
        sourceType: dto.sourceType,
        sourceId: dto.sourceId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add image';
      if (message.includes('Cannot add items to smart')) {
        throw new HttpException(message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Remove an image from a custom collection
   */
  @Delete(':collectionId/images/:itemId')
  async removeFromCollection(
    @Param('itemId') itemId: string,
  ): Promise<{ success: boolean }> {
    try {
      await this.imageCollectionsService.removeFromCollection(itemId);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove image';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
