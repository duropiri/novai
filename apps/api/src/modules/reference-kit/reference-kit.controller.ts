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
import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsArray, IsObject } from 'class-validator';
import { ReferenceKitService, ReferenceKitSourceImage, ReferenceKitWithSources } from './reference-kit.service';
import { DbReferenceKit } from '../files/supabase.service';

export class CreateReferenceKitDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  sourceImageUrl?: string; // Single image (backward compatible)

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[]; // Multiple source images

  @IsOptional()
  @IsObject()
  imageTypes?: Record<number, string>;

  @IsOptional()
  @IsBoolean()
  generateExtended?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  expressions?: string[];
}

export class UpdateReferenceKitDto {
  @IsOptional()
  @IsString()
  name?: string;
}

@Controller('reference-kits')
export class ReferenceKitController {
  constructor(private readonly referenceKitService: ReferenceKitService) {}

  @Post()
  async create(@Body() dto: CreateReferenceKitDto): Promise<DbReferenceKit> {
    if (!dto.name?.trim()) {
      throw new HttpException('Name is required', HttpStatus.BAD_REQUEST);
    }
    // Support both single image and multiple images
    const hasImages = dto.imageUrls?.length || dto.sourceImageUrl?.trim();
    if (!hasImages) {
      throw new HttpException('At least one source image URL is required', HttpStatus.BAD_REQUEST);
    }

    // Validate expressions if provided
    const validExpressions = ['smile', 'serious', 'surprised', 'angry'];
    if (dto.expressions) {
      for (const expr of dto.expressions) {
        if (!validExpressions.includes(expr)) {
          throw new HttpException(
            `Invalid expression: ${expr}. Valid options: ${validExpressions.join(', ')}`,
            HttpStatus.BAD_REQUEST,
          );
        }
      }
    }

    try {
      return await this.referenceKitService.create({
        name: dto.name.trim(),
        sourceImageUrl: dto.sourceImageUrl?.trim(),
        imageUrls: dto.imageUrls,
        imageTypes: dto.imageTypes,
        generateExtended: dto.generateExtended,
        expressions: dto.expressions,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create Reference Kit';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get()
  async findAll(@Query('status') status?: string): Promise<DbReferenceKit[]> {
    const validStatuses = ['pending', 'generating', 'ready', 'failed'];
    if (status && !validStatuses.includes(status)) {
      throw new HttpException(
        `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.referenceKitService.findAll(status);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Query('include') include?: string): Promise<DbReferenceKit | ReferenceKitWithSources> {
    if (include === 'sources') {
      const kit = await this.referenceKitService.findOneWithSources(id);
      if (!kit) {
        throw new HttpException('Reference Kit not found', HttpStatus.NOT_FOUND);
      }
      return kit;
    }

    const kit = await this.referenceKitService.findOne(id);
    if (!kit) {
      throw new HttpException('Reference Kit not found', HttpStatus.NOT_FOUND);
    }
    return kit;
  }

  @Get(':id/sources')
  async getSources(@Param('id') id: string): Promise<ReferenceKitSourceImage[]> {
    const kit = await this.referenceKitService.findOne(id);
    if (!kit) {
      throw new HttpException('Reference Kit not found', HttpStatus.NOT_FOUND);
    }
    return this.referenceKitService.getSources(id);
  }

  @Post(':id/sources')
  async addSources(
    @Param('id') id: string,
    @Body() body: { imageUrls: string[]; imageTypes?: Record<number, string> },
  ): Promise<ReferenceKitSourceImage[]> {
    if (!body.imageUrls?.length) {
      throw new HttpException('At least one image URL is required', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.referenceKitService.addSources(id, body.imageUrls, body.imageTypes);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add source images';
      if (message === 'Reference Kit not found') {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete(':id/sources/:sourceId')
  async deleteSource(
    @Param('id') id: string,
    @Param('sourceId') sourceId: string,
  ): Promise<{ success: boolean }> {
    try {
      await this.referenceKitService.deleteSource(id, sourceId);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete source image';
      if (message === 'Source image not found') {
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
    @Body() dto: UpdateReferenceKitDto,
  ): Promise<DbReferenceKit> {
    const kit = await this.referenceKitService.findOne(id);
    if (!kit) {
      throw new HttpException('Reference Kit not found', HttpStatus.NOT_FOUND);
    }

    if (!dto.name?.trim()) {
      throw new HttpException('Name is required', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.referenceKitService.update(id, { name: dto.name.trim() });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update Reference Kit';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete(':id')
  async delete(@Param('id') id: string): Promise<{ success: boolean }> {
    try {
      await this.referenceKitService.delete(id);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete Reference Kit';
      if (message === 'Reference Kit not found') {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      if (message.includes('Cannot delete')) {
        throw new HttpException(message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':id/regenerate/:type')
  async regenerate(
    @Param('id') id: string,
    @Param('type') type: string,
  ): Promise<DbReferenceKit> {
    const kit = await this.referenceKitService.findOne(id);
    if (!kit) {
      throw new HttpException('Reference Kit not found', HttpStatus.NOT_FOUND);
    }

    // Validate reference type
    const validTypes = ['anchor', 'profile', 'waist_up', 'half_body', 'full_body', 'expression_smile', 'expression_serious', 'expression_surprised', 'expression_angry'];
    if (!validTypes.includes(type)) {
      throw new HttpException(
        `Invalid reference type: ${type}. Valid options: ${validTypes.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      return await this.referenceKitService.regenerate({
        kitId: id,
        referenceType: type,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to regenerate reference';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
