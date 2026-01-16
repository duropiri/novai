import { Injectable, Logger } from '@nestjs/common';
import { FalService } from './fal.service';
import { SupabaseService } from '../modules/files/supabase.service';

// Face detection result from a single image
export interface FaceDetectionResult {
  id?: string;
  imageUrl: string;
  bbox: { x: number; y: number; width: number; height: number };
  confidence: number;
  landmarks?: Array<{ x: number; y: number }>;
  embedding?: number[];
  croppedFaceUrl?: string;
  qualityScore?: number;
  angleEstimate?: 'front' | 'profile_left' | 'profile_right' | 'quarter_left' | 'quarter_right' | 'other';
  eulerAngles?: { pitch: number; yaw: number; roll: number };
}

// Identity match result
export interface IdentityMatch {
  identityId: string;
  identityName?: string;
  similarity: number;
  isMatch: boolean; // true if similarity >= threshold
}

// Stored face identity
export interface FaceIdentity {
  id: string;
  name?: string;
  embedding?: number[];
  meshUrl?: string;
  meshThumbnailUrl?: string;
  skullVectors?: SkullVectors;
  angleCoverage?: AngleCoverage;
  faceGeometry?: Record<string, unknown>;
  styleFingerprint?: Record<string, unknown>;
  sourceType?: 'lora_training' | 'character_diagram' | 'reference_kit' | 'manual';
  sourceId?: string;
  imageCount: number;
  angleCount: number;
  confidenceScore?: number;
  createdAt: Date;
  updatedAt: Date;
}

// 3D skull geometry parameters
export interface SkullVectors {
  foreheadDepth?: number;
  noseProjection?: number;
  chinDepth?: number;
  cheekboneWidth?: number;
  jawAngle?: number;
  eyeSocketDepth?: number;
  skullShape?: 'dolichocephalic' | 'mesocephalic' | 'brachycephalic';
  faceWidthToDepthRatio?: number;
  profileAngle?: number;
}

// Multi-angle coverage tracking
export interface AngleCoverage {
  front?: { url: string; quality: number; detectionId?: string };
  profile_left?: { url: string; quality: number; detectionId?: string };
  profile_right?: { url: string; quality: number; detectionId?: string };
  quarter_left?: { url: string; quality: number; detectionId?: string };
  quarter_right?: { url: string; quality: number; detectionId?: string };
}

@Injectable()
export class FaceEmbeddingService {
  private readonly logger = new Logger(FaceEmbeddingService.name);

  // Similarity threshold for identity matching (0.7 is a good default)
  private readonly MATCH_THRESHOLD = 0.7;

  constructor(
    private readonly falService: FalService,
    private readonly supabaseService: SupabaseService,
  ) {}

  /**
   * Detect all faces in an image and generate embeddings
   */
  async detectFacesInImage(imageUrl: string): Promise<FaceDetectionResult[]> {
    this.logger.log(`Detecting faces in image: ${imageUrl.substring(0, 50)}...`);

    const result = await this.falService.detectFaces({
      image_url: imageUrl,
      return_embeddings: true,
    });

    const detections: FaceDetectionResult[] = result.faces.map((face, index) => {
      // Estimate angle from face position/size (heuristic)
      // Better estimation would come from euler angles in the face data
      const angleEstimate = this.estimateAngleFromBbox(
        face.bbox,
        result.image_width,
        result.image_height,
      );

      return {
        imageUrl,
        bbox: face.bbox,
        confidence: face.confidence,
        landmarks: face.landmarks,
        embedding: face.embedding,
        angleEstimate,
        qualityScore: this.estimateQualityScore(face),
      };
    });

    this.logger.log(`Detected ${detections.length} face(s) in image`);
    return detections;
  }

  /**
   * Process multiple images and detect all faces
   */
  async detectFacesInImages(imageUrls: string[]): Promise<{
    detections: FaceDetectionResult[];
    byImage: Map<string, FaceDetectionResult[]>;
  }> {
    this.logger.log(`Processing ${imageUrls.length} images for face detection`);

    const allDetections: FaceDetectionResult[] = [];
    const byImage = new Map<string, FaceDetectionResult[]>();

    // Process images in parallel (batches of 5)
    const batchSize = 5;
    for (let i = 0; i < imageUrls.length; i += batchSize) {
      const batch = imageUrls.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((url) => this.detectFacesInImage(url).catch((err) => {
          this.logger.warn(`Failed to detect faces in ${url}: ${err.message}`);
          return [];
        })),
      );

      batch.forEach((url, idx) => {
        const detections = batchResults[idx];
        byImage.set(url, detections);
        allDetections.push(...detections);
      });
    }

