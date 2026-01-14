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
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsString, IsOptional, IsNotEmpty, IsArray, IsInt, IsObject, Min, IsIn } from 'class-validator';
import {
  CharacterService,
  CreateCharacterDiagramDto,
  CharacterDiagramImage,
  CharacterDiagramWithImages,
} from './character.service';
import { DbCharacterDiagram } from '../files/supabase.service';
import { FilesService } from '../files/files.service';

class CreateCharacterRequestDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  sourceImageUrl?: string; // Single image (backward compatible)

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[]; // Multiple images (new)

  @IsOptional()
  @IsInt()
  @Min(0)
  primaryImageIndex?: number;

  @IsOptional()
  @IsObject()
  imageTypes?: Record<number, string>;

  @IsOptional()
  @IsIn(['original', 'minimal'])
  clothingOption?: 'original' | 'minimal';
}

class UpdateCharacterRequestDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}

@Controller('characters')
export class CharacterController {
  constructor(
    private readonly characterService: CharacterService,
    private readonly filesService: FilesService,
  ) {}

  @Post()
  async create(@Body() dto: CreateCharacterRequestDto): Promise<DbCharacterDiagram> {
    // Support both single image and multiple images
    const hasImages = dto.imageUrls?.length || dto.sourceImageUrl?.trim();
    if (!hasImages) {
      throw new HttpException('At least one image URL is required', HttpStatus.BAD_REQUEST);
    }

    const createDto: CreateCharacterDiagramDto = {
      name: dto.name?.trim(),
      sourceImageUrl: dto.sourceImageUrl?.trim(),
      imageUrls: dto.imageUrls,
      primaryImageIndex: dto.primaryImageIndex,
      imageTypes: dto.imageTypes,
      clothingOption: dto.clothingOption,
    };

    try {
      return await this.characterService.create(createDto);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create character diagram';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('name') name: string,
  ): Promise<DbCharacterDiagram> {
    if (!file) {
      throw new HttpException('File is required', HttpStatus.BAD_REQUEST);
    }
    if (!name?.trim()) {
      throw new HttpException('Name is required', HttpStatus.BAD_REQUEST);
    }

    try {
      // Upload file to storage
      const result = await this.filesService.uploadFile(
        'CHARACTER_IMAGES',
        file.buffer,
        file.originalname,
        file.mimetype,
      );

      // Create character diagram record
      return await this.characterService.upload({
        name: name.trim(),
        fileUrl: result.url,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload character diagram';
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
  async findOne(@Param('id') id: string, @Query('include') include?: string): Promise<DbCharacterDiagram | CharacterDiagramWithImages> {
    if (include === 'images') {
      const diagram = await this.characterService.findOneWithImages(id);
      if (!diagram) {
        throw new HttpException('Character diagram not found', HttpStatus.NOT_FOUND);
      }
      return diagram;
    }

    const diagram = await this.characterService.findOne(id);
    if (!diagram) {
      throw new HttpException('Character diagram not found', HttpStatus.NOT_FOUND);
    }
    return diagram;
  }

  @Get(':id/images')
  async getImages(@Param('id') id: string): Promise<CharacterDiagramImage[]> {
    const diagram = await this.characterService.findOne(id);
    if (!diagram) {
      throw new HttpException('Character diagram not found', HttpStatus.NOT_FOUND);
    }
    return this.characterService.getImages(id);
  }

  @Post(':id/images')
  async addImages(
    @Param('id') id: string,
    @Body() body: { imageUrls: string[]; imageTypes?: Record<number, string> },
  ): Promise<CharacterDiagramImage[]> {
    if (!body.imageUrls?.length) {
      throw new HttpException('At least one image URL is required', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.characterService.addImages(id, body.imageUrls, body.imageTypes);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add images';
      if (message === 'Character diagram not found') {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Patch(':id/images/:imageId/primary')
  async setPrimaryImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ): Promise<{ success: boolean }> {
    try {
      await this.characterService.setPrimaryImage(id, imageId);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to set primary image';
      if (message === 'Image not found') {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete(':id/images/:imageId')
  async deleteImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ): Promise<{ success: boolean }> {
    try {
      await this.characterService.deleteImage(id, imageId);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete image';
      if (message === 'Image not found') {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      if (message.includes('Cannot delete')) {
        throw new HttpException(message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCharacterRequestDto,
  ): Promise<DbCharacterDiagram> {
    if (!dto.name?.trim()) {
      throw new HttpException('Name is required', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.characterService.update(id, { name: dto.name.trim() });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update character diagram';
      if (message === 'Character diagram not found') {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
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
