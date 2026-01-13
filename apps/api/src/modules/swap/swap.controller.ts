import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsNumber, IsIn, Min, Max, IsUrl } from 'class-validator';
import { Type } from 'class-transformer';
import { SwapService, CreateFaceSwapDto } from './swap.service';

class CreateSwapRequestDto {
  @IsString()
  @IsNotEmpty()
  videoId!: string;

  // Target face - at least one required (uploaded URL, character diagram, or reference kit)
  @IsOptional()
  @IsString()
  @IsUrl()
  uploadedFaceUrl?: string;

  @IsOptional()
  @IsString()
  characterDiagramId?: string;

  @IsOptional()
  @IsString()
  referenceKitId?: string;

  // LoRA model - REQUIRED for advanced pipeline
  @IsString()
  @IsNotEmpty()
  loraId!: string;

  // Video generation model - REQUIRED
  @IsString()
  @IsIn(['kling', 'luma', 'sora2pro', 'wan'])
  videoModel!: 'kling' | 'luma' | 'sora2pro' | 'wan';

  // Processing options
  @IsBoolean()
  keepOriginalOutfit!: boolean;

  // Upscaling options
  @IsString()
  @IsIn(['real-esrgan', 'clarity', 'creative', 'none'])
  upscaleMethod!: 'real-esrgan' | 'clarity' | 'creative' | 'none';

  @IsOptional()
  @IsString()
  @IsIn(['2k', '4k'])
  upscaleResolution?: '2k' | '4k';

  // Key frame count for processing (5-10)
  @IsNumber()
  @Min(5)
  @Max(10)
  @Type(() => Number)
  keyFrameCount!: number;
}

@Controller('swap')
export class SwapController {
  constructor(private readonly swapService: SwapService) {}

  @Post()
  async createSwap(@Body() dto: CreateSwapRequestDto) {
    if (!dto.videoId?.trim()) {
      throw new HttpException('Video ID is required', HttpStatus.BAD_REQUEST);
    }

    // Validate target face - at least one source required
    if (!dto.uploadedFaceUrl?.trim() && !dto.characterDiagramId?.trim() && !dto.referenceKitId?.trim()) {
      throw new HttpException('Target face is required (upload URL, Character Diagram ID, or Reference Kit ID)', HttpStatus.BAD_REQUEST);
    }

    // LoRA is now required
    if (!dto.loraId?.trim()) {
      throw new HttpException('LoRA model ID is required', HttpStatus.BAD_REQUEST);
    }

    try {
      const result = await this.swapService.createFaceSwap({
        videoId: dto.videoId.trim(),
        uploadedFaceUrl: dto.uploadedFaceUrl?.trim(),
        characterDiagramId: dto.characterDiagramId?.trim(),
        referenceKitId: dto.referenceKitId?.trim(),
        loraId: dto.loraId.trim(),
        videoModel: dto.videoModel,
        keepOriginalOutfit: dto.keepOriginalOutfit,
        upscaleMethod: dto.upscaleMethod,
        upscaleResolution: dto.upscaleResolution,
        keyFrameCount: dto.keyFrameCount,
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

  @Post(':id/retry')
  async retrySwap(@Param('id') id: string) {
    try {
      const result = await this.swapService.retryJob(id);
      return {
        success: true,
        message: 'Job requeued',
        jobId: result.jobId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to retry job';
      if (message.includes('not found')) {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      if (message.includes('Cannot retry')) {
        throw new HttpException(message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete(':id')
  async deleteSwap(@Param('id') id: string) {
    try {
      await this.swapService.deleteJob(id);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete job';
      if (message.includes('not found')) {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
