import { Injectable, Logger } from '@nestjs/common';
import { DatasetAnalysisResult } from './dataset-analysis.service';

// ============================================
// INTERFACES
// ============================================

export interface OptimizedParameters {
  steps: number;
  learningRate: number;
  useFaceDetection: boolean;
  useFaceCropping: boolean;
  useMasks: boolean;
  includeSyntheticCaptions: boolean;
  confidence: number;
  reasoning: string[];
  originalParams?: {
    steps: number;
    learningRate: number;
  };
}

export interface OptimizerInput {
  // User's requested parameters (optional - will use defaults if not provided)
  userParams?: {
    steps?: number;
    learningRate?: number;
    isStyle?: boolean;
  };
  // Dataset analysis results
  analysis: DatasetAnalysisResult;
}

// ============================================
// SERVICE
// ============================================

@Injectable()
export class TrainingOptimizerService {
  private readonly logger = new Logger(TrainingOptimizerService.name);

  // Default base parameters
  private readonly BASE_STEPS = 1000;
  private readonly BASE_LEARNING_RATE = 0.0007;

  // Valid ranges (matching fal.ai WAN 2.2)
  private readonly MIN_STEPS = 100;
  private readonly MAX_STEPS = 6000;
  private readonly MIN_LR = 0.00001;
  private readonly MAX_LR = 0.01;

  /**
   * Optimize training parameters based on dataset analysis
   * Applies rules to adjust steps and learning rate for best results
   */
  optimize(input: OptimizerInput): OptimizedParameters {
    const { userParams, analysis } = input;
    const isStyle = userParams?.isStyle ?? false;

    let steps = userParams?.steps ?? this.BASE_STEPS;
    let learningRate = userParams?.learningRate ?? this.BASE_LEARNING_RATE;
    const reasoning: string[] = [];

    const validImages = analysis.images.filter(img => img.is_valid).length;
    const avgQuality = analysis.aggregates.averageQuality;
    const angleVariety = this.calculateAngleVariety(analysis.aggregates.angleDistribution);
    const lightingConsistency = analysis.aggregates.lightingConsistency;

    this.logger.log(`Optimizing parameters for ${validImages} images (avg quality: ${(avgQuality * 100).toFixed(0)}%)`);

    // ============================================
    // IMAGE COUNT ADJUSTMENTS
    // ============================================

    if (validImages < 10) {
      // Few images: need more steps to learn, lower LR to avoid overfitting
      const multiplier = 1.5;
      steps = Math.round(steps * multiplier);
      learningRate = Math.min(learningRate, 0.0003);
      reasoning.push(`Few images (${validImages}): increased steps by ${((multiplier - 1) * 100).toFixed(0)}%, reduced LR to prevent overfitting`);
    } else if (validImages >= 10 && validImages < 20) {
      // Moderate images: slight increase in steps
      const multiplier = 1.2;
      steps = Math.round(steps * multiplier);
      reasoning.push(`Moderate image count (${validImages}): increased steps by ${((multiplier - 1) * 100).toFixed(0)}%`);
    } else if (validImages >= 50 && validImages < 100) {
      // Many images: can reduce steps, increase LR
      const multiplier = 0.8;
      steps = Math.round(steps * multiplier);
      learningRate = Math.min(learningRate * 1.3, 0.001);
      reasoning.push(`Many images (${validImages}): reduced steps by ${((1 - multiplier) * 100).toFixed(0)}%, can learn faster`);
    } else if (validImages >= 100) {
      // Lots of images: significant reduction
      const multiplier = 0.6;
      steps = Math.round(steps * multiplier);
      learningRate = Math.min(learningRate * 1.5, 0.001);
      reasoning.push(`Large dataset (${validImages}): reduced steps by ${((1 - multiplier) * 100).toFixed(0)}%`);
    }

    // ============================================
    // QUALITY ADJUSTMENTS
    // ============================================

    if (avgQuality < 0.5) {
      // Low quality: need more steps, lower LR for stability
      const multiplier = 1.3;
      steps = Math.round(steps * multiplier);
      learningRate = Math.min(learningRate, 0.0005);
      reasoning.push(`Low avg quality (${(avgQuality * 100).toFixed(0)}%): increased steps, reduced LR for stability`);
    } else if (avgQuality > 0.8 && angleVariety > 0.6) {
      // High quality + good variety: can train faster
      const multiplier = 0.85;
      steps = Math.round(steps * multiplier);
      reasoning.push(`High quality + good variety: reduced steps by ${((1 - multiplier) * 100).toFixed(0)}%`);
    }

    // ============================================
    // CONSISTENCY ADJUSTMENTS
    // ============================================

    if (lightingConsistency < 0.5) {
      // Inconsistent lighting: need more steps to learn through variation
      const multiplier = 1.2;
      steps = Math.round(steps * multiplier);
      reasoning.push(`Inconsistent lighting: increased steps to handle variation`);
    }

    if (analysis.aggregates.qualityVariance > 0.25) {
      // High variance: need lower LR for stability
      learningRate = Math.min(learningRate, 0.0005);
      reasoning.push(`High quality variance: reduced LR for training stability`);
    }

    // ============================================
    // STYLE VS CHARACTER ADJUSTMENTS
    // ============================================

    if (isStyle) {
      // Style training generally benefits from more steps and higher LR
      steps = Math.round(steps * 1.2);
      learningRate = Math.min(learningRate * 1.3, 0.001);
      reasoning.push(`Style training: increased steps and LR for style capture`);
    }

    // ============================================
    // CLAMP TO VALID RANGES
    // ============================================

    steps = Math.max(this.MIN_STEPS, Math.min(this.MAX_STEPS, steps));
    learningRate = Math.max(this.MIN_LR, Math.min(this.MAX_LR, learningRate));

    // ============================================
    // DETERMINE CONFIDENCE
    // ============================================

    let confidence = 0.8;
    if (analysis.datasetQuality === 'excellent' || analysis.datasetQuality === 'good') {
      confidence = 0.9;
    } else if (analysis.datasetQuality === 'needs_work' || analysis.datasetQuality === 'insufficient') {
      confidence = 0.6;
    }

    // ============================================
    // FACE DETECTION OPTIONS
    // ============================================

    const useFaceDetection = !isStyle; // Always for character, never for style
    const useFaceCropping = validImages < 15; // Use cropping when few images
    const useMasks = !isStyle; // Masking helps character training
    const includeSyntheticCaptions = validImages < 20; // Helps with small datasets

    this.logger.log(`Optimized: steps=${steps}, LR=${learningRate.toFixed(6)}, confidence=${(confidence * 100).toFixed(0)}%`);

    return {
      steps,
      learningRate,
      useFaceDetection,
      useFaceCropping,
      useMasks,
      includeSyntheticCaptions,
      confidence,
      reasoning,
      originalParams: userParams ? {
        steps: userParams.steps ?? this.BASE_STEPS,
        learningRate: userParams.learningRate ?? this.BASE_LEARNING_RATE,
      } : undefined,
    };
  }

