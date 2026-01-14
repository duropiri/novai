import { Injectable, Logger } from '@nestjs/common';
import { IdentityAnalysisService, ImageAnalysisResult } from './identity-analysis.service';

// ============================================
// INTERFACES
// ============================================

export interface DatasetGap {
  type: 'angle' | 'expression' | 'lighting' | 'quantity' | 'quality';
  description: string;
  severity: 'low' | 'medium' | 'high';
  suggestedFix: string;
}

export interface DatasetRecommendation {
  action: 'remove_image' | 'add_angle' | 'add_expression' | 'improve_lighting' | 'increase_quantity';
  imageIndices?: number[];
  details: string;
  priority: number; // 1-10
}

export interface DatasetAnalysisResult {
  // Individual image results
  images: ImageAnalysisResult[];

  // Aggregate metrics
  aggregates: {
    averageQuality: number;
    qualityVariance: number;
    angleDistribution: Record<string, number>;
    expressionDistribution: Record<string, number>;
    lightingConsistency: number;
    identityConsistency: number;
  };

  // Gaps and recommendations
  datasetGaps: DatasetGap[];
  recommendations: DatasetRecommendation[];

  // Final verdict
  datasetQuality: 'excellent' | 'good' | 'acceptable' | 'needs_work' | 'insufficient';
  estimatedTrainingSuccess: number; // 0-100
  totalCost: number;
}

export interface AnalysisConfig {
  mode: 'quick' | 'standard' | 'comprehensive';
  maxImages: number;
  qualityThreshold: number;
  costLimitCents: number;
}

// ============================================
// SERVICE
// ============================================

@Injectable()
export class DatasetAnalysisService {
  private readonly logger = new Logger(DatasetAnalysisService.name);

  private readonly ANALYSIS_PRESETS: Record<string, AnalysisConfig> = {
    quick: {
      mode: 'quick',
      maxImages: 50,
      qualityThreshold: 0.7,
      costLimitCents: 200,
    },
    standard: {
      mode: 'standard',
      maxImages: 500,
      qualityThreshold: 0.5,
      costLimitCents: 2000,
    },
    comprehensive: {
      mode: 'comprehensive',
      maxImages: 5000,
      qualityThreshold: 0.3,
      costLimitCents: 20000,
    },
  };

  constructor(
    private readonly identityAnalysis: IdentityAnalysisService,
  ) {}

  /**
   * Analyze a training dataset before LoRA training
   * Returns quality scores, gaps, and recommendations
   */
  async analyzeDataset(
    imageUrls: string[],
    mode: 'quick' | 'standard' | 'comprehensive' = 'standard',
    onProgress?: (completed: number, total: number) => void,
  ): Promise<DatasetAnalysisResult> {
    const config = this.ANALYSIS_PRESETS[mode];
    const imagesToAnalyze = imageUrls.slice(0, config.maxImages);

    this.logger.log(`Analyzing dataset: ${imagesToAnalyze.length} images (mode: ${mode})`);

    // Analyze all images
    const analyses = await this.identityAnalysis.analyzeImages(
      imagesToAnalyze,
      {
        maxConcurrency: mode === 'quick' ? 5 : 3,
        qualityThreshold: config.qualityThreshold,
        onProgress,
      },
    );

    // Calculate aggregates
    const aggregates = this.calculateAggregates(analyses);

    // Identify gaps
    const gaps = this.identifyGaps(analyses, aggregates);

    // Generate recommendations
    const recommendations = this.generateRecommendations(analyses, gaps);

    // Determine overall quality
    const { quality, successEstimate } = this.determineQuality(aggregates, gaps);

    // Calculate total cost
    const totalCost = analyses.reduce((sum, a) => sum + a.api_cost_cents, 0);

    return {
      images: analyses,
      aggregates,
      datasetGaps: gaps,
      recommendations,
      datasetQuality: quality,
      estimatedTrainingSuccess: successEstimate,
      totalCost,
    };
  }

