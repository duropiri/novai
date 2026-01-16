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
  UploadedFiles,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { IsString, IsNotEmpty, IsOptional, IsNumber, IsUrl, IsBoolean, IsArray, IsIn, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { LoraService, CreateLoraDto } from './lora.service';
import { DbLoraModel } from '../files/supabase.service';
import { DatasetAnalysisService, DatasetAnalysisResult } from '../../services/dataset-analysis.service';
import { TrainingOptimizerService } from '../../services/training-optimizer.service';

export class CreateLoraRequestDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  triggerWord!: string;

  @IsString()
  @IsNotEmpty()
  imagesZipUrl!: string;

  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(6000)
  @Type(() => Number)
  steps?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.00001)
  @Max(0.01)
  @Type(() => Number)
  learningRate?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isStyle?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  includeSyntheticCaptions?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  useFaceDetection?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  useFaceCropping?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  useMasks?: boolean;

  // Dataset analysis options (Studio Reverse Engineering Engine)
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  enableAnalysis?: boolean;

  @IsOptional()
  @IsIn(['quick', 'standard', 'comprehensive'])
  analysisMode?: 'quick' | 'standard' | 'comprehensive';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[];
}

export class AnalyzeDatasetRequestDto {
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  imageUrls!: string[];

  @IsOptional()
  @IsIn(['quick', 'standard', 'comprehensive'])
  mode?: 'quick' | 'standard' | 'comprehensive';

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isStyle?: boolean;
}

export class ImportLoraRequestDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  triggerWord!: string;

  @IsUrl()
  @IsNotEmpty()
  weightsUrl!: string;

  @IsOptional()
  @IsUrl()
  thumbnailUrl?: string;
}

@Controller('lora')
export class LoraController {
  constructor(
    private readonly loraService: LoraService,
    private readonly datasetAnalysis: DatasetAnalysisService,
    private readonly trainingOptimizer: TrainingOptimizerService,
  ) {}