    this.logger.log(`Total faces detected: ${allDetections.length}`);
    return { detections: allDetections, byImage };
  }

  /**
   * Find matching identities for a face embedding
   */
  async findMatchingIdentities(
    embedding: number[],
    threshold: number = this.MATCH_THRESHOLD,
  ): Promise<IdentityMatch[]> {
    this.logger.log('Searching for matching identities');

    // Query the database for similar faces using pgvector
    const { data, error } = await this.supabaseService.getClient()
      .rpc('find_similar_faces', {
        query_embedding: `[${embedding.join(',')}]`,
        similarity_threshold: threshold,
        max_results: 10,
      });

    if (error) {
      this.logger.error(`Error finding similar faces: ${error.message}`);
      throw error;
    }

    const matches: IdentityMatch[] = (data || []).map((row: { identity_id: string; identity_name: string | null; similarity: number }) => ({
      identityId: row.identity_id,
      identityName: row.identity_name || undefined,
      similarity: row.similarity,
      isMatch: row.similarity >= threshold,
    }));

    this.logger.log(`Found ${matches.length} potential matches`);
    return matches;
  }

  /**
   * Group detections by identity using embedding similarity
   * Returns clusters of faces that belong to the same person
   */
  async clusterFacesByIdentity(
    detections: FaceDetectionResult[],
    threshold: number = this.MATCH_THRESHOLD,
  ): Promise<{
    clusters: Array<{
      detections: FaceDetectionResult[];
      representativeEmbedding: number[];
      matchedIdentity?: IdentityMatch;
    }>;
    unclusteredDetections: FaceDetectionResult[];
  }> {
    this.logger.log(`Clustering ${detections.length} face detections`);

    const clusters: Array<{
      detections: FaceDetectionResult[];
      representativeEmbedding: number[];
      matchedIdentity?: IdentityMatch;
    }> = [];
    const unclusteredDetections: FaceDetectionResult[] = [];

    // Simple clustering: assign each face to the most similar cluster
    for (const detection of detections) {
      if (!detection.embedding) {
        unclusteredDetections.push(detection);
        continue;
      }

      let bestClusterIdx = -1;
      let bestSimilarity = 0;

      // Find the best matching cluster
      for (let i = 0; i < clusters.length; i++) {
        const similarity = this.falService.compareFaceEmbeddings(
          detection.embedding,
          clusters[i].representativeEmbedding,
        );

        if (similarity >= threshold && similarity > bestSimilarity) {
          bestClusterIdx = i;
          bestSimilarity = similarity;
        }
      }

      if (bestClusterIdx >= 0) {
        // Add to existing cluster
        clusters[bestClusterIdx].detections.push(detection);
        // Update representative embedding (average)
        clusters[bestClusterIdx].representativeEmbedding = this.averageEmbeddings([
          clusters[bestClusterIdx].representativeEmbedding,
          detection.embedding,
        ]);
      } else {
        // Create new cluster
        clusters.push({
          detections: [detection],
          representativeEmbedding: detection.embedding,
        });
      }
    }

    // Check each cluster against stored identities
    for (const cluster of clusters) {
      const matches = await this.findMatchingIdentities(
        cluster.representativeEmbedding,
        threshold,
      );
      if (matches.length > 0 && matches[0].isMatch) {
        cluster.matchedIdentity = matches[0];
      }
    }

    this.logger.log(`Created ${clusters.length} clusters, ${unclusteredDetections.length} unclustered`);
    return { clusters, unclusteredDetections };
  }

  /**
   * Create a new face identity from detections
   */
  async createIdentity(input: {
    name?: string;
    detections: FaceDetectionResult[];
    sourceType: 'lora_training' | 'character_diagram' | 'reference_kit' | 'manual';
    sourceId?: string;
  }): Promise<FaceIdentity> {
    this.logger.log(`Creating new face identity: ${input.name || 'unnamed'}`);

    // Calculate representative embedding (average of all detections)
    const embeddings = input.detections
      .filter((d) => d.embedding)
      .map((d) => d.embedding!);

    if (embeddings.length === 0) {
      throw new Error('No embeddings available to create identity');
    }

    const representativeEmbedding = this.averageEmbeddings(embeddings);

    // Build angle coverage from detections
    const angleCoverage = this.buildAngleCoverage(input.detections);

    // Calculate confidence score
    const confidenceScore = this.calculateIdentityConfidence(input.detections);

    // Insert into database
    const { data, error } = await this.supabaseService.getClient()
      .from('face_identities')
      .insert({
        name: input.name,
        embedding: `[${representativeEmbedding.join(',')}]`,
        embedding_model: 'insightface',
        angle_coverage: angleCoverage,
        source_type: input.sourceType,
        source_id: input.sourceId,
        image_count: input.detections.length,
        angle_count: Object.keys(angleCoverage).length,
        confidence_score: confidenceScore,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Error creating identity: ${error.message}`);
      throw error;
    }

    this.logger.log(`Created identity: ${data.id}`);

    return this.mapDbIdentityToInterface(data);
  }

  /**
   * Update an existing identity with new detections
   */
  async updateIdentityWithDetections(
    identityId: string,
    newDetections: FaceDetectionResult[],
  ): Promise<FaceIdentity> {
    this.logger.log(`Updating identity ${identityId} with ${newDetections.length} new detections`);

    // Get existing identity
    const { data: existing, error: fetchError } = await this.supabaseService.getClient()
      .from('face_identities')
      .select('*')
      .eq('id', identityId)
      .single();

    if (fetchError || !existing) {
      throw new Error(`Identity not found: ${identityId}`);
    }

    // Combine embeddings
    const existingEmbedding = existing.embedding
      ? this.parseEmbedding(existing.embedding)
      : null;
    const newEmbeddings = newDetections
      .filter((d) => d.embedding)
      .map((d) => d.embedding!);

    const allEmbeddings = existingEmbedding
      ? [existingEmbedding, ...newEmbeddings]
      : newEmbeddings;

    const representativeEmbedding = this.averageEmbeddings(allEmbeddings);

    // Update angle coverage
    const existingCoverage = existing.angle_coverage || {};
    const newCoverage = this.buildAngleCoverage(newDetections);
    const mergedCoverage = this.mergeAngleCoverage(existingCoverage, newCoverage);

    // Update in database
    const { data, error } = await this.supabaseService.getClient()
      .from('face_identities')
      .update({
        embedding: `[${representativeEmbedding.join(',')}]`,
        angle_coverage: mergedCoverage,
        image_count: existing.image_count + newDetections.length,
        angle_count: Object.keys(mergedCoverage).length,
        updated_at: new Date().toISOString(),
      })
      .eq('id', identityId)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error updating identity: ${error.message}`);
      throw error;
    }

    return this.mapDbIdentityToInterface(data);
  }

  /**
   * Store face detections in the database
   */
  async storeDetections(
    detections: FaceDetectionResult[],
    sourceType: 'lora_training' | 'character_diagram' | 'reference_kit',
    sourceId: string,
    identityMap?: Map<FaceDetectionResult, string>, // detection -> identity_id
  ): Promise<string[]> {
    this.logger.log(`Storing ${detections.length} face detections`);

    const records = detections.map((d) => ({
      image_url: d.imageUrl,
      source_type: sourceType,
      source_id: sourceId,
      bbox: d.bbox,
      cropped_face_url: d.croppedFaceUrl,
      landmarks_2d: d.landmarks,
      embedding: d.embedding ? `[${d.embedding.join(',')}]` : null,
      matched_identity_id: identityMap?.get(d),
      is_primary: false, // Set separately
      quality_score: d.qualityScore,
      angle_estimate: d.angleEstimate,
      euler_angles: d.eulerAngles,
      detection_confidence: d.confidence,
      detector_model: 'insightface',
    }));

    const { data, error } = await this.supabaseService.getClient()
      .from('face_detections')
      .insert(records)
      .select('id');

    if (error) {
      this.logger.error(`Error storing detections: ${error.message}`);
      throw error;
    }

    return data.map((d: { id: string }) => d.id);
  }

  /**
   * Get all stored face identities
   */
  async listIdentities(): Promise<FaceIdentity[]> {
    const { data, error } = await this.supabaseService.getClient()
      .from('face_identities')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Error listing identities: ${error.message}`);
      throw error;
    }

    return (data || []).map((d: Record<string, unknown>) => this.mapDbIdentityToInterface(d));
  }

  /**
   * Get a specific identity by ID
   */
  async getIdentity(identityId: string): Promise<FaceIdentity | null> {
    const { data, error } = await this.supabaseService.getClient()
      .from('face_identities')
      .select('*')
      .eq('id', identityId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }

    return this.mapDbIdentityToInterface(data);
  }

  // ============================================
  // PRIVATE HELPER METHODS
  // ============================================

  private estimateAngleFromBbox(
    bbox: { x: number; y: number; width: number; height: number },
    imageWidth: number,
    imageHeight: number,
  ): 'front' | 'profile_left' | 'profile_right' | 'quarter_left' | 'quarter_right' | 'other' {
    // Simple heuristic based on face position and aspect ratio
    // In a real implementation, this would use euler angles from the detector
    const faceCenterX = bbox.x + bbox.width / 2;
    const imageCenter = imageWidth / 2;
    const relativePosition = (faceCenterX - imageCenter) / imageWidth;

    // Aspect ratio can indicate profile (narrower face)
    const aspectRatio = bbox.width / bbox.height;

    if (aspectRatio < 0.6) {
      // Very narrow - likely profile
      return relativePosition > 0.1 ? 'profile_right' : 'profile_left';
    } else if (aspectRatio < 0.8) {
      // Somewhat narrow - likely 3/4
      return relativePosition > 0.05 ? 'quarter_right' : 'quarter_left';
    }

    return 'front';
  }

  private estimateQualityScore(face: {
    confidence: number;
    bbox: { width: number; height: number };
  }): number {
    // Combine detection confidence with face size
    const sizeScore = Math.min(1, (face.bbox.width * face.bbox.height) / (300 * 300));
    return (face.confidence * 0.6 + sizeScore * 0.4);
  }

  private averageEmbeddings(embeddings: number[][]): number[] {
    if (embeddings.length === 0) return [];
    if (embeddings.length === 1) return embeddings[0];

    const dim = embeddings[0].length;
    const avg = new Array(dim).fill(0);

    for (const emb of embeddings) {
      for (let i = 0; i < dim; i++) {
        avg[i] += emb[i];
      }
    }

    for (let i = 0; i < dim; i++) {
      avg[i] /= embeddings.length;
    }

    // Normalize
    const norm = Math.sqrt(avg.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < dim; i++) {
        avg[i] /= norm;
      }
    }

    return avg;
  }

  private buildAngleCoverage(detections: FaceDetectionResult[]): AngleCoverage {
    const coverage: AngleCoverage = {};

    for (const d of detections) {
      if (!d.angleEstimate || d.angleEstimate === 'other') continue;

      const existing = coverage[d.angleEstimate];
      if (!existing || (d.qualityScore && d.qualityScore > existing.quality)) {
        coverage[d.angleEstimate] = {
          url: d.imageUrl,
          quality: d.qualityScore || d.confidence,
          detectionId: d.id,
        };
      }
    }

    return coverage;
  }

  private mergeAngleCoverage(
    existing: AngleCoverage,
    newCoverage: AngleCoverage,
  ): AngleCoverage {
    const merged = { ...existing };

    for (const [angle, data] of Object.entries(newCoverage)) {
      const key = angle as keyof AngleCoverage;
      if (!merged[key] || (data && data.quality > (merged[key]?.quality || 0))) {
        merged[key] = data;
      }
    }

    return merged;
  }

  private calculateIdentityConfidence(detections: FaceDetectionResult[]): number {
    if (detections.length === 0) return 0;

    // Base confidence on number of images and angle coverage
    const imageCountScore = Math.min(1, detections.length / 10); // Max at 10 images
    const avgQuality =
      detections.reduce((sum, d) => sum + (d.qualityScore || d.confidence), 0) /
      detections.length;

    const coverage = this.buildAngleCoverage(detections);
    const angleCountScore = Object.keys(coverage).length / 5; // Max at 5 angles

    return (imageCountScore * 0.3 + avgQuality * 0.4 + angleCountScore * 0.3);
  }

  private parseEmbedding(embeddingStr: string): number[] {
    // Parse PostgreSQL vector format [0.1,0.2,...]
    const match = embeddingStr.match(/\[([\d.,e+-]+)\]/);
    if (!match) return [];
    return match[1].split(',').map(Number);
  }

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
}
