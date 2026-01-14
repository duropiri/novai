import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';

// ============================================
// INTERFACES
// ============================================

export interface FaceGeometry {
  landmarks?: number[][]; // 68 facial landmarks if available
  bbox?: { x: number; y: number; w: number; h: number };
  euler_angles: { pitch: number; yaw: number; roll: number };
  face_shape: 'oval' | 'round' | 'square' | 'heart' | 'oblong';
  eye_distance_ratio: number;
  face_symmetry_score: number;
  nose_shape: 'straight' | 'roman' | 'button' | 'upturned' | 'aquiline';
  lip_shape: 'full' | 'thin' | 'heart' | 'wide' | 'bow';
  chin_shape: 'pointed' | 'round' | 'square' | 'cleft';
  jawline: 'soft' | 'defined' | 'angular';
  forehead_height: 'low' | 'average' | 'high';
}

export interface BodyProportions {
  skeleton_landmarks?: number[][]; // Body keypoints if available
  estimated_height_cm: number | null;
  limb_ratios: {
    arm_to_torso: number;
    leg_to_torso: number;
    shoulder_to_hip: number;
    head_to_body: number;
  };
  body_type: 'slim' | 'athletic' | 'average' | 'curvy' | 'plus';
  posture: 'standing' | 'sitting' | 'other';
  visibility: {
    full_body: boolean;
    upper_body: boolean;
    face_only: boolean;
  };
}

export interface LightingProfile {
  primary_direction: { x: number; y: number; z: number };
  lighting_type: 'front' | 'rembrandt' | 'loop' | 'split' | 'butterfly' | 'natural' | 'rim';
  key_to_fill_ratio: number;
  color_temperature_kelvin: number;
  intensity: 'soft' | 'medium' | 'dramatic';
  shadow_hardness: number;
  specular_highlights: Array<{ x: number; y: number; intensity: number }>;
  ambient_level: number;
}

export interface CameraParameters {
  estimated_focal_length_mm: number;
  estimated_sensor_size: '35mm' | 'apsc' | 'mft' | 'phone';
  subject_distance_m: number;
  depth_of_field: { near_m: number; far_m: number };
  perspective_distortion: 'wide' | 'normal' | 'telephoto';
  lens_characteristics: { barrel_distortion: number; vignetting: number };
}

export interface StyleFingerprint {
  color_palette: {
    dominant: string[];
    skin_tone: string;
    hair_color: string;
    eye_color: string;
  };
  texture_profile: {
    skin_texture: 'smooth' | 'textured' | 'mixed';
    hair_texture: 'straight' | 'wavy' | 'curly' | 'coily';
  };
  hair_length: 'short' | 'medium' | 'shoulder' | 'long';
  aesthetic_style: string[];
  makeup_level: 'none' | 'natural' | 'moderate' | 'full';
  accessories: string[];
  typical_outfit_style: string;
}

export interface ExpressionData {
  expression: 'neutral' | 'smiling' | 'serious' | 'surprised' | 'other';
  expression_intensity: number;
  gaze_direction: { x: number; y: number };
  head_pose: { pitch: number; yaw: number; roll: number };
}

export interface ImageQualityScores {
  overall: number;
  blur: number;
  lighting: number;
  resolution: number;
  face_visibility: number;
}

export interface ImageAnalysisResult {
  image_url: string;
  quality_scores: ImageQualityScores;
  is_valid: boolean;
  rejection_reason?: string;
  face_geometry: FaceGeometry | null;
  face_geometry_confidence: number;
  body_proportions: BodyProportions | null;
  body_proportions_confidence: number;
  lighting_profile: LightingProfile | null;
  lighting_confidence: number;
  camera_parameters: CameraParameters | null;
  camera_confidence: number;
  style_fingerprint: StyleFingerprint | null;
  style_confidence: number;
  expression_data: ExpressionData | null;
  api_cost_cents: number;
}

export interface AggregatedProfile {
  face_geometry_profile: Record<string, { value: string | number; confidence: number; mean?: number; std?: number }>;
  body_proportions_profile: Record<string, { value: string | number; confidence: number; mean?: number; std?: number }>;
  lighting_profile: Record<string, { value: string | number; confidence: number; mean?: number; std?: number }>;
  camera_profile: Record<string, { value: string | number; confidence: number; mean?: number; std?: number }>;
  style_fingerprint: Record<string, unknown>;
  overall_confidence: number;
  data_consistency_score: number;
  best_reference_image_url: string;
  image_quality_ranking: Array<{ url: string; score: number }>;
}

