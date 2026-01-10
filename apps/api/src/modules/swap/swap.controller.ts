import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsNumber, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { SwapService, CreateFaceSwapDto } from './swap.service';

class CreateSwapRequestDto {
  @IsString()
  @IsNotEmpty()
  videoId!: string;

  @IsString()
  @IsNotEmpty()
  characterDiagramId!: string;

  @IsString()
  @IsOptional()
  loraId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['480p', '580p', '720p'])
  resolution?: '480p' | '580p' | '720p';

  @IsOptional()
  @IsString()
  @IsIn(['low', 'medium', 'high', 'maximum'])
  videoQuality?: 'low' | 'medium' | 'high' | 'maximum';

  @IsOptional()
  @IsBoolean()
  useTurbo?: boolean;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  inferenceSteps?: number;
}

@Controller('swap')
export class SwapController {
  constructor(private readonly swapService: SwapService) {}

  @Post()
  async createSwap(@Body() dto: CreateSwapRequestDto) {
    if (!dto.videoId?.trim()) {
      throw new HttpException('Video ID is required', HttpStatus.BAD_REQUEST);
    }
    if (!dto.characterDiagramId?.trim()) {
      throw new HttpException('Character Diagram ID is required', HttpStatus.BAD_REQUEST);
    }
    // LoRA is optional - Kling uses character diagram for identity

    try {
      const result = await this.swapService.createFaceSwap({
        videoId: dto.videoId.trim(),
        characterDiagramId: dto.characterDiagramId.trim(),
        loraId: dto.loraId?.trim(),
        resolution: dto.resolution,
        videoQuality: dto.videoQuality,
        useTurbo: dto.useTurbo,
        inferenceSteps: dto.inferenceSteps,
      });

      return {
        success: true,
        ...result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create face swap';

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
  async getSwapResult(@Param('jobId') jobId: string) {
    const video = await this.swapService.getSwapResults(jobId);
    if (!video) {
      throw new HttpException('Swap result not found or not ready', HttpStatus.NOT_FOUND);
    }
    return video;
  }

  @Get('history')
  async getSwapHistory() {
    return this.swapService.listSwappedVideos();
  }
}
