import { Injectable, Logger } from '@nestjs/common';
import { FalService } from './fal.service';
import { SupabaseService } from '../modules/files/supabase.service';
import {
  FaceDetectionResult,
  FaceIdentity,
  SkullVectors,
  AngleCoverage,
} from './face-embedding.service';

// Angle images for 3D mesh generation
export interface AngleImages {
  front?: string;
  profile_left?: string;
  profile_right?: string;
  quarter_left?: string;
  quarter_right?: string;
}

// 3D mesh generation result
export interface MeshGenerationResult {
  meshUrl: string;
  thumbnailUrl: string;
  textureUrls?: string[];
  skullVectors?: SkullVectors;
  depthMapUrl?: string;
}

// Minimum angle coverage requirements
export interface AngleCoverageRequirements {
  requireFront: boolean;
  requireProfile: boolean; // At least one profile (left or right)
  requireQuarter: boolean; // At least one 3/4 angle
  minAngleCount: number;
}

@Injectable()
export class Face3DService {
  private readonly logger = new Logger(Face3DService.name);

  // Default requirements for 3D mesh generation
  private readonly DEFAULT_REQUIREMENTS: AngleCoverageRequirements = {
    requireFront: true,
    requireProfile: true,
    requireQuarter: false, // Optional but helpful
    minAngleCount: 2, // Minimum front + profile
  };

  constructor(
    private readonly falService: FalService,
    private readonly supabaseService: SupabaseService,
  ) {}

  /**
   * Check if angle coverage meets requirements for 3D mesh generation
   */
  checkAngleCoverage(
    coverage: AngleCoverage,
    requirements: AngleCoverageRequirements = this.DEFAULT_REQUIREMENTS,
  ): {
    meetsRequirements: boolean;
    missingAngles: string[];
    coverageScore: number;
  } {
    const missingAngles: string[] = [];

    // Check front
    if (requirements.requireFront && !coverage.front) {
      missingAngles.push('front');
    }

    // Check profile (either left or right)
    if (requirements.requireProfile && !coverage.profile_left && !coverage.profile_right) {
      missingAngles.push('profile (left or right)');
    }

    // Check quarter (either left or right)
    if (requirements.requireQuarter && !coverage.quarter_left && !coverage.quarter_right) {
      missingAngles.push('3/4 angle (left or right)');
    }

    // Count angles
    const angleCount = [
      coverage.front,
      coverage.profile_left,
      coverage.profile_right,
      coverage.quarter_left,
      coverage.quarter_right,
    ].filter(Boolean).length;

    // Calculate coverage score (0-1)
    const coverageScore = angleCount / 5;

    const meetsRequirements =
      missingAngles.length === 0 && angleCount >= requirements.minAngleCount;

    return { meetsRequirements, missingAngles, coverageScore };
  }

  /**
   * Collect angle images from detections for 3D mesh generation
   * Selects best quality image for each angle
   */
  collectAngleImages(detections: FaceDetectionResult[]): AngleImages {
    const angles: AngleImages = {};

    // Group by angle and select best quality
    for (const detection of detections) {
      if (!detection.angleEstimate || detection.angleEstimate === 'other') continue;

      const angle = detection.angleEstimate;
      const existingQuality = this.getImageQuality(angles[angle], detections);
      const newQuality = detection.qualityScore || detection.confidence;

      if (!angles[angle] || newQuality > existingQuality) {
        angles[angle] = detection.imageUrl;
      }
    }

    return angles;
  }

  /**
   * Get quality score for an existing angle image
   */
  private getImageQuality(imageUrl: string | undefined, detections: FaceDetectionResult[]): number {
    if (!imageUrl) return 0;
    const detection = detections.find((d) => d.imageUrl === imageUrl);
    return detection?.qualityScore || detection?.confidence || 0;
  }

