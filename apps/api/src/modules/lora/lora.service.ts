import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService, DbLoraModel } from '../files/supabase.service';
import { JobsService } from '../jobs/jobs.service';
import { DatasetAnalysisService, DatasetAnalysisResult } from '../../services/dataset-analysis.service';
import { TrainingOptimizerService, OptimizedParameters } from '../../services/training-optimizer.service';

export interface CreateLoraDto {
  name: string;
  triggerWord: string;
  imagesZipUrl: string;
  // WAN 2.2 training options
  steps?: number;
  learningRate?: number;
  isStyle?: boolean;
  includeSyntheticCaptions?: boolean;
  useFaceDetection?: boolean;
  useFaceCropping?: boolean;
  useMasks?: boolean;
  // Dataset analysis options (Studio Reverse Engineering Engine)
  enableAnalysis?: boolean;
  analysisMode?: 'quick' | 'standard' | 'comprehensive';
  imageUrls?: string[]; // Individual image URLs for analysis (optional, if not using ZIP)
}

export interface UploadLoraDto {
  name: string;
  triggerWord: string;
  weightsBuffer: Buffer;
  weightsFileName: string;
  thumbnailBuffer?: Buffer;
  thumbnailFileName?: string;
}

export interface ImportLoraDto {
  name: string;
  triggerWord: string;
  weightsUrl: string;
  thumbnailUrl?: string;
}

@Injectable()
export class LoraService {
  private readonly logger = new Logger(LoraService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly jobsService: JobsService,
    private readonly datasetAnalysis: DatasetAnalysisService,
    private readonly trainingOptimizer: TrainingOptimizerService,
  ) {}

  private checkInitialized(): void {
    if (!this.supabase.isInitialized()) {
      throw new Error('Database not configured. Please set up Supabase credentials.');
    }
  }

  async create(dto: CreateLoraDto): Promise<DbLoraModel> {
    this.checkInitialized();
    this.logger.log(`Creating LoRA model: ${dto.name}`);

    // Extract WAN 2.2 training options with defaults
    let steps = dto.steps ?? 1000;
    let learningRate = dto.learningRate ?? 0.0007;
    const isStyle = dto.isStyle ?? false;
    let includeSyntheticCaptions = dto.includeSyntheticCaptions ?? false;
    let useFaceDetection = dto.useFaceDetection ?? true;
    let useFaceCropping = dto.useFaceCropping ?? false;
    let useMasks = dto.useMasks ?? true;

    // Dataset analysis results (if enabled)
    let datasetAnalysis: DatasetAnalysisResult | null = null;
    let optimizedParams: OptimizedParameters | null = null;
    let qualityScore: number | null = null;

    // Run pre-training dataset analysis if enabled and image URLs provided
    if (dto.enableAnalysis && dto.imageUrls && dto.imageUrls.length > 0) {
      this.logger.log(`Running pre-training analysis on ${dto.imageUrls.length} images...`);

      try {
        // Analyze the dataset
        const analysisMode = dto.analysisMode ?? 'standard';
        datasetAnalysis = await this.datasetAnalysis.analyzeDataset(
          dto.imageUrls,
          analysisMode,
        );

        // Store estimated training success as quality score
        qualityScore = datasetAnalysis.estimatedTrainingSuccess;

        this.logger.log(`Dataset analysis complete: quality=${datasetAnalysis.datasetQuality}, score=${qualityScore}%`);

        // Optimize training parameters based on analysis
        optimizedParams = this.trainingOptimizer.optimize({
          userParams: { steps, learningRate, isStyle },
          analysis: datasetAnalysis,
        });

        // Apply optimized parameters
        steps = optimizedParams.steps;
        learningRate = optimizedParams.learningRate;
        useFaceDetection = optimizedParams.useFaceDetection;
        useFaceCropping = optimizedParams.useFaceCropping;
        useMasks = optimizedParams.useMasks;
        includeSyntheticCaptions = optimizedParams.includeSyntheticCaptions;

        this.logger.log(`Optimized params: steps=${steps}, LR=${learningRate.toFixed(6)}`);
        this.logger.log(`Optimization reasoning: ${optimizedParams.reasoning.join('; ')}`);
      } catch (error) {
        // Log but don't fail - continue with default parameters
        this.logger.warn(`Dataset analysis failed, using defaults: ${error}`);
      }
    } else if (dto.imageUrls && dto.imageUrls.length > 0) {
      // Quick recommendation without full analysis
      const quickRec = this.trainingOptimizer.getQuickRecommendation(dto.imageUrls.length, isStyle);
      if (!dto.steps) steps = quickRec.recommendedSteps;
      if (!dto.learningRate) learningRate = quickRec.recommendedLR;

      if (quickRec.warning) {
        this.logger.warn(`Quick recommendation: ${quickRec.warning}`);
      }
    }

    // Create the LoRA model record
    const loraModel = await this.supabase.createLoraModel({
      name: dto.name,
      trigger_word: dto.triggerWord,
      training_images_url: dto.imagesZipUrl,
      training_steps: steps,
      status: 'pending',
      // WAN 2.2 fields - will be set after training
      lora_url: null,
      weights_url: null,
      diffusers_lora_url: null,
      config_url: null,
      thumbnail_url: null,
      cost_cents: null,
      error_message: null,
      trainer: 'wan-22',
      learning_rate: learningRate,
      is_style: isStyle,
      progress: 0,
      status_message: datasetAnalysis ? `Analyzed: ${datasetAnalysis.datasetQuality} quality` : 'Waiting in queue',
      // Dataset analysis fields
      dataset_analysis: datasetAnalysis ? {
        datasetQuality: datasetAnalysis.datasetQuality,
        estimatedSuccess: datasetAnalysis.estimatedTrainingSuccess,
        totalImages: datasetAnalysis.images.length,
        validImages: datasetAnalysis.images.filter(i => i.is_valid).length,
        gaps: datasetAnalysis.datasetGaps,
        recommendations: datasetAnalysis.recommendations.slice(0, 5),
        aggregates: datasetAnalysis.aggregates,
        analysisCost: datasetAnalysis.totalCost,
      } : null,
      applied_optimizations: optimizedParams ? {
        originalSteps: optimizedParams.originalParams?.steps,
        originalLR: optimizedParams.originalParams?.learningRate,
        optimizedSteps: optimizedParams.steps,
        optimizedLR: optimizedParams.learningRate,
        confidence: optimizedParams.confidence,
        reasoning: optimizedParams.reasoning,
        faceDetection: optimizedParams.useFaceDetection,
        faceCropping: optimizedParams.useFaceCropping,
        masks: optimizedParams.useMasks,
        syntheticCaptions: optimizedParams.includeSyntheticCaptions,
      } : null,
      quality_score: qualityScore,
    });

    // Create a job record and enqueue it
    const job = await this.jobsService.createAndEnqueueJob('lora_training', loraModel.id, {
      loraModelId: loraModel.id,
      imagesZipUrl: dto.imagesZipUrl,
      triggerWord: dto.triggerWord,
      steps,
      learningRate,
      isStyle,
      includeSyntheticCaptions,
      useFaceDetection: isStyle ? false : useFaceDetection, // Disable face options for style training
      useFaceCropping: isStyle ? false : useFaceCropping,
      useMasks: isStyle ? false : useMasks,
    });

    this.logger.log(`LoRA model ${loraModel.id} queued for WAN 2.2 training (job: ${job.id})`);
    if (datasetAnalysis) {
      this.logger.log(`Pre-training analysis: ${datasetAnalysis.datasetQuality} quality, ${datasetAnalysis.datasetGaps.length} gaps identified`);
    }

    return loraModel;
  }