  /**
   * Quick quality check without full analysis
   * Returns basic quality metrics for fast feedback
   */
  async quickCheck(imageUrls: string[]): Promise<{
    totalImages: number;
    estimatedValidImages: number;
    suggestedMode: 'quick' | 'standard' | 'comprehensive';
    warnings: string[];
  }> {
    const warnings: string[] = [];

    // Sample analysis (just first 5 images)
    const sampleUrls = imageUrls.slice(0, Math.min(5, imageUrls.length));
    const sampleAnalyses = await this.identityAnalysis.analyzeImages(sampleUrls, {
      maxConcurrency: 5,
      qualityThreshold: 0.3,
    });

    const validCount = sampleAnalyses.filter(a => a.is_valid).length;
    const validRatio = validCount / sampleAnalyses.length;
    const estimatedValidImages = Math.round(imageUrls.length * validRatio);

    // Generate warnings
    if (imageUrls.length < 5) {
      warnings.push('Very few images provided. Consider adding more for better training.');
    }
    if (validRatio < 0.5) {
      warnings.push('Many images appear to be low quality. Consider filtering.');
    }

    // Suggest mode based on dataset size
    let suggestedMode: 'quick' | 'standard' | 'comprehensive' = 'standard';
    if (imageUrls.length <= 20) {
      suggestedMode = 'quick';
    } else if (imageUrls.length > 500) {
      suggestedMode = 'comprehensive';
    }

    return {
      totalImages: imageUrls.length,
      estimatedValidImages,
      suggestedMode,
      warnings,
    };
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private calculateAggregates(
    analyses: ImageAnalysisResult[],
  ): DatasetAnalysisResult['aggregates'] {
    const validAnalyses = analyses.filter(a => a.is_valid);

    // Quality metrics
    const qualityScores = validAnalyses.map(a => a.quality_scores.overall);
    const averageQuality = this.mean(qualityScores);
    const qualityVariance = this.std(qualityScores);

    // Angle distribution
    const angleDistribution: Record<string, number> = {
      front: 0,
      profile: 0,
      three_quarter: 0,
      other: 0,
    };
    for (const analysis of validAnalyses) {
      if (analysis.expression_data?.head_pose) {
        const yaw = Math.abs(analysis.expression_data.head_pose.yaw);
        if (yaw < 15) angleDistribution.front++;
        else if (yaw > 75) angleDistribution.profile++;
        else if (yaw >= 30 && yaw <= 60) angleDistribution.three_quarter++;
        else angleDistribution.other++;
      }
    }

    // Expression distribution
    const expressionDistribution: Record<string, number> = {
      neutral: 0,
      smiling: 0,
      serious: 0,
      other: 0,
    };
    for (const analysis of validAnalyses) {
      if (analysis.expression_data?.expression) {
        const expr = analysis.expression_data.expression;
        if (expr in expressionDistribution) {
          expressionDistribution[expr]++;
        } else {
          expressionDistribution.other++;
        }
      }
    }

    // Lighting consistency (how similar are lighting profiles)
    const lightingTypes = validAnalyses
      .filter(a => a.lighting_profile)
      .map(a => a.lighting_profile!.lighting_type);
    const lightingConsistency = this.modeConfidence(lightingTypes);

    // Identity consistency (face shape consistency)
    const faceShapes = validAnalyses
      .filter(a => a.face_geometry)
      .map(a => a.face_geometry!.face_shape);
    const identityConsistency = this.modeConfidence(faceShapes);

    return {
      averageQuality,
      qualityVariance,
      angleDistribution,
      expressionDistribution,
      lightingConsistency,
      identityConsistency,
    };
  }

  private identifyGaps(
    analyses: ImageAnalysisResult[],
    aggregates: DatasetAnalysisResult['aggregates'],
  ): DatasetGap[] {
    const gaps: DatasetGap[] = [];
    const validCount = analyses.filter(a => a.is_valid).length;

    // Check quantity
    if (validCount < 5) {
      gaps.push({
        type: 'quantity',
        description: `Only ${validCount} valid images`,
        severity: 'high',
        suggestedFix: 'Add more high-quality reference images (at least 10 recommended)',
      });
    } else if (validCount < 10) {
      gaps.push({
        type: 'quantity',
        description: `Only ${validCount} valid images`,
        severity: 'medium',
        suggestedFix: 'Consider adding more images for better training quality',
      });
    }

    // Check angle variety
    const { angleDistribution } = aggregates;
    const totalAngles = Object.values(angleDistribution).reduce((a, b) => a + b, 0);
    if (totalAngles > 0) {
      const frontRatio = angleDistribution.front / totalAngles;
      const profileRatio = angleDistribution.profile / totalAngles;
      const threeQuarterRatio = angleDistribution.three_quarter / totalAngles;

      if (frontRatio < 0.2) {
        gaps.push({
          type: 'angle',
          description: 'Missing front-facing images',
          severity: 'high',
          suggestedFix: 'Add front-facing (0 degree) reference images',
        });
      }
      if (profileRatio === 0 && threeQuarterRatio < 0.1) {
        gaps.push({
          type: 'angle',
          description: 'No profile or three-quarter angle images',
          severity: 'medium',
          suggestedFix: 'Add side angle images for better 3D understanding',
        });
      }
    }

    // Check expression variety
    const { expressionDistribution } = aggregates;
    const totalExpressions = Object.values(expressionDistribution).reduce((a, b) => a + b, 0);
    if (totalExpressions > 0) {
      const neutralRatio = expressionDistribution.neutral / totalExpressions;
      if (neutralRatio > 0.9) {
        gaps.push({
          type: 'expression',
          description: 'All images have neutral expression',
          severity: 'low',
          suggestedFix: 'Consider adding varied expressions for more versatile training',
        });
      }
    }

    // Check lighting consistency
    if (aggregates.lightingConsistency < 0.5) {
      gaps.push({
        type: 'lighting',
        description: 'Inconsistent lighting across images',
        severity: 'medium',
        suggestedFix: 'Try to use images with similar lighting conditions',
      });
    }

    // Check overall quality
    if (aggregates.averageQuality < 0.5) {
      gaps.push({
        type: 'quality',
        description: 'Low average image quality',
        severity: 'high',
        suggestedFix: 'Use higher resolution, sharper images with better lighting',
      });
    }

    // Check identity consistency
    if (aggregates.identityConsistency < 0.7) {
      gaps.push({
        type: 'quality',
        description: 'Possible identity inconsistency detected',
        severity: 'high',
        suggestedFix: 'Ensure all images are of the same person',
      });
    }

    return gaps;
  }

  private generateRecommendations(
    analyses: ImageAnalysisResult[],
    gaps: DatasetGap[],
  ): DatasetRecommendation[] {
    const recommendations: DatasetRecommendation[] = [];

    // Recommend removing low-quality images
    const lowQualityIndices = analyses
      .map((a, i) => ({ index: i, score: a.quality_scores.overall }))
      .filter(item => item.score < 0.4)
      .map(item => item.index);

    if (lowQualityIndices.length > 0) {
      recommendations.push({
        action: 'remove_image',
        imageIndices: lowQualityIndices,
        details: `${lowQualityIndices.length} images have quality below 40%`,
        priority: 8,
      });
    }

    // Recommendations based on gaps
    for (const gap of gaps) {
      if (gap.type === 'angle' && gap.severity === 'high') {
        recommendations.push({
          action: 'add_angle',
          details: gap.suggestedFix,
          priority: 9,
        });
      }
      if (gap.type === 'quantity' && gap.severity === 'high') {
        recommendations.push({
          action: 'increase_quantity',
          details: gap.suggestedFix,
          priority: 10,
        });
      }
      if (gap.type === 'lighting') {
        recommendations.push({
          action: 'improve_lighting',
          details: gap.suggestedFix,
          priority: 6,
        });
      }
    }

    // Sort by priority
    return recommendations.sort((a, b) => b.priority - a.priority);
  }

  private determineQuality(
    aggregates: DatasetAnalysisResult['aggregates'],
    gaps: DatasetGap[],
  ): { quality: DatasetAnalysisResult['datasetQuality']; successEstimate: number } {
    let score = 100;

    // Deduct for quality issues
    if (aggregates.averageQuality < 0.5) score -= 30;
    else if (aggregates.averageQuality < 0.7) score -= 15;

    // Deduct for high variance
    if (aggregates.qualityVariance > 0.3) score -= 10;

    // Deduct for gaps
    for (const gap of gaps) {
      if (gap.severity === 'high') score -= 20;
      else if (gap.severity === 'medium') score -= 10;
      else score -= 5;
    }

    // Bonus for consistency
    if (aggregates.lightingConsistency > 0.8) score += 5;
    if (aggregates.identityConsistency > 0.9) score += 5;

    // Clamp to 0-100
    score = Math.max(0, Math.min(100, score));

    // Determine quality label
    let quality: DatasetAnalysisResult['datasetQuality'];
    if (score >= 85) quality = 'excellent';
    else if (score >= 70) quality = 'good';
    else if (score >= 50) quality = 'acceptable';
    else if (score >= 30) quality = 'needs_work';
    else quality = 'insufficient';

    return { quality, successEstimate: score };
  }

  // Statistical utilities
  private mean(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  private std(arr: number[]): number {
    if (arr.length < 2) return 0;
    const avg = this.mean(arr);
    const squareDiffs = arr.map(value => Math.pow(value - avg, 2));
    return Math.sqrt(this.mean(squareDiffs));
  }

  private modeConfidence<T>(arr: T[]): number {
    if (arr.length === 0) return 0;
    const counts = new Map<T, number>();
    for (const item of arr) {
      counts.set(item, (counts.get(item) || 0) + 1);
    }
    const maxCount = Math.max(...counts.values());
    return maxCount / arr.length;
  }
}