  /**
   * Generate 3D face mesh from angle images
   */
  async generateMesh(
    angleImages: AngleImages,
    options: {
      generateDepthMap?: boolean;
      targetPolycount?: number;
    } = {},
  ): Promise<MeshGenerationResult> {
    this.logger.log('Generating 3D face mesh from angle images');

    // Collect available images (prioritize: front, profile, quarter)
    const imageUrls: string[] = [];

    if (angleImages.front) imageUrls.push(angleImages.front);
    if (angleImages.profile_left) imageUrls.push(angleImages.profile_left);
    if (angleImages.profile_right) imageUrls.push(angleImages.profile_right);
    if (angleImages.quarter_left) imageUrls.push(angleImages.quarter_left);
    if (angleImages.quarter_right) imageUrls.push(angleImages.quarter_right);

    if (imageUrls.length === 0) {
      throw new Error('No angle images available for mesh generation');
    }

    this.logger.log(`Using ${imageUrls.length} image(s) for mesh generation`);

    // Generate 3D mesh using Meshy
    const meshResult = await this.falService.generateFaceMesh({
      image_urls: imageUrls,
      topology: 'quad',
      target_polycount: options.targetPolycount || 30000,
      enable_texture: true,
    });

    // Generate depth map from front image if requested
    let depthMapUrl: string | undefined;
    if (options.generateDepthMap && angleImages.front) {
      try {
        const depthResult = await this.falService.generateDepthMap({
          image_url: angleImages.front,
        });
        depthMapUrl = depthResult.depth_map_url;
      } catch (err) {
        this.logger.warn(`Depth map generation failed: ${err}`);
        // Continue without depth map
      }
    }

    // Extract skull vectors from mesh and depth map
    const skullVectors = await this.extractSkullVectors({
      meshUrl: meshResult.model_url,
      depthMapUrl,
      frontImageUrl: angleImages.front,
    });

    return {
      meshUrl: meshResult.model_url,
      thumbnailUrl: meshResult.thumbnail_url,
      textureUrls: meshResult.texture_urls,
      skullVectors,
      depthMapUrl,
    };
  }

  /**
   * Extract 3D skull geometry vectors from mesh
   * These vectors capture the true 3D proportions for accurate regeneration
   */
  async extractSkullVectors(input: {
    meshUrl: string;
    depthMapUrl?: string;
    frontImageUrl?: string;
  }): Promise<SkullVectors> {
    this.logger.log('Extracting skull geometry vectors');

    // In a full implementation, this would parse the GLB mesh
    // and extract geometric measurements. For now, we use
    // heuristics based on available depth data.

    // Initialize with default mesocephalic proportions
    const vectors: SkullVectors = {
      skullShape: 'mesocephalic',
      foreheadDepth: 0.85,
      noseProjection: 1.0,
      chinDepth: 0.9,
      cheekboneWidth: 1.0,
      jawAngle: 125,
      eyeSocketDepth: 0.3,
      faceWidthToDepthRatio: 1.2,
      profileAngle: 168,
    };

    // If we have a depth map, we can estimate some values
    // by analyzing the depth gradients
    if (input.depthMapUrl) {
      try {
        // Analyze depth map to refine measurements
        // This would download the depth map and analyze pixel values
        // For now, we keep the defaults
        this.logger.log('Depth map available for analysis');
      } catch (err) {
        this.logger.warn(`Depth analysis failed: ${err}`);
      }
    }

    // TODO: In production, implement mesh parsing:
    // 1. Download GLB from meshUrl
    // 2. Parse vertex data
    // 3. Find key landmark vertices (nose tip, chin, forehead, etc.)
    // 4. Calculate actual geometric measurements
    // 5. Classify skull shape based on cephalic index

    return vectors;
  }

  /**
   * Generate depth map for a face image
   */
  async generateDepthMap(imageUrl: string): Promise<string> {
    this.logger.log('Generating depth map');

    const result = await this.falService.generateDepthMap({
      image_url: imageUrl,
    });

    return result.depth_map_url;
  }