  async uploadManual(dto: UploadLoraDto): Promise<DbLoraModel> {
    this.checkInitialized();
    this.logger.log(`Uploading manual LoRA model: ${dto.name}`);

    // Generate a UUID for the model
    const modelId = crypto.randomUUID();

    // Upload weights file to Supabase storage
    const weightsPath = `${modelId}/weights.safetensors`;
    const { url: weightsUrl } = await this.supabase.uploadFile(
      'lora-weights',
      weightsPath,
      dto.weightsBuffer,
      'application/octet-stream',
    );

    // Upload thumbnail if provided
    let thumbnailUrl: string | null = null;
    if (dto.thumbnailBuffer && dto.thumbnailFileName) {
      const ext = dto.thumbnailFileName.split('.').pop() || 'jpg';
      const thumbnailPath = `${modelId}/thumbnail.${ext}`;
      const thumbnailResult = await this.supabase.uploadFile(
        'lora-weights',
        thumbnailPath,
        dto.thumbnailBuffer,
        dto.thumbnailFileName.endsWith('.png') ? 'image/png' : 'image/jpeg',
      );
      thumbnailUrl = thumbnailResult.url;
    }

    // Create the LoRA model record with status='ready'
    const loraModel = await this.supabase.createLoraModel({
      name: dto.name,
      trigger_word: dto.triggerWord,
      training_images_url: null, // No training images for manual upload
      training_steps: 0, // Not applicable
      status: 'ready',
      // Set both lora_url and weights_url for compatibility
      lora_url: weightsUrl,
      weights_url: weightsUrl,
      diffusers_lora_url: null,
      config_url: null, // No config for manually uploaded models
      thumbnail_url: thumbnailUrl,
      cost_cents: 0, // No cost for manual upload
      error_message: null,
      trainer: 'manual',
      learning_rate: null,
      is_style: false,
      progress: 100,
      status_message: 'Manually uploaded',
    });

    this.logger.log(`Manual LoRA model ${loraModel.id} uploaded successfully`);

    return loraModel;
  }