// ============================================
// SERVICE
// ============================================

@Injectable()
export class IdentityAnalysisService {
  private readonly logger = new Logger(IdentityAnalysisService.name);
  private readonly apiKey: string;
  private ai: GoogleGenAI | null = null;
  private readonly model = 'gemini-2.0-flash'; // Fast model for analysis (cheaper)
  private readonly visionModel = 'gemini-2.0-flash'; // Vision analysis

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GOOGLE_GEMINI_API_KEY') || '';
    if (!this.apiKey) {
      this.logger.warn('GOOGLE_GEMINI_API_KEY not configured. Identity analysis will fail.');
    } else {
      this.ai = new GoogleGenAI({ apiKey: this.apiKey });
    }
  }

  /**
   * Analyze a single image and extract comprehensive identity metadata
   * Uses bi-directional hybrid approach: AI analysis with geometric constraints
   */
  async analyzeImage(imageUrl: string): Promise<ImageAnalysisResult> {
    if (!this.ai) {
      throw new Error('Gemini API not configured');
    }

    this.logger.log(`Analyzing image: ${imageUrl.slice(0, 50)}...`);
    const startTime = Date.now();

    // Download image
    const imageData = await this.downloadImageAsBase64(imageUrl);

    // Build comprehensive analysis prompt
    const analysisPrompt = this.buildAnalysisPrompt();

    try {
      const response = await this.ai.models.generateContent({
        model: this.visionModel,
        contents: [
          {
            role: 'user',
            parts: [
              { text: analysisPrompt },
              {
                inlineData: {
                  mimeType: imageData.mimeType,
                  data: imageData.base64,
                },
              },
            ],
          },
        ],
      });

      const text = response.text || '';
      const analysisTime = Date.now() - startTime;
      this.logger.log(`Image analysis completed in ${analysisTime}ms`);

      // Parse the JSON response
      const parsed = this.parseAnalysisResponse(text);

      // Apply geometric constraints (algorithms within models)
      const validated = this.applyGeometricConstraints(parsed);

      // Get quality scores with fallback defaults
      const qualityScores = validated.quality_scores ?? {
        overall: 0,
        blur: 0,
        lighting: 0,
        resolution: 0,
        face_visibility: 0,
      };

      return {
        image_url: imageUrl,
        quality_scores: qualityScores,
        is_valid: qualityScores.overall >= 0.4,
        rejection_reason: qualityScores.overall < 0.4
          ? this.determineRejectionReason(qualityScores)
          : undefined,
        face_geometry: validated.face_geometry ?? null,
        face_geometry_confidence: validated.face_geometry_confidence ?? 0,
        body_proportions: validated.body_proportions ?? null,
        body_proportions_confidence: validated.body_proportions_confidence ?? 0,
        lighting_profile: validated.lighting_profile ?? null,
        lighting_confidence: validated.lighting_confidence ?? 0,
        camera_parameters: validated.camera_parameters ?? null,
        camera_confidence: validated.camera_confidence ?? 0,
        style_fingerprint: validated.style_fingerprint ?? null,
        style_confidence: validated.style_confidence ?? 0,
        expression_data: validated.expression_data ?? null,
        api_cost_cents: 1, // Gemini Flash is ~$0.01 per call
      };
    } catch (error) {
      this.logger.error(`Image analysis failed: ${error}`);
      return this.createFailedResult(imageUrl, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Analyze multiple images in batch
   * Optimized for cost efficiency
   */
  async analyzeImages(
    imageUrls: string[],
    options: {
      maxConcurrency?: number;
      qualityThreshold?: number;
      onProgress?: (completed: number, total: number) => void;
    } = {},
  ): Promise<ImageAnalysisResult[]> {
    const { maxConcurrency = 3, qualityThreshold = 0.4, onProgress } = options;
    const results: ImageAnalysisResult[] = [];
    let completed = 0;

    // Process in batches to control concurrency
    for (let i = 0; i < imageUrls.length; i += maxConcurrency) {
      const batch = imageUrls.slice(i, i + maxConcurrency);
      const batchResults = await Promise.all(
        batch.map(async (url) => {
          const result = await this.analyzeImage(url);
          completed++;
          onProgress?.(completed, imageUrls.length);
          return result;
        }),
      );
      results.push(...batchResults);
    }

    // Filter by quality threshold if specified
    return results.map((r) => ({
      ...r,
      is_valid: r.quality_scores.overall >= qualityThreshold,
    }));
  }

  /**
   * Aggregate multiple image analyses into a unified profile
   * Uses statistical methods with outlier removal
   */
  aggregateProfiles(analyses: ImageAnalysisResult[]): AggregatedProfile {
    const validAnalyses = analyses.filter((a) => a.is_valid);

    if (validAnalyses.length === 0) {
      throw new Error('No valid images to aggregate');
    }

    this.logger.log(`Aggregating ${validAnalyses.length} valid analyses`);

    // Aggregate face geometry
    const faceGeometryProfile = this.aggregateFaceGeometry(validAnalyses);

    // Aggregate body proportions
    const bodyProportionsProfile = this.aggregateBodyProportions(validAnalyses);

    // Aggregate lighting
    const lightingProfile = this.aggregateLighting(validAnalyses);

    // Aggregate camera parameters
    const cameraProfile = this.aggregateCamera(validAnalyses);

    // Aggregate style
    const styleFingerprint = this.aggregateStyle(validAnalyses);

    // Calculate overall confidence
    const confidences = validAnalyses.map((a) =>
      (a.face_geometry_confidence +
        a.body_proportions_confidence +
        a.lighting_confidence +
        a.style_confidence) /
      4,
    );
    const overallConfidence = this.weightedMedian(confidences, confidences);

    // Calculate consistency score
    const consistencyScore = this.calculateConsistencyScore(validAnalyses);

    // Rank images by quality
    const imageQualityRanking = validAnalyses
      .map((a) => ({ url: a.image_url, score: a.quality_scores.overall }))
      .sort((a, b) => b.score - a.score);

    return {
      face_geometry_profile: faceGeometryProfile,
      body_proportions_profile: bodyProportionsProfile,
      lighting_profile: lightingProfile,
      camera_profile: cameraProfile,
      style_fingerprint: styleFingerprint,
      overall_confidence: overallConfidence,
      data_consistency_score: consistencyScore,
      best_reference_image_url: imageQualityRanking[0]?.url || '',
      image_quality_ranking: imageQualityRanking,
    };
  }

  /**
   * Validate a generated output against a stored profile
   * Returns a similarity score and specific deviations
   */
  async validateOutput(
    generatedImageUrl: string,
    profile: AggregatedProfile,
    threshold: number = 0.85,
  ): Promise<{
    isValid: boolean;
    overallScore: number;
    faceMatchScore: number;
    lightingMatchScore: number;
    styleMatchScore: number;
    deviations: Array<{ aspect: string; expected: string; detected: string; severity: 'low' | 'medium' | 'high' }>;
    regenerationHints: string[];
  }> {
    // Analyze the generated image
    const generatedAnalysis = await this.analyzeImage(generatedImageUrl);

    // Compare face geometry
    const faceMatchScore = this.compareFaceGeometry(
      generatedAnalysis.face_geometry,
      profile.face_geometry_profile,
    );

    // Compare lighting
    const lightingMatchScore = this.compareLighting(
      generatedAnalysis.lighting_profile,
      profile.lighting_profile,
    );

    // Compare style
    const styleMatchScore = this.compareStyle(
      generatedAnalysis.style_fingerprint,
      profile.style_fingerprint,
    );

    // Calculate overall score (weighted)
    const overallScore =
      faceMatchScore * 0.5 + lightingMatchScore * 0.25 + styleMatchScore * 0.25;

    // Identify deviations
    const deviations = this.identifyDeviations(
      generatedAnalysis,
      profile,
      faceMatchScore,
      lightingMatchScore,
      styleMatchScore,
    );

    // Generate regeneration hints
    const regenerationHints = deviations
      .filter((d) => d.severity !== 'low')
      .map((d) => `Correct ${d.aspect}: expected ${d.expected}, detected ${d.detected}`);

    return {
      isValid: overallScore >= threshold,
      overallScore,
      faceMatchScore,
      lightingMatchScore,
      styleMatchScore,
      deviations,
      regenerationHints,
    };
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private buildAnalysisPrompt(): string {
    return `Analyze this image and extract comprehensive identity metadata. Return ONLY a JSON object with the following structure (no markdown, no explanation):

{
  "quality_scores": {
    "overall": 0.0-1.0,
    "blur": 0.0-1.0 (1=sharp),
    "lighting": 0.0-1.0 (1=well-lit),
    "resolution": 0.0-1.0,
    "face_visibility": 0.0-1.0 (1=clear face)
  },
  "face_geometry": {
    "euler_angles": { "pitch": degrees, "yaw": degrees, "roll": degrees },
    "face_shape": "oval|round|square|heart|oblong",
    "eye_distance_ratio": 0.0-1.0 (IPD relative to face width),
    "face_symmetry_score": 0.0-1.0,
    "nose_shape": "straight|roman|button|upturned|aquiline",
    "lip_shape": "full|thin|heart|wide|bow",
    "chin_shape": "pointed|round|square|cleft",
    "jawline": "soft|defined|angular",
    "forehead_height": "low|average|high"
  },
  "face_geometry_confidence": 0.0-1.0,
  "body_proportions": {
    "estimated_height_cm": number or null,
    "limb_ratios": {
      "arm_to_torso": number,
      "leg_to_torso": number,
      "shoulder_to_hip": number,
      "head_to_body": number
    },
    "body_type": "slim|athletic|average|curvy|plus",
    "posture": "standing|sitting|other",
    "visibility": { "full_body": bool, "upper_body": bool, "face_only": bool }
  },
  "body_proportions_confidence": 0.0-1.0,
  "lighting_profile": {
    "primary_direction": { "x": -1 to 1, "y": -1 to 1, "z": 0 to 1 },
    "lighting_type": "front|rembrandt|loop|split|butterfly|natural|rim",
    "key_to_fill_ratio": 1.0-8.0,
    "color_temperature_kelvin": 2700-6500,
    "intensity": "soft|medium|dramatic",
    "shadow_hardness": 0.0-1.0,
    "ambient_level": 0.0-1.0
  },
  "lighting_confidence": 0.0-1.0,
  "camera_parameters": {
    "estimated_focal_length_mm": 24-200,
    "estimated_sensor_size": "35mm|apsc|mft|phone",
    "subject_distance_m": meters,
    "perspective_distortion": "wide|normal|telephoto"
  },
  "camera_confidence": 0.0-1.0,
  "style_fingerprint": {
    "color_palette": {
      "dominant": ["#hex", "#hex", "#hex"],
      "skin_tone": "#hex",
      "hair_color": "#hex",
      "eye_color": "#hex"
    },
    "texture_profile": {
      "skin_texture": "smooth|textured|mixed",
      "hair_texture": "straight|wavy|curly|coily"
    },
    "hair_length": "short|medium|shoulder|long",
    "aesthetic_style": ["professional", "natural", etc],
    "makeup_level": "none|natural|moderate|full",
    "accessories": ["glasses", etc],
    "typical_outfit_style": "casual|formal|athletic|etc"
  },
  "style_confidence": 0.0-1.0,
  "expression_data": {
    "expression": "neutral|smiling|serious|surprised|other",
    "expression_intensity": 0.0-1.0,
    "gaze_direction": { "x": -1 to 1, "y": -1 to 1 },
    "head_pose": { "pitch": degrees, "yaw": degrees, "roll": degrees }
  }
}

Be precise and analytical. Use realistic values based on what you observe. If something is not visible or determinable, use null or provide your best estimate with lower confidence.`;
  }

  private parseAnalysisResponse(text: string): Partial<ImageAnalysisResult> {
    try {
      // Extract JSON from response (handle potential markdown wrapping)
      let jsonStr = text;
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }

      // Try to find JSON object in the text
      const jsonStart = jsonStr.indexOf('{');
      const jsonEnd = jsonStr.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        jsonStr = jsonStr.slice(jsonStart, jsonEnd + 1);
      }

      const parsed = JSON.parse(jsonStr);
      return parsed;
    } catch (error) {
      this.logger.warn(`Failed to parse analysis response: ${error}`);
      return this.getDefaultAnalysis();
    }
  }

  private getDefaultAnalysis(): Partial<ImageAnalysisResult> {
    return {
      quality_scores: { overall: 0.5, blur: 0.5, lighting: 0.5, resolution: 0.5, face_visibility: 0.5 },
      face_geometry: null,
      face_geometry_confidence: 0,
      body_proportions: null,
      body_proportions_confidence: 0,
      lighting_profile: null,
      lighting_confidence: 0,
      camera_parameters: null,
      camera_confidence: 0,
      style_fingerprint: null,
      style_confidence: 0,
      expression_data: null,
    };
  }

  /**
   * Apply geometric constraints to validate AI outputs
   * (Algorithms within models)
   */
  private applyGeometricConstraints(
    parsed: Partial<ImageAnalysisResult>,
  ): Partial<ImageAnalysisResult> {
    // Validate face geometry against anatomical constraints
    if (parsed.face_geometry) {
      const fg = parsed.face_geometry;

      // Eye distance ratio should be between 0.25 and 0.45 for humans
      if (fg.eye_distance_ratio < 0.25 || fg.eye_distance_ratio > 0.45) {
        fg.eye_distance_ratio = Math.max(0.25, Math.min(0.45, fg.eye_distance_ratio));
        parsed.face_geometry_confidence = (parsed.face_geometry_confidence || 0.8) * 0.8;
      }

      // Head pitch typically between -30 and 30 degrees
      if (fg.euler_angles) {
        fg.euler_angles.pitch = Math.max(-45, Math.min(45, fg.euler_angles.pitch));
        fg.euler_angles.yaw = Math.max(-90, Math.min(90, fg.euler_angles.yaw));
        fg.euler_angles.roll = Math.max(-30, Math.min(30, fg.euler_angles.roll));
      }
    }

    // Validate body proportions against human anatomy
    if (parsed.body_proportions?.limb_ratios) {
      const lr = parsed.body_proportions.limb_ratios;

      // Head to body ratio is typically 1:7 to 1:8 (0.125 to 0.143)
      if (lr.head_to_body < 0.1 || lr.head_to_body > 0.2) {
        lr.head_to_body = Math.max(0.1, Math.min(0.2, lr.head_to_body));
        parsed.body_proportions_confidence = (parsed.body_proportions_confidence || 0.8) * 0.8;
      }
    }

    // Validate lighting parameters
    if (parsed.lighting_profile) {
      const lp = parsed.lighting_profile;

      // Color temperature between 2700K and 6500K
      if (lp.color_temperature_kelvin < 2700) lp.color_temperature_kelvin = 2700;
      if (lp.color_temperature_kelvin > 6500) lp.color_temperature_kelvin = 6500;

      // Key-to-fill ratio typically 1:1 to 8:1
      if (lp.key_to_fill_ratio < 1) lp.key_to_fill_ratio = 1;
      if (lp.key_to_fill_ratio > 8) lp.key_to_fill_ratio = 8;
    }

    return parsed;
  }

  private createFailedResult(imageUrl: string, reason: string): ImageAnalysisResult {
    return {
      image_url: imageUrl,
      quality_scores: { overall: 0, blur: 0, lighting: 0, resolution: 0, face_visibility: 0 },
      is_valid: false,
      rejection_reason: reason,
      face_geometry: null,
      face_geometry_confidence: 0,
      body_proportions: null,
      body_proportions_confidence: 0,
      lighting_profile: null,
      lighting_confidence: 0,
      camera_parameters: null,
      camera_confidence: 0,
      style_fingerprint: null,
      style_confidence: 0,
      expression_data: null,
      api_cost_cents: 0,
    };
  }

  private determineRejectionReason(scores: ImageQualityScores): string {
    const issues: string[] = [];
    if (scores.blur < 0.4) issues.push('too blurry');
    if (scores.lighting < 0.4) issues.push('poor lighting');
    if (scores.face_visibility < 0.4) issues.push('face not visible');
    if (scores.resolution < 0.4) issues.push('low resolution');
    return issues.length > 0 ? `Image rejected: ${issues.join(', ')}` : 'Image quality too low';
  }

  // ============================================
  // AGGREGATION METHODS
  // ============================================

  private aggregateFaceGeometry(
    analyses: ImageAnalysisResult[],
  ): Record<string, { value: string | number; confidence: number; mean?: number; std?: number }> {
    const withFace = analyses.filter((a) => a.face_geometry);
    if (withFace.length === 0) return {};

    // Aggregate categorical values by mode
    const faceShapes = withFace.map((a) => a.face_geometry!.face_shape);
    const noseShapes = withFace.map((a) => a.face_geometry!.nose_shape);
    const lipShapes = withFace.map((a) => a.face_geometry!.lip_shape);
    const chinShapes = withFace.map((a) => a.face_geometry!.chin_shape);
    const jawlines = withFace.map((a) => a.face_geometry!.jawline);
    const foreheads = withFace.map((a) => a.face_geometry!.forehead_height);

    // Aggregate numerical values
    const symmetryScores = withFace.map((a) => a.face_geometry!.face_symmetry_score);
    const eyeDistances = withFace.map((a) => a.face_geometry!.eye_distance_ratio);
    const confidences = withFace.map((a) => a.face_geometry_confidence);

    return {
      face_shape: { value: this.mode(faceShapes), confidence: this.modeConfidence(faceShapes) },
      nose_shape: { value: this.mode(noseShapes), confidence: this.modeConfidence(noseShapes) },
      lip_shape: { value: this.mode(lipShapes), confidence: this.modeConfidence(lipShapes) },
      chin_shape: { value: this.mode(chinShapes), confidence: this.modeConfidence(chinShapes) },
      jawline: { value: this.mode(jawlines), confidence: this.modeConfidence(jawlines) },
      forehead_height: { value: this.mode(foreheads), confidence: this.modeConfidence(foreheads) },
      face_symmetry: {
        value: this.weightedMedian(symmetryScores, confidences),
        confidence: this.mean(confidences),
        mean: this.mean(symmetryScores),
        std: this.std(symmetryScores),
      },
      eye_distance_ratio: {
        value: this.weightedMedian(eyeDistances, confidences),
        confidence: this.mean(confidences),
        mean: this.mean(eyeDistances),
        std: this.std(eyeDistances),
      },
    };
  }

  private aggregateBodyProportions(
    analyses: ImageAnalysisResult[],
  ): Record<string, { value: string | number; confidence: number; mean?: number; std?: number }> {
    const withBody = analyses.filter((a) => a.body_proportions && a.body_proportions.visibility?.full_body);
    if (withBody.length === 0) return {};

    const bodyTypes = withBody.map((a) => a.body_proportions!.body_type);
    const confidences = withBody.map((a) => a.body_proportions_confidence);

    const armToTorso = withBody.map((a) => a.body_proportions!.limb_ratios.arm_to_torso);
    const legToTorso = withBody.map((a) => a.body_proportions!.limb_ratios.leg_to_torso);
    const shoulderToHip = withBody.map((a) => a.body_proportions!.limb_ratios.shoulder_to_hip);
    const headToBody = withBody.map((a) => a.body_proportions!.limb_ratios.head_to_body);

    return {
      body_type: { value: this.mode(bodyTypes), confidence: this.modeConfidence(bodyTypes) },
      arm_to_torso: {
        value: this.weightedMedian(armToTorso, confidences),
        confidence: this.mean(confidences),
        mean: this.mean(armToTorso),
        std: this.std(armToTorso),
      },
      leg_to_torso: {
        value: this.weightedMedian(legToTorso, confidences),
        confidence: this.mean(confidences),
        mean: this.mean(legToTorso),
        std: this.std(legToTorso),
      },
      shoulder_to_hip: {
        value: this.weightedMedian(shoulderToHip, confidences),
        confidence: this.mean(confidences),
        mean: this.mean(shoulderToHip),
        std: this.std(shoulderToHip),
      },
      head_to_body: {
        value: this.weightedMedian(headToBody, confidences),
        confidence: this.mean(confidences),
        mean: this.mean(headToBody),
        std: this.std(headToBody),
      },
    };
  }

  private aggregateLighting(
    analyses: ImageAnalysisResult[],
  ): Record<string, { value: string | number; confidence: number; mean?: number; std?: number }> {
    const withLighting = analyses.filter((a) => a.lighting_profile);
    if (withLighting.length === 0) return {};

    const types = withLighting.map((a) => a.lighting_profile!.lighting_type);
    const intensities = withLighting.map((a) => a.lighting_profile!.intensity);
    const temps = withLighting.map((a) => a.lighting_profile!.color_temperature_kelvin);
    const ratios = withLighting.map((a) => a.lighting_profile!.key_to_fill_ratio);
    const confidences = withLighting.map((a) => a.lighting_confidence);

    return {
      lighting_type: { value: this.mode(types), confidence: this.modeConfidence(types) },
      intensity: { value: this.mode(intensities), confidence: this.modeConfidence(intensities) },
      color_temperature: {
        value: this.weightedMedian(temps, confidences),
        confidence: this.mean(confidences),
        mean: this.mean(temps),
        std: this.std(temps),
      },
      key_fill_ratio: {
        value: this.weightedMedian(ratios, confidences),
        confidence: this.mean(confidences),
        mean: this.mean(ratios),
        std: this.std(ratios),
      },
    };
  }

  private aggregateCamera(
    analyses: ImageAnalysisResult[],
  ): Record<string, { value: string | number; confidence: number; mean?: number; std?: number }> {
    const withCamera = analyses.filter((a) => a.camera_parameters);
    if (withCamera.length === 0) return {};

    const focals = withCamera.map((a) => a.camera_parameters!.estimated_focal_length_mm);
    const distances = withCamera.map((a) => a.camera_parameters!.subject_distance_m);
    const perspectives = withCamera.map((a) => a.camera_parameters!.perspective_distortion);
    const confidences = withCamera.map((a) => a.camera_confidence);

    return {
      focal_length: {
        value: this.weightedMedian(focals, confidences),
        confidence: this.mean(confidences),
        mean: this.mean(focals),
        std: this.std(focals),
      },
      subject_distance: {
        value: this.weightedMedian(distances, confidences),
        confidence: this.mean(confidences),
        mean: this.mean(distances),
        std: this.std(distances),
      },
      perspective: { value: this.mode(perspectives), confidence: this.modeConfidence(perspectives) },
    };
  }

  private aggregateStyle(
    analyses: ImageAnalysisResult[],
  ): Record<string, unknown> {
    const withStyle = analyses.filter((a) => a.style_fingerprint);
    if (withStyle.length === 0) return {};

    // Get most common values
    const skinTones = withStyle.map((a) => a.style_fingerprint!.color_palette.skin_tone);
    const hairColors = withStyle.map((a) => a.style_fingerprint!.color_palette.hair_color);
    const eyeColors = withStyle.map((a) => a.style_fingerprint!.color_palette.eye_color);
    const hairLengths = withStyle.map((a) => a.style_fingerprint!.hair_length);
    const hairTextures = withStyle.map((a) => a.style_fingerprint!.texture_profile.hair_texture);
    const skinTextures = withStyle.map((a) => a.style_fingerprint!.texture_profile.skin_texture);
    const makeupLevels = withStyle.map((a) => a.style_fingerprint!.makeup_level);

    // Aggregate all style keywords
    const allStyles = withStyle.flatMap((a) => a.style_fingerprint!.aesthetic_style);
    const styleKeywords = [...new Set(allStyles)];

    return {
      skin_tone: { value: this.mode(skinTones), confidence: this.modeConfidence(skinTones) },
      hair_color: { value: this.mode(hairColors), confidence: this.modeConfidence(hairColors) },
      eye_color: { value: this.mode(eyeColors), confidence: this.modeConfidence(eyeColors) },
      hair_length: { value: this.mode(hairLengths), confidence: this.modeConfidence(hairLengths) },
      hair_texture: { value: this.mode(hairTextures), confidence: this.modeConfidence(hairTextures) },
      skin_texture: { value: this.mode(skinTextures), confidence: this.modeConfidence(skinTextures) },
      makeup_level: { value: this.mode(makeupLevels), confidence: this.modeConfidence(makeupLevels) },
      style_keywords: styleKeywords,
    };
  }

  // ============================================
  // COMPARISON METHODS (for validation)
  // ============================================

  private compareFaceGeometry(
    generated: FaceGeometry | null,
    profile: Record<string, { value: string | number; confidence: number }>,
  ): number {
    if (!generated || Object.keys(profile).length === 0) return 0.5;

    let matches = 0;
    let total = 0;

    // Compare categorical features
    const categoricalFeatures = ['face_shape', 'nose_shape', 'lip_shape', 'chin_shape', 'jawline', 'forehead_height'];
    for (const feature of categoricalFeatures) {
      if (profile[feature]) {
        total++;
        const generatedValue = generated[feature as keyof FaceGeometry];
        if (generatedValue === profile[feature].value) {
          matches++;
        }
      }
    }

    return total > 0 ? matches / total : 0.5;
  }

  private compareLighting(
    generated: LightingProfile | null,
    profile: Record<string, { value: string | number; confidence: number }>,
  ): number {
    if (!generated || Object.keys(profile).length === 0) return 0.5;

    let score = 0;
    let count = 0;

    // Compare lighting type
    if (profile.lighting_type) {
      count++;
      if (generated.lighting_type === profile.lighting_type.value) {
        score += 1;
      }
    }

    // Compare intensity
    if (profile.intensity) {
      count++;
      if (generated.intensity === profile.intensity.value) {
        score += 1;
      }
    }

    // Compare color temperature (within tolerance)
    if (profile.color_temperature && typeof profile.color_temperature.value === 'number') {
      count++;
      const diff = Math.abs(generated.color_temperature_kelvin - profile.color_temperature.value);
      if (diff < 500) score += 1;
      else if (diff < 1000) score += 0.5;
    }

    return count > 0 ? score / count : 0.5;
  }

  private compareStyle(
    generated: StyleFingerprint | null,
    profile: Record<string, unknown>,
  ): number {
    if (!generated || Object.keys(profile).length === 0) return 0.5;

    let matches = 0;
    let total = 0;

    // Compare categorical style features
    const features = ['hair_length', 'hair_texture', 'skin_texture', 'makeup_level'];
    for (const feature of features) {
      const profileValue = profile[feature] as { value: string } | undefined;
      if (profileValue) {
        total++;
        const generatedValue = feature === 'hair_length'
          ? generated.hair_length
          : feature === 'hair_texture'
            ? generated.texture_profile.hair_texture
            : feature === 'skin_texture'
              ? generated.texture_profile.skin_texture
              : generated.makeup_level;
        if (generatedValue === profileValue.value) {
          matches++;
        }
      }
    }

    return total > 0 ? matches / total : 0.5;
  }

  private identifyDeviations(
    generated: ImageAnalysisResult,
    profile: AggregatedProfile,
    faceScore: number,
    lightingScore: number,
    styleScore: number,
  ): Array<{ aspect: string; expected: string; detected: string; severity: 'low' | 'medium' | 'high' }> {
    const deviations: Array<{ aspect: string; expected: string; detected: string; severity: 'low' | 'medium' | 'high' }> = [];

    if (faceScore < 0.7 && generated.face_geometry && profile.face_geometry_profile.face_shape) {
      deviations.push({
        aspect: 'face_shape',
        expected: String(profile.face_geometry_profile.face_shape.value),
        detected: generated.face_geometry.face_shape,
        severity: faceScore < 0.5 ? 'high' : 'medium',
      });
    }

    if (lightingScore < 0.7 && generated.lighting_profile && profile.lighting_profile.lighting_type) {
      deviations.push({
        aspect: 'lighting',
        expected: String(profile.lighting_profile.lighting_type.value),
        detected: generated.lighting_profile.lighting_type,
        severity: lightingScore < 0.5 ? 'high' : 'medium',
      });
    }

    if (styleScore < 0.7 && generated.style_fingerprint) {
      const skinTone = profile.style_fingerprint.skin_tone as { value: string } | undefined;
      if (skinTone && generated.style_fingerprint.color_palette.skin_tone !== skinTone.value) {
        deviations.push({
          aspect: 'skin_tone',
          expected: skinTone.value,
          detected: generated.style_fingerprint.color_palette.skin_tone,
          severity: 'high',
        });
      }
    }

    return deviations;
  }

  private calculateConsistencyScore(analyses: ImageAnalysisResult[]): number {
    if (analyses.length < 2) return 1.0;

    // Calculate variance in key metrics
    const faceShapes = analyses
      .filter((a) => a.face_geometry)
      .map((a) => a.face_geometry!.face_shape);
    const faceShapeConsistency = this.modeConfidence(faceShapes);

    const skinTones = analyses
      .filter((a) => a.style_fingerprint)
      .map((a) => a.style_fingerprint!.color_palette.skin_tone);
    const skinToneConsistency = this.modeConfidence(skinTones);

    return (faceShapeConsistency + skinToneConsistency) / 2;
  }

  // ============================================
  // STATISTICAL UTILITIES
  // ============================================

  private mode<T>(arr: T[]): T {
    const counts = new Map<T, number>();
    for (const item of arr) {
      counts.set(item, (counts.get(item) || 0) + 1);
    }
    let maxCount = 0;
    let mode = arr[0];
    for (const [item, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        mode = item;
      }
    }
    return mode;
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

  private mean(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  private std(arr: number[]): number {
    if (arr.length < 2) return 0;
    const avg = this.mean(arr);
    const squareDiffs = arr.map((value) => Math.pow(value - avg, 2));
    return Math.sqrt(this.mean(squareDiffs));
  }

  private weightedMedian(values: number[], weights: number[]): number {
    if (values.length === 0) return 0;
    if (values.length === 1) return values[0];

    // Create array of [value, weight] pairs and sort by value
    const pairs = values.map((v, i) => ({ value: v, weight: weights[i] || 1 }));
    pairs.sort((a, b) => a.value - b.value);

    const totalWeight = pairs.reduce((sum, p) => sum + p.weight, 0);
    let cumWeight = 0;

    for (const pair of pairs) {
      cumWeight += pair.weight;
      if (cumWeight >= totalWeight / 2) {
        return pair.value;
      }
    }

    return pairs[pairs.length - 1].value;
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  private async downloadImageAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    return { base64, mimeType: contentType };
  }
}