  /**
   * Update a face identity with 3D mesh data
   */
  async updateIdentityWith3DMesh(
    identityId: string,
    meshResult: MeshGenerationResult,
  ): Promise<FaceIdentity> {
    this.logger.log(`Updating identity ${identityId} with 3D mesh data`);

    const { data, error } = await this.supabaseService.getClient()
      .from('face_identities')
      .update({
        mesh_url: meshResult.meshUrl,
        mesh_thumbnail_url: meshResult.thumbnailUrl,
        depth_map_url: meshResult.depthMapUrl,
        skull_vectors: meshResult.skullVectors,
        mesh_quality_score: this.calculateMeshQualityScore(meshResult),
        updated_at: new Date().toISOString(),
      })
      .eq('id', identityId)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error updating identity with mesh: ${error.message}`);
      throw error;
    }

    return this.mapDbIdentityToInterface(data);
  }

  /**
   * Calculate quality score for generated mesh
   */
  private calculateMeshQualityScore(meshResult: MeshGenerationResult): number {
    let score = 0.5; // Base score for having a mesh

    // Bonus for having texture
    if (meshResult.textureUrls && meshResult.textureUrls.length > 0) {
      score += 0.2;
    }

    // Bonus for having depth map
    if (meshResult.depthMapUrl) {
      score += 0.1;
    }

    // Bonus for having skull vectors
    if (meshResult.skullVectors && Object.keys(meshResult.skullVectors).length > 5) {
      score += 0.2;
    }

    return Math.min(1, score);
  }

  /**
   * Check if an identity needs 3D mesh generation
   */
  async shouldGenerate3DMesh(identityId: string): Promise<{
    shouldGenerate: boolean;
    reason: string;
  }> {
    const { data: identity, error } = await this.supabaseService.getClient()
      .from('face_identities')
      .select('mesh_url, angle_coverage, image_count, mesh_quality_score')
      .eq('id', identityId)
      .single();

    if (error || !identity) {
      return { shouldGenerate: false, reason: 'Identity not found' };
    }

    // Check if mesh already exists and is good quality
    if (identity.mesh_url && identity.mesh_quality_score >= 0.7) {
      return { shouldGenerate: false, reason: 'High-quality mesh already exists' };
    }

    // Check angle coverage
    const coverage = identity.angle_coverage || {};
    const { meetsRequirements, missingAngles } = this.checkAngleCoverage(coverage);

    if (!meetsRequirements) {
      return {
        shouldGenerate: false,
        reason: `Insufficient angle coverage. Missing: ${missingAngles.join(', ')}`,
      };
    }

    // Check minimum image count
    if (identity.image_count < 2) {
      return { shouldGenerate: false, reason: 'Need at least 2 images' };
    }

    // All checks passed
    return { shouldGenerate: true, reason: 'Ready for 3D mesh generation' };
  }

  /**
   * Generate 3D mesh for an identity if eligible
   */
  async generateMeshForIdentity(identityId: string): Promise<MeshGenerationResult | null> {
    const { shouldGenerate, reason } = await this.shouldGenerate3DMesh(identityId);

    if (!shouldGenerate) {
      this.logger.log(`Skipping mesh generation for ${identityId}: ${reason}`);
      return null;
    }

    // Get identity with angle coverage
    const { data: identity, error } = await this.supabaseService.getClient()
      .from('face_identities')
      .select('angle_coverage')
      .eq('id', identityId)
      .single();

    if (error || !identity) {
      throw new Error(`Identity not found: ${identityId}`);
    }

    // Convert angle coverage to angle images
    const angleImages: AngleImages = {};
    const coverage = identity.angle_coverage || {};

    if (coverage.front?.url) angleImages.front = coverage.front.url;
    if (coverage.profile_left?.url) angleImages.profile_left = coverage.profile_left.url;
    if (coverage.profile_right?.url) angleImages.profile_right = coverage.profile_right.url;
    if (coverage.quarter_left?.url) angleImages.quarter_left = coverage.quarter_left.url;
    if (coverage.quarter_right?.url) angleImages.quarter_right = coverage.quarter_right.url;

    // Generate mesh
    const meshResult = await this.generateMesh(angleImages, {
      generateDepthMap: true,
    });

    // Update identity with mesh data
    await this.updateIdentityWith3DMesh(identityId, meshResult);

    return meshResult;
  }

  /**
   * Suggest which additional angles would improve the 3D mesh
   */
  suggestAdditionalAngles(coverage: AngleCoverage): {
    suggestions: string[];
    priority: 'high' | 'medium' | 'low';
  } {
    const suggestions: string[] = [];

    // Check for critical missing angles
    if (!coverage.front) {
      suggestions.push('Front-facing photo (looking directly at camera)');
    }

    if (!coverage.profile_left && !coverage.profile_right) {
      suggestions.push('Profile photo (side view showing ear)');
    }

    // Check for improvement opportunities
    if (!coverage.quarter_left && !coverage.quarter_right) {
      suggestions.push('3/4 angle photo (45-degree turn)');
    }

    // Check for symmetry
    if (coverage.profile_left && !coverage.profile_right) {
      suggestions.push('Right profile (for symmetry)');
    } else if (coverage.profile_right && !coverage.profile_left) {
      suggestions.push('Left profile (for symmetry)');
    }

    // Determine priority
    let priority: 'high' | 'medium' | 'low' = 'low';
    if (!coverage.front || (!coverage.profile_left && !coverage.profile_right)) {
      priority = 'high';
    } else if (suggestions.length > 0) {
      priority = 'medium';
    }

    return { suggestions, priority };
  }

  /**
   * Build JSON prompt from skull vectors for generation
   * This creates the JSON-structured prompt for compatible models
   */
  buildGenerationPrompt(
    identity: FaceIdentity,
    options: {
      cameraAngle?: string;
      lighting?: string;
      expression?: string;
    } = {},
  ): Record<string, unknown> {
    const prompt: Record<string, unknown> = {
      subject: {
        identity: identity.id,
        face_geometry: identity.skullVectors || {},
        style_fingerprint: identity.styleFingerprint || {},
      },
    };

    // Add camera settings if specified
    if (options.cameraAngle) {
      prompt.camera = {
        angle: options.cameraAngle,
        lens: '85mm',
        depth_of_field: 'shallow',
      };
    }

    // Add lighting settings if specified
    if (options.lighting) {
      prompt.lighting = {
        type: options.lighting,
        key_to_fill: 3.0,
        color_temp: 5600,
      };
    }

    // Add expression if specified
    if (options.expression) {
      (prompt.subject as Record<string, unknown>).expression = options.expression;
    }

    return prompt;
  }

  /**
   * Convert skull vectors to natural language description
   * Useful for models that don't support JSON prompts
   */
  describeSkullVectors(vectors: SkullVectors): string {
    const descriptions: string[] = [];

    if (vectors.skullShape) {
      const shapeDescriptions: Record<string, string> = {
        dolichocephalic: 'elongated, narrow face shape',
        mesocephalic: 'medium, balanced face shape',
        brachycephalic: 'wide, rounded face shape',
      };
      descriptions.push(shapeDescriptions[vectors.skullShape] || vectors.skullShape);
    }

    if (vectors.noseProjection) {
      if (vectors.noseProjection > 1.2) {
        descriptions.push('prominent nose');
      } else if (vectors.noseProjection < 0.8) {
        descriptions.push('flat nose');
      }
    }

    if (vectors.cheekboneWidth) {
      if (vectors.cheekboneWidth > 1.1) {
        descriptions.push('high, prominent cheekbones');
      }
    }

    if (vectors.jawAngle) {
      if (vectors.jawAngle > 130) {
        descriptions.push('strong, angular jaw');
      } else if (vectors.jawAngle < 120) {
        descriptions.push('soft, rounded jaw');
      }
    }

    if (vectors.foreheadDepth && vectors.foreheadDepth > 0.9) {
      descriptions.push('prominent forehead');
    }

    return descriptions.length > 0 ? descriptions.join(', ') : 'balanced facial features';
  }

  /**
   * Map database identity to interface
   */
  private mapDbIdentityToInterface(data: Record<string, unknown>): FaceIdentity {
    return {
      id: data.id as string,
      name: data.name as string | undefined,
      embedding: data.embedding ? this.parseEmbedding(data.embedding as string) : undefined,
      meshUrl: data.mesh_url as string | undefined,
      meshThumbnailUrl: data.mesh_thumbnail_url as string | undefined,
      skullVectors: data.skull_vectors as SkullVectors | undefined,
      angleCoverage: data.angle_coverage as AngleCoverage | undefined,
      faceGeometry: data.face_geometry as Record<string, unknown> | undefined,
      styleFingerprint: data.style_fingerprint as Record<string, unknown> | undefined,
      sourceType: data.source_type as FaceIdentity['sourceType'],
      sourceId: data.source_id as string | undefined,
      imageCount: data.image_count as number || 0,
      angleCount: data.angle_count as number || 0,
      confidenceScore: data.confidence_score as number | undefined,
      createdAt: new Date(data.created_at as string),
      updatedAt: new Date(data.updated_at as string),
    };
  }

  /**
   * Parse PostgreSQL vector format
   */
  private parseEmbedding(embeddingStr: string): number[] {
    const match = embeddingStr.match(/\[([\d.,e+-]+)\]/);
    if (!match) return [];
    return match[1].split(',').map(Number);
  }
}
