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
import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsArray } from 'class-validator';
import { ReferenceKitService } from './reference-kit.service';
import { DbReferenceKit } from '../files/supabase.service';

export class CreateReferenceKitDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  sourceImageUrl!: string;

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
    if (!dto.sourceImageUrl?.trim()) {
      throw new HttpException('Source image URL is required', HttpStatus.BAD_REQUEST);
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
        sourceImageUrl: dto.sourceImageUrl.trim(),
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
  async findOne(@Param('id') id: string): Promise<DbReferenceKit> {
    const kit = await this.referenceKitService.findOne(id);
    if (!kit) {
      throw new HttpException('Reference Kit not found', HttpStatus.NOT_FOUND);
    }
    return kit;
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