  /**
   * Get recommended parameters without full analysis
   * For quick estimation based on image count only
   */
  getQuickRecommendation(imageCount: number, isStyle: boolean = false): {
    recommendedSteps: number;
    recommendedLR: number;
    warning?: string;
  } {
    let steps = this.BASE_STEPS;
    let lr = this.BASE_LEARNING_RATE;
    let warning: string | undefined;

    if (imageCount < 5) {
      steps = 1500;
      lr = 0.0003;
      warning = 'Very few images - consider adding more for better results';
    } else if (imageCount < 10) {
      steps = 1200;
      lr = 0.0005;
    } else if (imageCount >= 50) {
      steps = 800;
      lr = 0.001;
    } else if (imageCount >= 100) {
      steps = 600;
      lr = 0.001;
    }

    if (isStyle) {
      steps = Math.round(steps * 1.2);
      lr = Math.min(lr * 1.3, 0.001);
    }

    return {
      recommendedSteps: steps,
      recommendedLR: lr,
      warning,
    };
  }

  /**
   * Calculate how varied the angles are in the dataset
   */
  private calculateAngleVariety(distribution: Record<string, number>): number {
    const total = Object.values(distribution).reduce((a, b) => a + b, 0);
    if (total === 0) return 0;

    // Calculate how evenly distributed the angles are
    const categories = Object.keys(distribution).length;
    const idealPerCategory = total / categories;

    let variance = 0;
    for (const count of Object.values(distribution)) {
      variance += Math.pow(count - idealPerCategory, 2);
    }
    variance = Math.sqrt(variance / categories);

    // Convert to 0-1 score (lower variance = higher variety)
    const maxVariance = total; // Worst case: all in one category
    const variety = 1 - Math.min(variance / maxVariance, 1);

    return variety;
  }
}
