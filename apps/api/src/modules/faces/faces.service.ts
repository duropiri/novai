import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../files/supabase.service';
import {
  FaceEmbeddingService,
  FaceDetectionResult,
  FaceIdentity,
  IdentityMatch,
  AngleCoverage,
} from '../../services/face-embedding.service';
import {
  Face3DService,
  MeshGenerationResult,
} from '../../services/face-3d.service';
import { FalService } from '../../services/fal.service';

@Injectable()
export class FacesService {
  private readonly logger = new Logger(FacesService.name);

  // Default similarity threshold for identity matching
  private readonly MATCH_THRESHOLD = 0.7;

  constructor(
    private readonly faceEmbeddingService: FaceEmbeddingService,
    private readonly face3DService: Face3DService,
    private readonly falService: FalService,
    private readonly supabaseService: SupabaseService,
  ) {}

  /**
   * Detect faces in multiple images and check against stored identities
   */
  async detectFaces(
    imageUrls: string[],
    detectionThreshold?: number,
  ): Promise<{
    detections: FaceDetectionResult[];
    byImage: Record<string, FaceDetectionResult[]>;
    identityMatches: Array<{
      detection: FaceDetectionResult;
      matches: IdentityMatch[];
    }>;
  }> {
    this.logger.log(`Detecting faces in ${imageUrls.length} images`);

    // Detect faces in all images
    const { detections, byImage } = await this.faceEmbeddingService.detectFacesInImages(imageUrls);

    // Check each face against stored identities
    const identityMatches: Array<{
      detection: FaceDetectionResult;
      matches: IdentityMatch[];
    }> = [];

    for (const detection of detections) {
      if (detection.embedding) {
        const matches = await this.faceEmbeddingService.findMatchingIdentities(
          detection.embedding,
          detectionThreshold || this.MATCH_THRESHOLD,
        );
        identityMatches.push({ detection, matches });
      }
    }

    // Convert Map to Record for JSON serialization
    const byImageRecord: Record<string, FaceDetectionResult[]> = {};
    byImage.forEach((value, key) => {
      byImageRecord[key] = value;
    });

    return { detections, byImage: byImageRecord, identityMatches };
  }

  /**
   * Process training images - detect faces, cluster by identity, store detections
   */
  async processTrainingImages(input: {
    imageUrls: string[];
    sourceType: 'lora_training' | 'character_diagram' | 'reference_kit';
    sourceId: string;
    matchThreshold?: number;
  }): Promise<{
    totalFaces: number;
    clusters: Array<{
      clusterIndex: number;
      faceCount: number;
      matchedIdentity?: {
        id: string;
        name?: string;
        similarity: number;
      };
      detectionIds: string[];
    }>;
    newIdentities: FaceIdentity[];
    angleCoverage: Record<string, { angle: string; quality: number; imageUrl: string }[]>;
  }> {
    this.logger.log(`Processing ${input.imageUrls.length} training images for ${input.sourceType}:${input.sourceId}`);

    // Step 1: Detect all faces
    const { detections, byImage } = await this.faceEmbeddingService.detectFacesInImages(input.imageUrls);
    this.logger.log(`Detected ${detections.length} total faces`);

    // Step 2: Cluster faces by identity
    const { clusters, unclusteredDetections } = await this.faceEmbeddingService.clusterFacesByIdentity(
      detections,
      input.matchThreshold || this.MATCH_THRESHOLD,
    );

    this.logger.log(`Created ${clusters.length} clusters, ${unclusteredDetections.length} unclustered`);

    // Step 3: Create identities for new clusters (those without matches)
    const newIdentities: FaceIdentity[] = [];
    const clusterResults: Array<{
      clusterIndex: number;
      faceCount: number;
      matchedIdentity?: { id: string; name?: string; similarity: number };
      detectionIds: string[];
    }> = [];

    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];

      // Store detections for this cluster
      const identityMap = new Map<FaceDetectionResult, string>();

      if (cluster.matchedIdentity?.isMatch) {
        // Use existing identity
        cluster.detections.forEach((d) => identityMap.set(d, cluster.matchedIdentity!.identityId));

        // Update existing identity with new detections
        await this.faceEmbeddingService.updateIdentityWithDetections(
          cluster.matchedIdentity.identityId,
          cluster.detections,
        );
      } else {
        // Create new identity for this cluster
        const newIdentity = await this.faceEmbeddingService.createIdentity({
          detections: cluster.detections,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
        });
        newIdentities.push(newIdentity);
        cluster.detections.forEach((d) => identityMap.set(d, newIdentity.id));
      }

