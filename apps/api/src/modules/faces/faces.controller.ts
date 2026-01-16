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
} from '@nestjs/common';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsNumber,
  IsIn,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FacesService } from './faces.service';
import { FaceIdentity, FaceDetectionResult } from '../../services/face-embedding.service';
import { MeshGenerationResult } from '../../services/face-3d.service';

// Request DTOs
export class DetectFacesRequestDto {
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  imageUrls!: string[];

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(1.0)
  @Type(() => Number)
  detectionThreshold?: number;
}

export class CreateIdentityRequestDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  detectionIds!: string[];

  @IsIn(['lora_training', 'character_diagram', 'reference_kit', 'manual'])
  sourceType!: 'lora_training' | 'character_diagram' | 'reference_kit' | 'manual';

  @IsOptional()
  @IsString()
  sourceId?: string;
}

export class ProcessImagesRequestDto {
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  imageUrls!: string[];

  @IsIn(['lora_training', 'character_diagram', 'reference_kit'])
  sourceType!: 'lora_training' | 'character_diagram' | 'reference_kit';

  @IsString()
  @IsNotEmpty()
  sourceId!: string;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(0.95)
  @Type(() => Number)
  matchThreshold?: number;
}

export class CompareEmbeddingsRequestDto {
  @IsArray()
  @IsNumber({}, { each: true })
  embedding1!: number[];

  @IsArray()
  @IsNumber({}, { each: true })
  embedding2!: number[];
}

// Response types
interface DetectFacesResponse {
  detections: FaceDetectionResult[];
  byImage: Record<string, FaceDetectionResult[]>;
  identityMatches: Array<{
    detection: FaceDetectionResult;
    matches: Array<{
      identityId: string;
      identityName?: string;
      similarity: number;
      isMatch: boolean;
    }>;
  }>;
}

interface ProcessImagesResponse {
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
}

@Controller('faces')
export class FacesController {
  constructor(private readonly facesService: FacesService) {}

