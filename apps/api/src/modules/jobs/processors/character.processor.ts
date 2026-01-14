import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queues.constants';
import { JobsService } from '../jobs.service';
import { GeminiService } from '../../../services/gemini.service';
import { SupabaseService } from '../../files/supabase.service';
import { IdentityAnalysisService, AggregatedProfile } from '../../../services/identity-analysis.service';
import { PromptBuilderService } from '../../../services/prompt-builder.service';

interface PhotoJobData {
  jobId: string;
  diagramId: string;
  sourceImageUrl: string;
  // Multi-image support
  allImageUrls?: string[];
  imageTypes?: Record<number, string>;
  name: string;
  clothingOption?: 'original' | 'minimal';
  // Analysis options
  enableAnalysis?: boolean;
  enableValidation?: boolean;
}

interface ProcessingResult {
  fileUrl: string;
  mimeType: string;
  profileId?: string;
  validationScore?: number;
  attempts?: number;
}

@Processor(QUEUES.CHARACTER_DIAGRAM)
export class CharacterProcessor extends WorkerHost {
  private readonly logger = new Logger(CharacterProcessor.name);

  // Configuration
  private readonly MAX_VALIDATION_ATTEMPTS = 3;
  private readonly VALIDATION_THRESHOLD = 0.85;

  constructor(
    private readonly jobsService: JobsService,
    private readonly geminiService: GeminiService,
    private readonly supabase: SupabaseService,
    private readonly identityAnalysis: IdentityAnalysisService,
    private readonly promptBuilder: PromptBuilderService,
  ) {
    super();
  }

  async process(job: Job<PhotoJobData>): Promise<void> {
    // Validate job data before processing
    if (!job.data?.jobId || !job.data?.diagramId) {
      this.logger.warn(`Skipping job with invalid data: ${JSON.stringify(job.data)}`);
      return;
    }

    // Use enhanced processing if multiple images provided
    const hasMultipleImages = job.data.allImageUrls && job.data.allImageUrls.length > 1;
    const useEnhancedProcessing = hasMultipleImages || job.data.enableAnalysis;

    if (useEnhancedProcessing) {
      return this.processWithIdentityProfile(job);
    }

    // Fall back to simple processing for single image
    return this.processFromPhoto(job);
  }

