import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { IsString, IsNotEmpty, IsNumber, IsOptional, Min, Max, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ImageGenerationService } from './image-generation.service';

class CreateImageGenerationDto {
  @IsString()
  @IsNotEmpty()
  loraId!: string;

  @IsString()
  @IsOptional()
  prompt?: string;

  @IsString()
  @IsOptional()
  sourceImageUrl?: string;

  @IsString()
  @IsOptional()
  @IsIn(['1:1', '16:9', '9:16', '4:5', '3:4'])
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:5' | '3:4';

  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(4)
  numImages!: number;

  @IsNumber()
  @Type(() => Number)
  @Min(0.5)
  @Max(1.0)
  loraStrength!: number;

  @IsNumber()
  @Type(() => Number)
  @IsOptional()
  @Min(0)
  @Max(1)
  imageStrength?: number;
}

@Controller('image-generation')
export class ImageGenerationController {
  constructor(private readonly imageGenService: ImageGenerationService) {}

  @Post()
  async createGeneration(@Body() dto: CreateImageGenerationDto) {
    if (!dto.loraId?.trim()) {
      throw new HttpException('LoRA ID is required', HttpStatus.BAD_REQUEST);
    }

    // Need either prompt or source image
    if (!dto.prompt?.trim() && !dto.sourceImageUrl?.trim()) {
      throw new HttpException('Either prompt or source image is required', HttpStatus.BAD_REQUEST);
    }

    try {
      const result = await this.imageGenService.createImageGeneration({
        loraId: dto.loraId.trim(),
        prompt: dto.prompt?.trim(),
        sourceImageUrl: dto.sourceImageUrl?.trim(),
        aspectRatio: dto.aspectRatio,
        numImages: dto.numImages,
        loraStrength: dto.loraStrength,
        imageStrength: dto.imageStrength,
      });

      return {
        success: true,
        ...result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create image generation';

      if (message.includes('not found')) {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      if (message.includes('not ready')) {
        throw new HttpException(message, HttpStatus.BAD_REQUEST);
      }

      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('results/:jobId')
  async getResults(@Param('jobId') jobId: string) {
    const images = await this.imageGenService.getGenerationResults(jobId);
    if (!images) {
      throw new HttpException('Results not found or not ready', HttpStatus.NOT_FOUND);
    }
    return { images };
  }

  @Get('history')
  async getHistory(@Query('limit') limit?: string) {
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    return this.imageGenService.listRecentGenerations(parsedLimit);
  }
}
