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
import { VideoStrategy, VideoModel, UpscaleMethod } from '@novai/shared';

class CreateSwapRequestDto {
  @IsString()
  @IsNotEmpty()
  videoId!: string;

  // Strategy selection - determines the processing pipeline
  @IsOptional()
  @IsString()
  @IsIn(['face_swap', 'lora_generate', 'video_lora', 'hybrid'])
  strategy?: VideoStrategy;

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

  // LoRA model - required for lora_generate and hybrid strategies
  @IsOptional()
  @IsString()
  loraId?: string;

  // Video generation model (used by lora_generate, video_lora, hybrid)
  @IsOptional()
  @IsString()
  @IsIn(['kling', 'kling-2.5', 'kling-2.6', 'luma', 'sora2pro', 'wan'])
  videoModel?: VideoModel;

  // Processing options
  @IsOptional()
  @IsBoolean()
  keepOriginalOutfit?: boolean;

  // Upscaling options
  @IsOptional()
  @IsString()
  @IsIn(['real-esrgan', 'clarity', 'creative', 'none'])
  upscaleMethod?: UpscaleMethod;

  @IsOptional()
  @IsString()
  @IsIn(['2k', '4k'])
  upscaleResolution?: '2k' | '4k';

  // Strategy-specific options
  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(30)
  @Type(() => Number)
  keyFrameCount?: number; // For video_lora: frames to train on

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  refinementStrength?: number; // For hybrid: refinement intensity (0-1)
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

    const strategy = dto.strategy || 'lora_generate';

    // LoRA is required for lora_generate and hybrid strategies
    if ((strategy === 'lora_generate' || strategy === 'hybrid') && !dto.loraId?.trim()) {
      throw new HttpException(`LoRA model ID is required for ${strategy} strategy`, HttpStatus.BAD_REQUEST);
    }

    try {
      const result = await this.swapService.createFaceSwap({
        videoId: dto.videoId.trim(),
        strategy,
        uploadedFaceUrl: dto.uploadedFaceUrl?.trim(),
        characterDiagramId: dto.characterDiagramId?.trim(),
        referenceKitId: dto.referenceKitId?.trim(),
        loraId: dto.loraId?.trim(),
        videoModel: dto.videoModel,
        keepOriginalOutfit: dto.keepOriginalOutfit,
        upscaleMethod: dto.upscaleMethod,
        upscaleResolution: dto.upscaleResolution,
        keyFrameCount: dto.keyFrameCount,
        refinementStrength: dto.refinementStrength,
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
      if (message.includes('not ready') || message.includes('required')) {
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