  /**
   * Detect all faces in a set of images
   * Returns detections with embeddings and identity matches
   */
  @Post('detect')
  async detectFaces(@Body() dto: DetectFacesRequestDto): Promise<DetectFacesResponse> {
    if (!dto.imageUrls?.length) {
      throw new HttpException('At least one image URL is required', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.facesService.detectFaces(
        dto.imageUrls,
        dto.detectionThreshold,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to detect faces';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Process images for training - detect, cluster, and match identities
   * This is the main entry point for training image processing
   */
  @Post('process')
  async processImages(@Body() dto: ProcessImagesRequestDto): Promise<ProcessImagesResponse> {
    if (!dto.imageUrls?.length) {
      throw new HttpException('At least one image URL is required', HttpStatus.BAD_REQUEST);
    }

    if (!dto.sourceId?.trim()) {
      throw new HttpException('Source ID is required', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.facesService.processTrainingImages({
        imageUrls: dto.imageUrls,
        sourceType: dto.sourceType,
        sourceId: dto.sourceId.trim(),
        matchThreshold: dto.matchThreshold,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to process images';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Create a new face identity from detections
   */
  @Post('identity')
  async createIdentity(@Body() dto: CreateIdentityRequestDto): Promise<FaceIdentity> {
    if (!dto.detectionIds?.length) {
      throw new HttpException('At least one detection ID is required', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.facesService.createIdentityFromDetections({
        name: dto.name?.trim(),
        detectionIds: dto.detectionIds,
        sourceType: dto.sourceType,
        sourceId: dto.sourceId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create identity';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Generate 3D face mesh for an identity
   */
  @Post('identity/:id/mesh')
  async generateMesh(@Param('id') id: string): Promise<MeshGenerationResult | { skipped: true; reason: string }> {
    try {
      const result = await this.facesService.generateMeshForIdentity(id);
      if (!result) {
        return { skipped: true, reason: 'Insufficient angle coverage or mesh already exists' };
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate mesh';
      if (message.includes('not found')) {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Get all face identities
   */
  @Get('identities')
  async listIdentities(
    @Query('sourceType') sourceType?: string,
    @Query('sourceId') sourceId?: string,
  ): Promise<FaceIdentity[]> {
    try {
      return await this.facesService.listIdentities({ sourceType, sourceId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list identities';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Get a specific identity by ID
   */
  @Get('identity/:id')
  async getIdentity(@Param('id') id: string): Promise<FaceIdentity> {
    try {
      const identity = await this.facesService.getIdentity(id);
      if (!identity) {
        throw new HttpException('Identity not found', HttpStatus.NOT_FOUND);
      }
      return identity;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const message = error instanceof Error ? error.message : 'Failed to get identity';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Get detections for an identity
   */
  @Get('identity/:id/detections')
  async getIdentityDetections(@Param('id') id: string): Promise<FaceDetectionResult[]> {
    try {
      return await this.facesService.getDetectionsForIdentity(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get detections';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Update identity name
   */
  @Patch('identity/:id')
  async updateIdentity(
    @Param('id') id: string,
    @Body() body: { name?: string },
  ): Promise<FaceIdentity> {
    try {
      return await this.facesService.updateIdentityName(id, body.name?.trim());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update identity';
      if (message.includes('not found')) {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Delete an identity
   */
  @Delete('identity/:id')
  async deleteIdentity(@Param('id') id: string): Promise<{ success: boolean }> {
    try {
      await this.facesService.deleteIdentity(id);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete identity';
      if (message.includes('not found')) {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Find similar faces to a given embedding
   */
  @Post('search')
  async searchSimilar(
    @Body() body: {
      embedding: number[];
      threshold?: number;
      limit?: number;
    },
  ): Promise<Array<{ identityId: string; identityName?: string; similarity: number }>> {
    if (!body.embedding?.length) {
      throw new HttpException('Embedding is required', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.facesService.findSimilarFaces(
        body.embedding,
        body.threshold,
        body.limit,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to search faces';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Compare two face embeddings
   */
  @Post('compare')
  async compareEmbeddings(
    @Body() dto: CompareEmbeddingsRequestDto,
  ): Promise<{
    similarity: number;
    isMatch: boolean;
    confidence: 'high' | 'medium' | 'low';
  }> {
    if (!dto.embedding1?.length || !dto.embedding2?.length) {
      throw new HttpException('Both embeddings are required', HttpStatus.BAD_REQUEST);
    }

    try {
      return this.facesService.compareEmbeddings(dto.embedding1, dto.embedding2);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to compare embeddings';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Get angle coverage suggestions for an identity
   */
  @Get('identity/:id/suggestions')
  async getAngleSuggestions(
    @Param('id') id: string,
  ): Promise<{
    suggestions: string[];
    priority: 'high' | 'medium' | 'low';
    currentCoverage: string[];
    readyFor3D: boolean;
  }> {
    try {
      return await this.facesService.getAngleSuggestions(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get suggestions';
      if (message.includes('not found')) {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Set primary identity for a source (LoRA, character diagram, etc.)
   */
  @Post('set-primary')
  async setPrimaryIdentity(
    @Body() body: {
      sourceType: 'lora_training' | 'character_diagram' | 'reference_kit';
      sourceId: string;
      identityId: string;
    },
  ): Promise<{ success: boolean }> {
    if (!body.sourceId?.trim() || !body.identityId?.trim()) {
      throw new HttpException('Source ID and Identity ID are required', HttpStatus.BAD_REQUEST);
    }

    try {
      await this.facesService.setPrimaryIdentity(
        body.sourceType,
        body.sourceId.trim(),
        body.identityId.trim(),
      );
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to set primary identity';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Mark a detection as primary for training
   */
  @Post('detection/:id/primary')
  async markDetectionAsPrimary(@Param('id') id: string): Promise<{ success: boolean }> {
    try {
      await this.facesService.markDetectionAsPrimary(id);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to mark detection as primary';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