  async findAll(status?: string): Promise<DbLoraModel[]> {
    if (!this.supabase.isInitialized()) {
      return [];
    }
    return this.supabase.listLoraModels(status);
  }

  async findOne(id: string): Promise<DbLoraModel | null> {
    if (!this.supabase.isInitialized()) {
      return null;
    }
    return this.supabase.getLoraModel(id);
  }

  async updateStatus(
    id: string,
    status: DbLoraModel['status'],
    updates?: Partial<DbLoraModel>,
  ): Promise<DbLoraModel> {
    return this.supabase.updateLoraModel(id, {
      status,
      ...updates,
      ...(status === 'ready' || status === 'failed' ? { completed_at: new Date().toISOString() } : {}),
    });
  }

  async update(id: string, updates: { name?: string; trigger_word?: string; thumbnail_url?: string | null }): Promise<DbLoraModel> {
    this.checkInitialized();
    return this.supabase.updateLoraModel(id, updates);
  }

  async updateThumbnail(id: string, thumbnail: { buffer: Buffer; fileName: string }): Promise<DbLoraModel> {
    this.checkInitialized();
    this.logger.log(`Updating thumbnail for LoRA model: ${id}`);

    const model = await this.supabase.getLoraModel(id);
    if (!model) {
      throw new Error('LoRA model not found');
    }

    // Upload thumbnail to Supabase storage
    const ext = thumbnail.fileName.split('.').pop() || 'jpg';
    const thumbnailPath = `${id}/thumbnail.${ext}`;
    const { url: thumbnailUrl } = await this.supabase.uploadFile(
      'lora-weights',
      thumbnailPath,
      thumbnail.buffer,
      thumbnail.fileName.endsWith('.png') ? 'image/png' : 'image/jpeg',
    );

    // Update the model with new thumbnail URL
    return this.supabase.updateLoraModel(id, { thumbnail_url: thumbnailUrl });
  }

