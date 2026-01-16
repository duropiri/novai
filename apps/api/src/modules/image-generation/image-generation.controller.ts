import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { IsString, IsNotEmpty, IsNumber, IsOptional, Min, Max, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ImageGenerationService } from './image-generation.service';

class CreateImageGenerationDto {
  @IsString()
  @IsOptional()
  loraId?: string;

  @IsString()
  @IsOptional()
  characterDiagramId?: string;

  @IsString()
  @IsOptional()
  referenceKitId?: string;

  @IsString()
  @IsOptional()
  expressionBoardId?: string;

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
  @IsOptional()
  @Min(0.5)
  @Max(1.0)
  loraStrength?: number;

  @IsNumber()
  @Type(() => Number)
  @IsOptional()
  @Min(0)
  @Max(1)
  imageStrength?: number;
}

@Controller('image-generation')
export class ImageGenerationController {
  private readonly logger = new Logger(ImageGenerationController.name);

  constructor(private readonly imageGenService: ImageGenerationService) {}

  @Post()
  async createGeneration(@Body() dto: CreateImageGenerationDto) {
    this.logger.log(`Image generation request: ${JSON.stringify(dto, null, 2)}`);

    const hasLora = !!dto.loraId?.trim();
    const hasDiagram = !!dto.characterDiagramId?.trim();
    const hasReferenceKit = !!dto.referenceKitId?.trim();
    const hasExpressionBoard = !!dto.expressionBoardId?.trim();

    // Count how many identity sources are selected
    const identitySourceCount = [hasLora, hasDiagram, hasReferenceKit, hasExpressionBoard].filter(Boolean).length;

    // Must select exactly one identity source
    if (identitySourceCount > 1) {
      throw new HttpException('Select only one: LoRA, Character Diagram, Reference Kit, or Expression Board', HttpStatus.BAD_REQUEST);
    }
    if (identitySourceCount === 0) {
      throw new HttpException('Select a LoRA model, Character Diagram, Reference Kit, or Expression Board', HttpStatus.BAD_REQUEST);
    }

    // Expression Board mode needs either prompt (text-to-image) or source image (face swap)
    if (hasExpressionBoard && !dto.prompt?.trim() && !dto.sourceImageUrl?.trim()) {
      throw new HttpException('Either prompt or source image is required when using Expression Board', HttpStatus.BAD_REQUEST);
    }

    // Character Diagram mode requires source image (face swap only - no generation)
    if (hasDiagram && !dto.sourceImageUrl?.trim()) {
      throw new HttpException('Source image is required when using Character Diagram', HttpStatus.BAD_REQUEST);
    }

    // Reference Kit mode needs either prompt (text-to-image) or source image (face swap)
    if (hasReferenceKit && !dto.prompt?.trim() && !dto.sourceImageUrl?.trim()) {
      throw new HttpException('Either prompt or source image is required when using Reference Kit', HttpStatus.BAD_REQUEST);
    }

    // LoRA mode needs either prompt or source image
    if (hasLora && !dto.prompt?.trim() && !dto.sourceImageUrl?.trim()) {
      throw new HttpException('Either prompt or source image is required', HttpStatus.BAD_REQUEST);
    }

    try {
      const result = await this.imageGenService.createImageGeneration({
        loraId: dto.loraId?.trim(),
        characterDiagramId: dto.characterDiagramId?.trim(),
        referenceKitId: dto.referenceKitId?.trim(),
        expressionBoardId: dto.expressionBoardId?.trim(),
        prompt: dto.prompt?.trim(),
        sourceImageUrl: dto.sourceImageUrl?.trim(),
        aspectRatio: dto.aspectRatio,
        numImages: dto.numImages,
        loraStrength: dto.loraStrength,
        imageStrength: dto.imageStrength,
      });

      this.logger.log(`Image generation job created: ${result.jobId}`);

      return {
        success: true,
        ...result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create image generation';
      const stack = error instanceof Error ? error.stack : '';

      this.logger.error(`Image generation failed: ${message}`);
      this.logger.error(`Stack trace: ${stack}`);
      this.logger.error(`Request details: loraId=${dto.loraId}, prompt=${dto.prompt?.substring(0, 50)}, sourceImageUrl=${dto.sourceImageUrl ? 'provided' : 'none'}`);

      if (message.includes('not found')) {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      if (message.includes('not ready')) {
        throw new HttpException(message, HttpStatus.BAD_REQUEST);
      }

      // Return specific error message instead of generic
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

  @Delete(':id')
  async deleteGeneration(@Param('id') id: string) {
    try {
      await this.imageGenService.deleteGeneration(id);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete generation';
      if (message.includes('not found')) {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
