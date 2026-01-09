import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { VariantsService, CreateVariantBatchDto, VariantBatchResult } from './variants.service';
import { DbVideo } from '../files/supabase.service';

class CreateVariantBatchRequestDto {
  videoCollectionIds!: string[];
  audioCollectionIds?: string[];
  hookIds?: string[];
  hookDuration?: number;
  hookPosition?: 'top' | 'center' | 'bottom';
}

@Controller('variants')
export class VariantsController {
  constructor(private readonly variantsService: VariantsService) {}

  @Post()
  async createBatch(@Body() dto: CreateVariantBatchRequestDto): Promise<VariantBatchResult> {
    if (!dto.videoCollectionIds || dto.videoCollectionIds.length === 0) {
      throw new HttpException('At least one video collection is required', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.variantsService.createBatch({
        videoCollectionIds: dto.videoCollectionIds,
        audioCollectionIds: dto.audioCollectionIds,
        hookIds: dto.hookIds,
        hookDuration: dto.hookDuration,
        hookPosition: dto.hookPosition,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create variant batch';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('batch/:batchId/status')
  async getBatchStatus(@Param('batchId') batchId: string): Promise<{
    total: number;
    completed: number;
    failed: number;
    processing: number;
    pending: number;
  }> {
    try {
      return await this.variantsService.getBatchStatus(batchId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get batch status';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('batch/:batchId/results')
  async getBatchResults(@Param('batchId') batchId: string): Promise<DbVideo[]> {
    try {
      return await this.variantsService.getCompletedVariants(batchId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get batch results';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('batch/:batchId/info')
  async getBatchInfo(@Param('batchId') batchId: string): Promise<{
    batchId: string;
    createdAt: string;
    expiresAt: string;
    zipUrl?: string;
    totalVariants: number;
  }> {
    const info = this.variantsService.getBatchInfo(batchId);
    if (!info) {
      throw new HttpException('Batch not found', HttpStatus.NOT_FOUND);
    }

    return {
      batchId: info.batchId,
      createdAt: info.createdAt.toISOString(),
      expiresAt: info.expiresAt.toISOString(),
      zipUrl: info.zipUrl,
      totalVariants: info.totalVariants,
    };
  }

  @Post('batch/:batchId/zip')
  async createBatchZip(@Param('batchId') batchId: string): Promise<{
    zipUrl: string;
    expiresAt: string;
  }> {
    try {
      const result = await this.variantsService.createBatchZip(batchId);
      return {
        zipUrl: result.zipUrl,
        expiresAt: result.expiresAt.toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create ZIP';
      if (message === 'Batch has expired') {
        throw new HttpException(message, HttpStatus.GONE);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('cleanup')
  async cleanupExpiredBatches(): Promise<{ cleanedUp: number }> {
    try {
      const cleanedUp = await this.variantsService.cleanupExpiredBatches();
      return { cleanedUp };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to cleanup';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