  async importFromUrl(dto: ImportLoraDto): Promise<DbLoraModel> {
    this.checkInitialized();
    this.logger.log(`Importing LoRA from URL: ${dto.name}`);

    // Validate URL is accessible (optional HEAD request)
    try {
      const response = await fetch(dto.weightsUrl, { method: 'HEAD' });
      if (!response.ok) {
        throw new Error(`URL not accessible: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('URL not accessible')) {
        throw error;
      }
      // If HEAD fails (some servers don't support it), try anyway
      this.logger.warn(`HEAD request failed, proceeding anyway: ${error}`);
    }

    // Create the LoRA model record with status='ready' (no training needed)
    const loraModel = await this.supabase.createLoraModel({
      name: dto.name,
      trigger_word: dto.triggerWord,
      training_images_url: null, // No training images for imported
      training_steps: 0, // Not applicable
      status: 'ready',
      // Set both lora_url and weights_url for compatibility
      lora_url: dto.weightsUrl,
      weights_url: dto.weightsUrl,
      diffusers_lora_url: null,
      config_url: null, // Imported LoRAs may not have config
      thumbnail_url: dto.thumbnailUrl || null,
      cost_cents: 0, // No cost for imported
      error_message: null,
      trainer: 'imported',
      learning_rate: null,
      is_style: false,
      progress: 100,
      status_message: 'Imported from URL',
    });

    this.logger.log(`Imported LoRA model ${loraModel.id} successfully`);

    return loraModel;
  }

  /**
   * Force delete a stuck LoRA model (training/pending status)
   */
  async forceDelete(id: string): Promise<void> {
    this.checkInitialized();
    const model = await this.supabase.getLoraModel(id);
    if (!model) {
      throw new Error('LoRA model not found');
    }

    this.logger.log(`Force deleting LoRA model ${id} (status: ${model.status})`);

    // Delete associated files from storage if they exist
    if (model.weights_url) {
      try {
        const weightsPath = this.extractPathFromUrl(model.weights_url);
        if (weightsPath) {
          await this.supabase.deleteFile('lora-weights', weightsPath);
        }
      } catch (error) {
        this.logger.warn(`Failed to delete weights file: ${error}`);
      }
    }

    // Delete from database
    await this.supabase.getClient()
      .from('lora_models')
      .delete()
      .eq('id', id);

    this.logger.log(`Force deleted LoRA model ${id}`);
  }

  /**
   * Clean up all stuck LoRA models (training/pending for too long)
   */
  async cleanupStuck(maxAgeMinutes = 60): Promise<{ deleted: number; ids: string[] }> {
    this.checkInitialized();

    // Get all stuck models
    const stuckModels = await this.supabase.getClient()
      .from('lora_models')
      .select('id, name, status, created_at')
      .in('status', ['training', 'pending']);

    if (stuckModels.error) {
      throw new Error(`Failed to query stuck models: ${stuckModels.error.message}`);
    }

    const cutoffTime = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
    const modelsToDelete = (stuckModels.data || []).filter((m) => {
      const createdAt = new Date(m.created_at);
      return createdAt < cutoffTime;
    });

    this.logger.log(`Found ${modelsToDelete.length} stuck LoRA models to clean up`);

    const deletedIds: string[] = [];
    for (const model of modelsToDelete) {
      try {
        await this.forceDelete(model.id);
        deletedIds.push(model.id);
      } catch (error) {
        this.logger.error(`Failed to delete stuck model ${model.id}: ${error}`);
      }
    }

    return { deleted: deletedIds.length, ids: deletedIds };
  }

  /**
   * Cancel a training LoRA model
   */
  async cancel(id: string): Promise<DbLoraModel> {
    this.checkInitialized();
    const model = await this.supabase.getLoraModel(id);
    if (!model) {
      throw new Error('LoRA model not found');
    }

    // Only allow cancellation of pending/training models
    if (!['pending', 'training'].includes(model.status)) {
      throw new Error(`Cannot cancel model with status: ${model.status}`);
    }

    this.logger.log(`Cancelling LoRA training for model ${id}`);

    // Find and cancel the associated job
    const { data: jobs } = await this.supabase.getClient()
      .from('jobs')
      .select('id')
      .eq('type', 'lora_training')
      .eq('reference_id', id)
      .in('status', ['pending', 'queued', 'processing'])
      .limit(1);

    if (jobs && jobs.length > 0) {
      await this.supabase.updateJob(jobs[0].id, {
        status: 'failed',
        error_message: 'Cancelled by user',
        completed_at: new Date().toISOString(),
      });
    }

    // Update model status
    return this.supabase.updateLoraModel(id, {
      status: 'failed',
      error_message: 'Cancelled by user',
      status_message: 'Training cancelled',
      completed_at: new Date().toISOString(),
    });
  }

  /**
   * Retry a failed LoRA training
   */
  async retry(id: string): Promise<DbLoraModel> {
    this.checkInitialized();
    const model = await this.supabase.getLoraModel(id);
    if (!model) {
      throw new Error('LoRA model not found');
    }

    // Only allow retry of failed models
    if (model.status !== 'failed') {
      throw new Error(`Cannot retry model with status: ${model.status}`);
    }

    if (!model.training_images_url) {
      throw new Error('Cannot retry: training images URL not found');
    }

    this.logger.log(`Retrying LoRA training for model ${id}`);

    // Reset model status
    await this.supabase.updateLoraModel(id, {
      status: 'pending',
      error_message: null,
      lora_url: null,
      weights_url: null,
      diffusers_lora_url: null,
      config_url: null,
      progress: 0,
      status_message: 'Retrying - waiting in queue',
      completed_at: null,
    });

    // Create a new job
    const job = await this.jobsService.createAndEnqueueJob('lora_training', id, {
      loraModelId: id,
      imagesZipUrl: model.training_images_url,
      triggerWord: model.trigger_word,
      steps: model.training_steps || 1000,
      learningRate: model.learning_rate || 0.0007,
      isStyle: model.is_style || false,
      useFaceDetection: true,
      useFaceCropping: false,
      useMasks: true,
    });

    this.logger.log(`LoRA model ${id} queued for retry (job: ${job.id})`);

    return this.supabase.getLoraModel(id) as Promise<DbLoraModel>;
  }

  async delete(id: string): Promise<void> {
    this.checkInitialized();
    const model = await this.supabase.getLoraModel(id);
    if (!model) {
      throw new Error('LoRA model not found');
    }

    // Only allow deletion of completed or failed models
    if (model.status === 'training' || model.status === 'pending') {
      throw new Error('Cannot delete a model that is still training. Use force delete instead.');
    }

    // Delete associated files from storage if they exist
    if (model.weights_url) {
      try {
        const weightsPath = this.extractPathFromUrl(model.weights_url);
        if (weightsPath) {
          await this.supabase.deleteFile('lora-weights', weightsPath);
        }
      } catch (error) {
        this.logger.warn(`Failed to delete weights file: ${error}`);
      }
    }

    // Delete from database (soft delete would be better in production)
    await this.supabase.getClient()
      .from('lora_models')
      .delete()
      .eq('id', id);
  }

  private extractPathFromUrl(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      // Assuming format: /storage/v1/object/public/bucket-name/path
      const bucketIndex = pathParts.indexOf('public');
      if (bucketIndex >= 0 && bucketIndex + 2 < pathParts.length) {
        return pathParts.slice(bucketIndex + 2).join('/');
      }
      return null;
    } catch {
      return null;
    }
  }
}