  @Post()
  async create(@Body() dto: CreateLoraRequestDto): Promise<DbLoraModel> {
    if (!dto.name?.trim()) {
      throw new HttpException('Name is required', HttpStatus.BAD_REQUEST);
    }
    if (!dto.triggerWord?.trim()) {
      throw new HttpException('Trigger word is required', HttpStatus.BAD_REQUEST);
    }
    if (!dto.imagesZipUrl?.trim()) {
      throw new HttpException('Images ZIP URL is required', HttpStatus.BAD_REQUEST);
    }

    const createDto: CreateLoraDto = {
      name: dto.name.trim(),
      triggerWord: dto.triggerWord.trim().toLowerCase(),
      imagesZipUrl: dto.imagesZipUrl.trim(),
      steps: dto.steps,
      learningRate: dto.learningRate,
      isStyle: dto.isStyle,
      includeSyntheticCaptions: dto.includeSyntheticCaptions,
      useFaceDetection: dto.useFaceDetection,
      useFaceCropping: dto.useFaceCropping,
      useMasks: dto.useMasks,
      // Dataset analysis options
      enableAnalysis: dto.enableAnalysis,
      analysisMode: dto.analysisMode,
      imageUrls: dto.imageUrls,
    };

    // Validate steps if provided
    if (createDto.steps !== undefined) {
      if (createDto.steps < 10 || createDto.steps > 6000) {
        throw new HttpException(
          'Steps must be between 10 and 6000',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // Validate learning rate if provided
    if (createDto.learningRate !== undefined) {
      if (createDto.learningRate < 0.00001 || createDto.learningRate > 0.01) {
        throw new HttpException(
          'Learning rate must be between 0.00001 and 0.01',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    try {
      return await this.loraService.create(createDto);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create LoRA';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('upload')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'file', maxCount: 1 },
      { name: 'thumbnail', maxCount: 1 },
    ]),
  )
  async upload(
    @UploadedFiles()
    files: {
      file?: Express.Multer.File[];
      thumbnail?: Express.Multer.File[];
    },
    @Body() body: { name?: string; triggerWord?: string },
  ): Promise<DbLoraModel> {
    // Validate required file
    if (!files.file || files.file.length === 0) {
      throw new HttpException(
        'A .safetensors file is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const weightsFile = files.file[0];

    // Validate file extension
    if (!weightsFile.originalname.endsWith('.safetensors')) {
      throw new HttpException(
        'File must be a .safetensors file',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate required fields
    if (!body.name?.trim()) {
      throw new HttpException('Name is required', HttpStatus.BAD_REQUEST);
    }
    if (!body.triggerWord?.trim()) {
      throw new HttpException('Trigger word is required', HttpStatus.BAD_REQUEST);
    }

    const thumbnailFile = files.thumbnail?.[0];

    try {
      return await this.loraService.uploadManual({
        name: body.name.trim(),
        triggerWord: body.triggerWord.trim().toLowerCase(),
        weightsBuffer: weightsFile.buffer,
        weightsFileName: weightsFile.originalname,
        thumbnailBuffer: thumbnailFile?.buffer,
        thumbnailFileName: thumbnailFile?.originalname,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload LoRA';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('import')
  async importFromUrl(@Body() dto: ImportLoraRequestDto): Promise<DbLoraModel> {
    // Validate URL format (should be .safetensors or from known hosts)
    const url = dto.weightsUrl.toLowerCase();
    const isValidUrl =
      url.endsWith('.safetensors') ||
      url.includes('fal.ai') ||
      url.includes('civitai.com') ||
      url.includes('huggingface.co') ||
      url.includes('replicate.delivery');

    if (!isValidUrl) {
      throw new HttpException(
        'Invalid URL. Must be a .safetensors file or from a known host (fal.ai, civitai.com, huggingface.co)',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      return await this.loraService.importFromUrl({
        name: dto.name.trim(),
        triggerWord: dto.triggerWord.trim().toLowerCase(),
        weightsUrl: dto.weightsUrl,
        thumbnailUrl: dto.thumbnailUrl,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import LoRA';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get()
  async findAll(@Query('status') status?: string): Promise<DbLoraModel[]> {
    const validStatuses = ['pending', 'training', 'ready', 'failed'];
    if (status && !validStatuses.includes(status)) {
      throw new HttpException(
        `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.loraService.findAll(status);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<DbLoraModel> {
    const model = await this.loraService.findOne(id);
    if (!model) {
      throw new HttpException('LoRA model not found', HttpStatus.NOT_FOUND);
    }
    return model;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; triggerWord?: string; thumbnailUrl?: string },
  ): Promise<DbLoraModel> {
    const model = await this.loraService.findOne(id);
    if (!model) {
      throw new HttpException('LoRA model not found', HttpStatus.NOT_FOUND);
    }

    const updates: { name?: string; trigger_word?: string; thumbnail_url?: string | null } = {};
    if (body.name?.trim()) {
      updates.name = body.name.trim();
    }
    if (body.triggerWord?.trim()) {
      updates.trigger_word = body.triggerWord.trim().toLowerCase();
    }
    if (body.thumbnailUrl !== undefined) {
      updates.thumbnail_url = body.thumbnailUrl?.trim() || null;
    }

    if (Object.keys(updates).length === 0) {
      throw new HttpException('No valid fields to update', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.loraService.update(id, updates);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update LoRA';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Patch(':id/thumbnail')
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'thumbnail', maxCount: 1 }]),
  )
  async updateThumbnail(
    @Param('id') id: string,
    @UploadedFiles() files: { thumbnail?: Express.Multer.File[] },
  ): Promise<DbLoraModel> {
    const model = await this.loraService.findOne(id);
    if (!model) {
      throw new HttpException('LoRA model not found', HttpStatus.NOT_FOUND);
    }

    if (!files.thumbnail || files.thumbnail.length === 0) {
      throw new HttpException('Thumbnail file is required', HttpStatus.BAD_REQUEST);
    }

    const thumbnailFile = files.thumbnail[0];

    try {
      return await this.loraService.updateThumbnail(id, {
        buffer: thumbnailFile.buffer,
        fileName: thumbnailFile.originalname,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update thumbnail';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string): Promise<DbLoraModel> {
    try {
      return await this.loraService.cancel(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to cancel LoRA training';
      if (message === 'LoRA model not found') {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      if (message.includes('Cannot cancel')) {
        throw new HttpException(message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':id/retry')
  async retry(@Param('id') id: string): Promise<DbLoraModel> {
    try {
      return await this.loraService.retry(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to retry LoRA training';
      if (message === 'LoRA model not found') {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      if (message.includes('Cannot retry')) {
        throw new HttpException(message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete(':id')
  async delete(@Param('id') id: string): Promise<{ success: boolean }> {
    try {
      await this.loraService.delete(id);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete LoRA';
      if (message === 'LoRA model not found') {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      if (message.includes('Cannot delete')) {
        throw new HttpException(message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete(':id/force')
  async forceDelete(@Param('id') id: string): Promise<{ success: boolean }> {
    try {
      await this.loraService.forceDelete(id);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to force delete LoRA';
      if (message === 'LoRA model not found') {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('cleanup-stuck')
  async cleanupStuck(
    @Query('maxAgeMinutes') maxAgeMinutes?: string,
  ): Promise<{ deleted: number; ids: string[] }> {
    try {
      const minutes = maxAgeMinutes ? parseInt(maxAgeMinutes, 10) : 60;
      return await this.loraService.cleanupStuck(minutes);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to cleanup stuck LoRAs';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Analyze a dataset before training
   * Returns quality scores, gaps, and recommended training parameters
   */
  @Post('analyze')
  async analyzeDataset(
    @Body() dto: AnalyzeDatasetRequestDto,
  ): Promise<{
    analysis: DatasetAnalysisResult;
    recommendations: {
      steps: number;
      learningRate: number;
      useFaceDetection: boolean;
      useFaceCropping: boolean;
      useMasks: boolean;
      includeSyntheticCaptions: boolean;
      confidence: number;
      reasoning: string[];
    };
    estimatedCost: {
      analysisCents: number;
      trainingCents: number;
      totalCents: number;
    };
  }> {
    if (!dto.imageUrls || dto.imageUrls.length === 0) {
      throw new HttpException('At least one image URL is required', HttpStatus.BAD_REQUEST);
    }

    try {
      // Run dataset analysis
      const mode = dto.mode ?? 'standard';
      const analysis = await this.datasetAnalysis.analyzeDataset(dto.imageUrls, mode);

      // Get optimized training parameters
      const optimized = this.trainingOptimizer.optimize({
        userParams: { isStyle: dto.isStyle ?? false },
        analysis,
      });

      // Calculate estimated costs
      const analysisCents = analysis.totalCost;
      const trainingCents = 200; // $2.00 for WAN 2.2 training

      return {
        analysis,
        recommendations: {
          steps: optimized.steps,
          learningRate: optimized.learningRate,
          useFaceDetection: optimized.useFaceDetection,
          useFaceCropping: optimized.useFaceCropping,
          useMasks: optimized.useMasks,
          includeSyntheticCaptions: optimized.includeSyntheticCaptions,
          confidence: optimized.confidence,
          reasoning: optimized.reasoning,
        },
        estimatedCost: {
          analysisCents,
          trainingCents,
          totalCents: analysisCents + trainingCents,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to analyze dataset';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Quick dataset check without full analysis
   * Returns basic quality estimate and suggested analysis mode
   */
  @Post('quick-check')
  async quickCheck(
    @Body() dto: { imageUrls: string[] },
  ): Promise<{
    totalImages: number;
    estimatedValidImages: number;
    suggestedMode: 'quick' | 'standard' | 'comprehensive';
    warnings: string[];
    quickRecommendations: {
      recommendedSteps: number;
      recommendedLR: number;
      warning?: string;
    };
  }> {
    if (!dto.imageUrls || dto.imageUrls.length === 0) {
      throw new HttpException('At least one image URL is required', HttpStatus.BAD_REQUEST);
    }

    try {
      const check = await this.datasetAnalysis.quickCheck(dto.imageUrls);
      const quickRec = this.trainingOptimizer.getQuickRecommendation(dto.imageUrls.length);

      return {
        ...check,
        quickRecommendations: quickRec,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to quick check dataset';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ============================================
  // HiRA (High Rank Adaptation) Face Endpoints
  // ============================================

  /**
   * Process training images for face detection and identity tracking
   * This runs HiRA face processing on the training images
   */
  @Post(':id/faces/process')
  async processTrainingFaces(
    @Param('id') id: string,
    @Body() dto: { imageUrls: string[] },
  ): Promise<{
    totalFaces: number;
    clusters: Array<{
      clusterIndex: number;
      faceCount: number;
      matchedIdentity?: { id: string; name?: string; similarity: number };
      detectionIds: string[];
    }>;
    primaryIdentity?: unknown;
    newIdentities: unknown[];
    angleCoverage: Record<string, { angle: string; quality: number }[]>;
  }> {
    const model = await this.loraService.findOne(id);
    if (!model) {
      throw new HttpException('LoRA model not found', HttpStatus.NOT_FOUND);
    }

    if (!dto.imageUrls || dto.imageUrls.length === 0) {
      throw new HttpException('At least one image URL is required', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.loraService.processTrainingFaces(id, dto.imageUrls);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to process faces';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Get face detection results for a LoRA model
   */
  @Get(':id/faces')
  async getFaceResults(@Param('id') id: string): Promise<{
    primaryIdentity?: unknown;
    allIdentities: unknown[];
    detectedFaces: unknown;
  }> {
    const result = await this.loraService.getFaceResults(id);
    if (!result) {
      throw new HttpException('LoRA model not found', HttpStatus.NOT_FOUND);
    }
    return result;
  }

  /**
   * Set the primary face identity for a LoRA model
   */
  @Post(':id/faces/primary')
  async setPrimaryFaceIdentity(
    @Param('id') id: string,
    @Body() dto: { identityId: string },
  ): Promise<{ success: boolean }> {
    const model = await this.loraService.findOne(id);
    if (!model) {
      throw new HttpException('LoRA model not found', HttpStatus.NOT_FOUND);
    }

    if (!dto.identityId?.trim()) {
      throw new HttpException('Identity ID is required', HttpStatus.BAD_REQUEST);
    }

    try {
      await this.loraService.setPrimaryFaceIdentity(id, dto.identityId.trim());
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to set primary identity';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Generate 3D face mesh for the primary identity
   */
  @Post(':id/faces/mesh')
  async generateFaceMesh(@Param('id') id: string): Promise<{
    meshUrl?: string;
    thumbnailUrl?: string;
    skullVectors?: unknown;
    skipped?: boolean;
    reason?: string;
  }> {
    const model = await this.loraService.findOne(id);
    if (!model) {
      throw new HttpException('LoRA model not found', HttpStatus.NOT_FOUND);
    }

    try {
      const result = await this.loraService.generateFaceMesh(id);
      if (!result) {
        return { skipped: true, reason: 'Insufficient angle coverage or mesh already exists' };
      }
      return {
        meshUrl: result.meshUrl,
        thumbnailUrl: result.thumbnailUrl,
        skullVectors: result.skullVectors,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate mesh';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