  /**
   * Enhanced processing with identity profile analysis and validation loop
   * Uses all available images for better consistency
   */
  private async processWithIdentityProfile(job: Job<PhotoJobData>): Promise<void> {
    const {
      jobId,
      diagramId,
      sourceImageUrl,
      allImageUrls = [sourceImageUrl],
      imageTypes = {},
      clothingOption = 'original',
      enableValidation = false,
    } = job.data;

    let profileId: string | undefined;
    let totalCostCents = 0;

    try {
      await this.jobsService.markJobProcessing(jobId);
      await this.supabase.updateCharacterDiagram(diagramId, { status: 'processing' });

      this.logger.log(`[${jobId}] Starting enhanced character diagram processing`, {
        diagramId,
        imageCount: allImageUrls.length,
        clothingOption,
        enableValidation,
      });

      // Step 1: Analyze images and create identity profile
      this.logger.log(`[${jobId}] Analyzing ${allImageUrls.length} images...`);
      const profile = await this.analyzeAndCreateProfile(
        diagramId,
        allImageUrls,
        imageTypes,
      );
      profileId = profile?.id;

      // Analysis cost: ~$0.01 per image
      const analysisCost = allImageUrls.length * 1;
      totalCostCents += analysisCost;
      this.logger.log(`[${jobId}] Profile created (cost: $${(analysisCost / 100).toFixed(2)})`);

      // Step 2: Build identity-constrained prompt
      const aggregatedProfile = profile?.aggregatedProfile || null;
      const builtPrompt = this.promptBuilder.buildIdentityPrompt({
        generationType: 'character_diagram',
        profile: aggregatedProfile,
        targetClothing: clothingOption,
        referenceImageCount: allImageUrls.length,
      });

      // Step 3: Score and weight images for generation
      const scoredImages = this.scoreImages(allImageUrls, imageTypes, aggregatedProfile);

      // Step 4: Generate with validation loop
      let result: ProcessingResult | null = null;
      let attempt = 0;
      let lastValidation: { regenerationHints: string[] } | null = null;

      while (attempt < this.MAX_VALIDATION_ATTEMPTS && !result) {
        attempt++;
        this.logger.log(`[${jobId}] Generation attempt ${attempt}/${this.MAX_VALIDATION_ATTEMPTS}`);

        // Add regeneration hints if we have validation feedback
        let enhancedPrompt = builtPrompt.fullPrompt;
        if (lastValidation?.regenerationHints?.length) {
          enhancedPrompt += '\n\nCRITICAL CORRECTIONS:\n' +
            lastValidation.regenerationHints.map(h => `- ${h}`).join('\n');
        }

        // Generate using multi-reference method
        const generationResult = await this.geminiService.generateWithMultipleReferences(
          scoredImages,
          enhancedPrompt,
          '5:4', // Character diagram aspect ratio
          '1K',
        );

        // Generation cost: ~$0.02 per generation
        totalCostCents += 2;

        // Convert and upload result
        const imageBuffer = Buffer.from(generationResult.imageBase64, 'base64');
        const ext = generationResult.mimeType.includes('png') ? 'png' : 'jpg';
        const filePath = `${diagramId}/diagram${attempt > 1 ? `_v${attempt}` : ''}.${ext}`;
        const { url: fileUrl } = await this.supabase.uploadFile(
          'character-images',
          filePath,
          imageBuffer,
          generationResult.mimeType,
        );

        // Validate output if enabled and we have a profile
        if (enableValidation && aggregatedProfile) {
          this.logger.log(`[${jobId}] Validating output against profile...`);
          const validation = await this.identityAnalysis.validateOutput(
            fileUrl,
            aggregatedProfile,
            this.VALIDATION_THRESHOLD,
          );

          // Validation cost: ~$0.01 per check
          totalCostCents += 1;

          this.logger.log(`[${jobId}] Validation score: ${(validation.overallScore * 100).toFixed(1)}%`);

          if (validation.isValid) {
            result = {
              fileUrl,
              mimeType: generationResult.mimeType,
              profileId,
              validationScore: validation.overallScore,
              attempts: attempt,
            };
          } else if (attempt < this.MAX_VALIDATION_ATTEMPTS) {
            lastValidation = validation;
            this.logger.log(`[${jobId}] Below threshold, will retry with hints: ${validation.regenerationHints.join(', ')}`);
          } else {
            // Use best attempt even if validation failed
            this.logger.warn(`[${jobId}] Max attempts reached, using last result`);
            result = {
              fileUrl,
              mimeType: generationResult.mimeType,
              profileId,
              validationScore: validation.overallScore,
              attempts: attempt,
            };
          }
        } else {
          // No validation requested, accept first result
          result = {
            fileUrl,
            mimeType: generationResult.mimeType,
            profileId,
            attempts: attempt,
          };
        }
      }

      if (!result) {
        throw new Error('Failed to generate character diagram after all attempts');
      }

      // Update character diagram with result
      await this.supabase.updateCharacterDiagram(diagramId, {
        status: 'ready',
        file_url: result.fileUrl,
        cost_cents: totalCostCents,
      });

      // Link identity profile if created
      if (profileId) {
        await this.supabase.updateIdentityProfile(profileId, {
          character_diagram_id: diagramId,
        });
      }

      // Mark job as completed
      await this.jobsService.markJobCompleted(
        jobId,
        {
          fileUrl: result.fileUrl,
          mimeType: result.mimeType,
          profileId: result.profileId,
          validationScore: result.validationScore,
          attempts: result.attempts,
          imagesAnalyzed: allImageUrls.length,
        },
        totalCostCents,
      );

      this.logger.log(`[${jobId}] Character diagram completed (total cost: $${(totalCostCents / 100).toFixed(2)}, attempts: ${result.attempts})`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[${jobId}] Failed: ${errorMessage}`);

      if (diagramId) {
        await this.supabase.updateCharacterDiagram(diagramId, {
          status: 'failed',
          error_message: errorMessage,
          cost_cents: totalCostCents,
        });
      }

      if (jobId) {
        await this.jobsService.markJobFailed(jobId, errorMessage);
      }
      throw error;
    }
  }

  /**
   * Analyze images and create an identity profile
   */
  private async analyzeAndCreateProfile(
    diagramId: string,
    imageUrls: string[],
    imageTypes: Record<number, string>,
  ): Promise<{ id: string; aggregatedProfile: AggregatedProfile } | null> {
    try {
      // Create analysis session
      const session = await this.supabase.createAnalysisSession({
        character_diagram_id: diagramId,
        reference_kit_id: null,
        name: `Auto-analysis for ${diagramId}`,
        status: 'processing',
        total_images: imageUrls.length,
        processed_images: 0,
        valid_images: 0,
        progress: 0,
        analysis_mode: 'standard',
        cost_limit_cents: 2000,
        error_message: null,
        total_cost_cents: 0,
      });

      // Analyze all images
      const analyses = await this.identityAnalysis.analyzeImages(
        imageUrls,
        {
          maxConcurrency: 3,
          qualityThreshold: 0.4,
          onProgress: async (completed, total) => {
            await this.supabase.updateAnalysisSession(session.id, {
              processed_images: completed,
              progress: Math.round((completed / total) * 100),
            });
          },
        },
      );

      // Store individual analyses (cast to Record<string, unknown> for JSONB compatibility)
      const analysisRecords = analyses.map((a) => ({
        session_id: session.id,
        image_url: a.image_url,
        quality_score: a.quality_scores.overall,
        blur_score: a.quality_scores.blur,
        lighting_score: a.quality_scores.lighting,
        resolution_score: a.quality_scores.resolution,
        face_visibility_score: a.quality_scores.face_visibility,
        is_valid: a.is_valid,
        rejection_reason: a.rejection_reason || null,
        face_geometry: a.face_geometry as Record<string, unknown> | null,
        face_geometry_confidence: a.face_geometry_confidence,
        body_proportions: a.body_proportions as Record<string, unknown> | null,
        body_proportions_confidence: a.body_proportions_confidence,
        lighting_profile: a.lighting_profile as Record<string, unknown> | null,
        lighting_confidence: a.lighting_confidence,
        camera_parameters: a.camera_parameters as Record<string, unknown> | null,
        camera_confidence: a.camera_confidence,
        style_fingerprint: a.style_fingerprint as Record<string, unknown> | null,
        style_confidence: a.style_confidence,
        expression_data: a.expression_data as Record<string, unknown> | null,
        processing_time_ms: null,
        api_cost_cents: a.api_cost_cents,
        image_hash: null,
      }));

      await this.supabase.createImageAnalysesBatch(analysisRecords);

      // Aggregate into profile
      const validAnalyses = analyses.filter(a => a.is_valid);
      if (validAnalyses.length === 0) {
        this.logger.warn('No valid images found for profile creation');
        await this.supabase.updateAnalysisSession(session.id, {
          status: 'failed',
          error_message: 'No valid images',
        });
        return null;
      }

      const aggregatedProfile = this.identityAnalysis.aggregateProfiles(validAnalyses);

      // Create identity profile
      const totalCost = analyses.reduce((sum, a) => sum + a.api_cost_cents, 0);
      const profile = await this.supabase.createIdentityProfile({
        session_id: session.id,
        character_diagram_id: diagramId,
        reference_kit_id: null,
        face_geometry_profile: aggregatedProfile.face_geometry_profile,
        face_sample_count: validAnalyses.filter(a => a.face_geometry).length,
        body_proportions_profile: aggregatedProfile.body_proportions_profile,
        body_sample_count: validAnalyses.filter(a => a.body_proportions).length,
        lighting_profile: aggregatedProfile.lighting_profile,
        lighting_sample_count: validAnalyses.filter(a => a.lighting_profile).length,
        camera_profile: aggregatedProfile.camera_profile,
        camera_sample_count: validAnalyses.filter(a => a.camera_parameters).length,
        style_fingerprint: aggregatedProfile.style_fingerprint,
        style_sample_count: validAnalyses.filter(a => a.style_fingerprint).length,
        overall_confidence: aggregatedProfile.overall_confidence,
        data_consistency_score: aggregatedProfile.data_consistency_score,
        best_reference_image_url: aggregatedProfile.best_reference_image_url,
        image_quality_ranking: aggregatedProfile.image_quality_ranking,
        analysis_model: 'gemini-2.0-flash',
        analysis_version: '1.0',
        total_cost_cents: totalCost,
      });

      // Update session as complete
      await this.supabase.updateAnalysisSession(session.id, {
        status: 'ready',
        valid_images: validAnalyses.length,
        progress: 100,
        total_cost_cents: totalCost,
        completed_at: new Date().toISOString(),
      });

      return { id: profile.id, aggregatedProfile };
    } catch (error) {
      this.logger.error(`Profile creation failed: ${error}`);
      return null;
    }
  }

  /**
   * Score and weight images for multi-reference generation
   */
  private scoreImages(
    imageUrls: string[],
    imageTypes: Record<number, string>,
    profile: AggregatedProfile | null,
  ): Array<{ url: string; type: string; qualityScore: number; weight: number }> {
    // If we have a profile, use the quality ranking
    if (profile?.image_quality_ranking) {
      const ranking = new Map(
        profile.image_quality_ranking.map(r => [r.url, r.score])
      );

      return imageUrls.map((url, i) => {
        const type = imageTypes[i] || 'reference';
        const qualityScore = ranking.get(url) || 0.5;

        // Weight by image type
        let weight = 1.0;
        if (type === 'primary' || type === 'front') weight = 1.5;
        else if (type === 'profile' || type === '3/4 angle') weight = 1.2;
        else if (type === 'full_body') weight = 1.1;

        return { url, type, qualityScore, weight };
      });
    }

    // Fallback: equal scoring with type-based weighting
    return imageUrls.map((url, i) => {
      const type = imageTypes[i] || 'reference';
      let weight = 1.0;
      if (type === 'primary') weight = 1.5;
      else if (type === 'front') weight = 1.3;

      return { url, type, qualityScore: 0.7, weight };
    });
  }

  /**
   * Simple processing for single image (fallback)
   */
  private async processFromPhoto(job: Job<PhotoJobData>): Promise<void> {
    const { jobId, diagramId, sourceImageUrl, clothingOption = 'original' } = job.data;

    try {
      await this.jobsService.markJobProcessing(jobId);
      await this.supabase.updateCharacterDiagram(diagramId, { status: 'processing' });

      this.logger.log(`[${jobId}] Processing character diagram from single photo`, {
        diagramId,
        sourceImageUrl,
        clothingOption,
      });

      // Generate character diagram using Google Gemini
      const result = await this.geminiService.generateCharacterDiagram(sourceImageUrl, clothingOption);

      this.logger.log(`[${jobId}] Character diagram generated`);

      // Convert base64 to buffer
      const imageBuffer = Buffer.from(result.imageBase64, 'base64');

      // Upload to Supabase storage
      const filePath = `${diagramId}/diagram.${result.mimeType.includes('png') ? 'png' : 'jpg'}`;
      const { url: fileUrl } = await this.supabase.uploadFile(
        'character-images',
        filePath,
        imageBuffer,
        result.mimeType,
      );

      // Update character diagram with result
      const costCents = 2;
      await this.supabase.updateCharacterDiagram(diagramId, {
        status: 'ready',
        file_url: fileUrl,
        cost_cents: costCents,
      });

      // Mark job as completed
      await this.jobsService.markJobCompleted(
        jobId,
        {
          fileUrl,
          mimeType: result.mimeType,
        },
        costCents,
      );

      this.logger.log(`[${jobId}] Character diagram job completed successfully`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[${jobId}] Failed: ${errorMessage}`);

      if (diagramId) {
        await this.supabase.updateCharacterDiagram(diagramId, {
          status: 'failed',
          error_message: errorMessage,
        });
      }

      if (jobId) {
        await this.jobsService.markJobFailed(jobId, errorMessage);
      }
      throw error;
    }
  }
}