      // Store detections in database
      const detectionIds = await this.faceEmbeddingService.storeDetections(
        cluster.detections,
        input.sourceType,
        input.sourceId,
        identityMap,
      );

      clusterResults.push({
        clusterIndex: i,
        faceCount: cluster.detections.length,
        matchedIdentity: cluster.matchedIdentity?.isMatch
          ? {
              id: cluster.matchedIdentity.identityId,
              name: cluster.matchedIdentity.identityName,
              similarity: cluster.matchedIdentity.similarity,
            }
          : undefined,
        detectionIds,
      });
    }

    // Step 4: Calculate angle coverage per cluster
    const angleCoverage: Record<string, { angle: string; quality: number; imageUrl: string }[]> = {};

    for (const cluster of clusters) {
      const coverage = this.face3DService.collectAngleImages(cluster.detections);
      const clusterId = cluster.matchedIdentity?.identityId || 'new';

      angleCoverage[clusterId] = Object.entries(coverage)
        .filter(([, url]) => url)
        .map(([angle, url]) => ({
          angle,
          quality: cluster.detections.find((d) => d.imageUrl === url)?.qualityScore || 0.5,
          imageUrl: url!,
        }));
    }

    return {
      totalFaces: detections.length,
      clusters: clusterResults,
      newIdentities,
      angleCoverage,
    };
  }

  /**
   * Create identity from existing detections
   */
  async createIdentityFromDetections(input: {
    name?: string;
    detectionIds: string[];
    sourceType: 'lora_training' | 'character_diagram' | 'reference_kit' | 'manual';
    sourceId?: string;
  }): Promise<FaceIdentity> {
    this.logger.log(`Creating identity from ${input.detectionIds.length} detections`);

    // Fetch detections from database
    const { data: detections, error } = await this.supabaseService.getClient()
      .from('face_detections')
      .select('*')
      .in('id', input.detectionIds);

    if (error || !detections?.length) {
      throw new Error('Detections not found');
    }

    // Convert to FaceDetectionResult format
    const detectionResults: FaceDetectionResult[] = detections.map((d: Record<string, unknown>) => ({
      id: d.id as string,
      imageUrl: d.image_url as string,
      bbox: d.bbox as { x: number; y: number; width: number; height: number },
      confidence: d.detection_confidence as number || 0.9,
      embedding: d.embedding ? this.parseEmbedding(d.embedding as string) : undefined,
      croppedFaceUrl: d.cropped_face_url as string | undefined,
      qualityScore: d.quality_score as number | undefined,
      angleEstimate: d.angle_estimate as FaceDetectionResult['angleEstimate'],
      eulerAngles: d.euler_angles as { pitch: number; yaw: number; roll: number } | undefined,
    }));

    // Create identity
    return this.faceEmbeddingService.createIdentity({
      name: input.name,
      detections: detectionResults,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    });
  }

  /**
   * Generate 3D mesh for an identity
   */
  async generateMeshForIdentity(identityId: string): Promise<MeshGenerationResult | null> {
    return this.face3DService.generateMeshForIdentity(identityId);
  }

  /**
   * List all face identities
   */
  async listIdentities(filters?: {
    sourceType?: string;
    sourceId?: string;
  }): Promise<FaceIdentity[]> {
    return this.faceEmbeddingService.listIdentities();
  }

  /**
   * Get a specific identity
   */
  async getIdentity(identityId: string): Promise<FaceIdentity | null> {
    return this.faceEmbeddingService.getIdentity(identityId);
  }

  /**
   * Get detections for an identity
   */
  async getDetectionsForIdentity(identityId: string): Promise<FaceDetectionResult[]> {
    const { data, error } = await this.supabaseService.getClient()
      .from('face_detections')
      .select('*')
      .eq('matched_identity_id', identityId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return (data || []).map((d: Record<string, unknown>) => ({
      id: d.id as string,
      imageUrl: d.image_url as string,
      bbox: d.bbox as { x: number; y: number; width: number; height: number },
      confidence: d.detection_confidence as number || 0.9,
      embedding: d.embedding ? this.parseEmbedding(d.embedding as string) : undefined,
      croppedFaceUrl: d.cropped_face_url as string | undefined,
      qualityScore: d.quality_score as number | undefined,
      angleEstimate: d.angle_estimate as FaceDetectionResult['angleEstimate'],
      eulerAngles: d.euler_angles as { pitch: number; yaw: number; roll: number } | undefined,
    }));
  }

  /**
   * Update identity name
   */
  async updateIdentityName(identityId: string, name?: string): Promise<FaceIdentity> {
    const { data, error } = await this.supabaseService.getClient()
      .from('face_identities')
      .update({ name, updated_at: new Date().toISOString() })
      .eq('id', identityId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') throw new Error('Identity not found');
      throw error;
    }

    return this.mapDbIdentityToInterface(data);
  }

  /**
   * Delete an identity
   */
  async deleteIdentity(identityId: string): Promise<void> {
    // First unlink detections
    await this.supabaseService.getClient()
      .from('face_detections')
      .update({ matched_identity_id: null })
      .eq('matched_identity_id', identityId);

    // Then delete identity
    const { error } = await this.supabaseService.getClient()
      .from('face_identities')
      .delete()
      .eq('id', identityId);

    if (error) throw error;
  }

  /**
   * Find similar faces to a given embedding
   */
  async findSimilarFaces(
    embedding: number[],
    threshold?: number,
    limit?: number,
  ): Promise<Array<{ identityId: string; identityName?: string; similarity: number }>> {
    const matches = await this.faceEmbeddingService.findMatchingIdentities(
      embedding,
      threshold || this.MATCH_THRESHOLD,
    );

    return matches.slice(0, limit || 10).map((m) => ({
      identityId: m.identityId,
      identityName: m.identityName,
      similarity: m.similarity,
    }));
  }

  /**
   * Compare two face embeddings
   */
  compareEmbeddings(
    embedding1: number[],
    embedding2: number[],
  ): {
    similarity: number;
    isMatch: boolean;
    confidence: 'high' | 'medium' | 'low';
  } {
    const similarity = this.falService.compareFaceEmbeddings(embedding1, embedding2);
    const isMatch = similarity >= this.MATCH_THRESHOLD;

    let confidence: 'high' | 'medium' | 'low';
    if (similarity >= 0.85 || similarity <= 0.4) {
      confidence = 'high';
    } else if (similarity >= 0.7 || similarity <= 0.55) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    return { similarity, isMatch, confidence };
  }

  /**
   * Get angle suggestions for an identity
   */
  async getAngleSuggestions(identityId: string): Promise<{
    suggestions: string[];
    priority: 'high' | 'medium' | 'low';
    currentCoverage: string[];
    readyFor3D: boolean;
  }> {
    const identity = await this.getIdentity(identityId);
    if (!identity) {
      throw new Error('Identity not found');
    }

    const coverage = identity.angleCoverage || {};
    const { suggestions, priority } = this.face3DService.suggestAdditionalAngles(coverage);
    const { meetsRequirements } = this.face3DService.checkAngleCoverage(coverage);

    const currentCoverage = Object.keys(coverage).filter(
      (key) => coverage[key as keyof AngleCoverage],
    );

    return {
      suggestions,
      priority,
      currentCoverage,
      readyFor3D: meetsRequirements,
    };
  }

  /**
   * Set primary identity for a source entity
   */
  async setPrimaryIdentity(
    sourceType: 'lora_training' | 'character_diagram' | 'reference_kit',
    sourceId: string,
    identityId: string,
  ): Promise<void> {
    // Determine which table to update based on source type
    const tableMap: Record<string, string> = {
      lora_training: 'lora_models',
      character_diagram: 'character_diagrams',
      reference_kit: 'reference_kits',
    };

    const table = tableMap[sourceType];
    if (!table) {
      throw new Error(`Invalid source type: ${sourceType}`);
    }

    const { error } = await this.supabaseService.getClient()
      .from(table)
      .update({ primary_face_identity_id: identityId })
      .eq('id', sourceId);

    if (error) throw error;
  }

  /**
   * Mark a detection as primary for training
   */
  async markDetectionAsPrimary(detectionId: string): Promise<void> {
    // Get the detection to find source info
    const { data: detection, error: fetchError } = await this.supabaseService.getClient()
      .from('face_detections')
      .select('source_type, source_id')
      .eq('id', detectionId)
      .single();

    if (fetchError || !detection) {
      throw new Error('Detection not found');
    }

    // Unmark all other detections for this source as non-primary
    await this.supabaseService.getClient()
      .from('face_detections')
      .update({ is_primary: false })
      .eq('source_type', detection.source_type)
      .eq('source_id', detection.source_id);

    // Mark this detection as primary
    const { error } = await this.supabaseService.getClient()
      .from('face_detections')
      .update({ is_primary: true })
      .eq('id', detectionId);

    if (error) throw error;
  }

  /**
   * Parse PostgreSQL vector format
   */
  private parseEmbedding(embeddingStr: string): number[] {
    const match = embeddingStr.match(/\[([\d.,e+-]+)\]/);
    if (!match) return [];
    return match[1].split(',').map(Number);
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
      skullVectors: data.skull_vectors as FaceIdentity['skullVectors'],
      angleCoverage: data.angle_coverage as FaceIdentity['angleCoverage'],
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
