import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Database types matching our schema
export interface DbLoraModel {
  id: string;
  name: string;
  trigger_word: string;
  status: 'pending' | 'training' | 'ready' | 'failed';
  training_images_url: string | null;
  training_steps: number;
  // Primary LoRA file for inference (high_noise_lora from WAN 2.2)
  lora_url: string | null;
  // DEPRECATED: Use lora_url instead. Kept for backward compatibility.
  weights_url: string | null;
  // Reference link to diffusers-format LoRA (not used for inference)
  diffusers_lora_url: string | null;
  config_url: string | null;
  thumbnail_url: string | null;
  cost_cents: number | null;
  error_message: string | null;
  // WAN 2.2 trainer fields
  trainer: 'flux-fast' | 'wan-22' | 'manual' | 'imported';
  learning_rate: number | null;
  is_style: boolean;
  progress: number | null;
  status_message: string | null;
  // Dataset analysis fields (Studio Reverse Engineering Engine)
  dataset_analysis?: Record<string, unknown> | null;
  applied_optimizations?: Record<string, unknown> | null;
  validation_result?: Record<string, unknown> | null;
  quality_score?: number | null;
  // HiRA (High Rank Adaptation) face identity fields
  primary_face_identity_id?: string | null;
  detected_faces?: Array<{
    detectionIds: string[];
    identityId?: string;
    faceCount: number;
    isPrimary: boolean;
  }> | null;
  // Timestamps
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface DbCharacterDiagram {
  id: string;
  name: string;
  source_image_url: string | null;
  file_url: string | null;
  // LoRA-based generation fields (optional - requires migration 00005)
  source_lora_id?: string | null;
  outfit_description?: string | null;
  background_description?: string | null;
  pose?: string | null;
  // Multi-image support (optional - requires migration 00011)
  image_count?: number;
  primary_image_url?: string | null;
  // Status
  status: 'pending' | 'processing' | 'ready' | 'failed';
  error_message: string | null;
  cost_cents: number | null;
  created_at: string;
  updated_at: string;
}

export interface DbCollection {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image';
  created_at: string;
  updated_at: string;
}

export interface DbImageCollectionItem {
  id: string;
  collection_id: string;
  source_type: string;
  source_id: string | null;
  image_url: string;
  thumbnail_url: string | null;
  name: string | null;
  created_at: string;
}

export interface DbVideo {
  id: string;
  name: string;
  type: 'source' | 'face_swapped' | 'variant';
  collection_id: string | null;
  parent_video_id: string | null;
  character_diagram_id: string | null;
  file_url: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  file_size_bytes: number | null;
  created_at: string;
  updated_at: string;
}

export interface DbAudioFile {
  id: string;
  name: string;
  collection_id: string | null;
  file_url: string;
  duration_seconds: number | null;
  file_size_bytes: number | null;
  created_at: string;
}

export interface DbHook {
  id: string;
  text: string;
  category: string | null;
  created_at: string;
}

export interface DbJob {
  id: string;
  type: 'lora_training' | 'character_diagram' | 'face_swap' | 'image_generation' | 'variant';
  reference_id: string;
  status: 'pending' | 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  external_request_id: string | null;
  external_status: string | null;
  input_payload: Record<string, unknown> | null;
  output_payload: Record<string, unknown> | null;
  error_message: string | null;
  cost_cents: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface DbReferenceKit {
  id: string;
  name: string;
  source_image_url: string;
  anchor_face_url: string | null;
  profile_url: string | null;
  half_body_url: string | null;
  full_body_url: string | null;
  expressions: Record<string, string>;
  // Multi-image support (optional - requires migration 00011)
  source_image_count?: number;
  uses_provided_images?: boolean;
  // Identity profile link (optional - requires migration 00013)
  identity_profile_id?: string | null;
  // Status
  status: 'pending' | 'generating' | 'ready' | 'failed';
  generation_progress: Record<string, string>;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbExpressionBoard {
  id: string;
  name: string | null;
  status: 'pending' | 'generating' | 'ready' | 'failed';
  source_type: 'image' | 'lora' | 'video' | 'zip' | 'character' | 'reference_kit';
  source_image_url: string | null;
  lora_id: string | null;
  character_diagram_id: string | null;
  reference_kit_id: string | null;
  grid_size: '2x4' | '2x8' | '4x8' | '5x8';
  board_types: string[];
  expressions: string[];
  subject_profile: Record<string, string> | null;
  board_url: string | null;
  cell_urls: Record<string, string> | null;
  progress: number;
  error_message: string | null;
  cost_cents: number | null;
  created_at: string;
  completed_at: string | null;
}

// ============================================
// IDENTITY PROFILE TYPES (migration 00013)
// ============================================

export interface DbCharacterAnalysisSession {
  id: string;
  character_diagram_id: string | null;
  reference_kit_id: string | null;
  name: string | null;
  status: 'pending' | 'processing' | 'analyzing' | 'aggregating' | 'ready' | 'failed';
  total_images: number;
  processed_images: number;
  valid_images: number;
  progress: number;
  analysis_mode: 'quick' | 'standard' | 'comprehensive';
  cost_limit_cents: number;
  error_message: string | null;
  total_cost_cents: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface DbCharacterImageAnalysis {
  id: string;
  session_id: string;
  image_url: string;
  image_hash: string | null;
  quality_score: number | null;
  blur_score: number | null;
  lighting_score: number | null;
  resolution_score: number | null;
  face_visibility_score: number | null;
  is_valid: boolean;
  rejection_reason: string | null;
  face_geometry: Record<string, unknown> | null;
  face_geometry_confidence: number | null;
  body_proportions: Record<string, unknown> | null;
  body_proportions_confidence: number | null;
  lighting_profile: Record<string, unknown> | null;
  lighting_confidence: number | null;
  camera_parameters: Record<string, unknown> | null;
  camera_confidence: number | null;
  style_fingerprint: Record<string, unknown> | null;
  style_confidence: number | null;
  expression_data: Record<string, unknown> | null;
  processing_time_ms: number | null;
  api_cost_cents: number;
  created_at: string;
}

export interface DbCharacterIdentityProfile {
  id: string;
  session_id: string | null;
  character_diagram_id: string | null;
  reference_kit_id: string | null;
  face_geometry_profile: Record<string, unknown> | null;
  face_sample_count: number;
  body_proportions_profile: Record<string, unknown> | null;
  body_sample_count: number;
  lighting_profile: Record<string, unknown> | null;
  lighting_sample_count: number;
  camera_profile: Record<string, unknown> | null;
  camera_sample_count: number;
  style_fingerprint: Record<string, unknown> | null;
  style_sample_count: number;
  overall_confidence: number | null;
  data_consistency_score: number | null;
  best_reference_image_url: string | null;
  image_quality_ranking: Array<{ url: string; score: number }> | null;
  analysis_model: string | null;
  analysis_version: string;
  total_cost_cents: number;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class SupabaseService implements OnModuleInit {
  private client!: SupabaseClient;
  private readonly logger = new Logger(SupabaseService.name);
  private initialized = false;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    // Check if credentials are missing or still placeholder values
    if (!supabaseUrl || !supabaseKey) {
      this.logger.warn('Supabase credentials not configured. Database operations will fail.');
      return;
    }

    // Check for placeholder values that indicate unconfigured state
    if (
      supabaseUrl.includes('your-project-id') ||
      supabaseUrl.includes('xxx') ||
      supabaseKey.includes('your-') ||
      supabaseKey === 'your-service-role-key-here' ||
      supabaseKey === 'your-anon-key-here'
    ) {
      this.logger.warn('Supabase credentials appear to be placeholder values. Please configure real credentials.');
      return;
    }

    this.client = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    this.initialized = true;
    this.logger.log('Supabase client initialized');
  }

  getClient(): SupabaseClient {
    if (!this.initialized || !this.client) {
      throw new Error('Supabase client not initialized. Check your environment variables.');
    }
    return this.client;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  // ============================================
  // STORAGE OPERATIONS
  // ============================================

  async uploadFile(
    bucket: string,
    path: string,
    file: Buffer,
    contentType: string,
  ): Promise<{ url: string }> {
    const sizeMb = file.length / (1024 * 1024);
    this.logger.log(`[Upload] Bucket: ${bucket}, Path: ${path}, Size: ${sizeMb.toFixed(2)}MB, Type: ${contentType}`);

    let uploadBuffer = file;

    // Compress video if too large (>45MB to leave margin for 50MB limit)
    if (contentType.startsWith('video/') && sizeMb > 45) {
      this.logger.log(`[Upload] Video too large (${sizeMb.toFixed(2)}MB), compressing...`);
      try {
        uploadBuffer = await this.compressVideoBuffer(file, 45);
        const newSizeMb = uploadBuffer.length / (1024 * 1024);
        this.logger.log(`[Upload] Compressed: ${sizeMb.toFixed(2)}MB -> ${newSizeMb.toFixed(2)}MB`);
      } catch (compressError) {
        this.logger.warn(`[Upload] Compression failed, trying original: ${compressError}`);
      }
    }

    const { error } = await this.client.storage
      .from(bucket)
      .upload(path, uploadBuffer, {
        contentType,
        upsert: true,
      });

    if (error) {
      this.logger.error(`[Upload] FAILED - Bucket: ${bucket}, Size: ${(uploadBuffer.length / 1024 / 1024).toFixed(2)}MB, Error: ${error.message}`);
      throw new Error(`Failed to upload file: ${error.message}`);
    }

    const { data: urlData } = this.client.storage
      .from(bucket)
      .getPublicUrl(path);

    this.logger.log(`[Upload] SUCCESS - ${path}`);
    return { url: urlData.publicUrl };
  }

  /**
   * Compress a video buffer using ffmpeg
   * Writes to temp file, compresses, reads back
   */
  private async compressVideoBuffer(input: Buffer, targetSizeMb: number): Promise<Buffer> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    // Create temp files
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-compress-'));
    const inputPath = path.join(tempDir, 'input.mp4');
    const outputPath = path.join(tempDir, 'output.mp4');

    try {
      // Write input buffer to temp file
      await fs.writeFile(inputPath, input);

      // Get video duration
      const { stdout: durationOut } = await execAsync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`,
      );
      const duration = parseFloat(durationOut.trim()) || 10;

      // Calculate target bitrate (kbps)
      const targetBitrate = Math.floor((targetSizeMb * 1024 * 8) / duration);
      this.logger.log(`[Compress] Duration: ${duration.toFixed(1)}s, Target bitrate: ${targetBitrate}kbps`);

      // Compress with ffmpeg
      await execAsync(
        `ffmpeg -y -i "${inputPath}" -c:v libx264 -b:v ${targetBitrate}k -maxrate ${Math.floor(targetBitrate * 1.5)}k -bufsize ${targetBitrate * 2}k -c:a aac -b:a 128k -movflags +faststart "${outputPath}"`,
      );

      // Read compressed file back to buffer
      const compressedBuffer = await fs.readFile(outputPath);
      return compressedBuffer;
    } finally {
      // Cleanup temp directory
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  async getSignedUrl(
    bucket: string,
    path: string,
    expiresIn = 3600,
  ): Promise<string> {
    const { data, error } = await this.client.storage
      .from(bucket)
      .createSignedUrl(path, expiresIn);

    if (error) {
      throw new Error(`Failed to get signed URL: ${error.message}`);
    }

    return data.signedUrl;
  }

  async deleteFile(bucket: string, path: string): Promise<void> {
    const { error } = await this.client.storage.from(bucket).remove([path]);

    if (error) {
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  }

  async downloadFile(bucket: string, path: string): Promise<Buffer> {
    const { data, error } = await this.client.storage
      .from(bucket)
      .download(path);

    if (error) {
      throw new Error(`Failed to download file: ${error.message}`);
    }

    return Buffer.from(await data.arrayBuffer());
  }

  // ============================================
  // DATABASE OPERATIONS - JOBS
  // ============================================

  async createJob(job: Omit<DbJob, 'id' | 'created_at' | 'started_at' | 'completed_at'>): Promise<DbJob> {
    const { data, error } = await this.client
      .from('jobs')
      .insert(job)
      .select()
      .single();

    if (error) throw new Error(`Failed to create job: ${error.message}`);
    return data;
  }

  async getJob(id: string): Promise<DbJob | null> {
    const { data, error } = await this.client
      .from('jobs')
      .select()
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get job: ${error.message}`);
    }
    return data;
  }

  async updateJob(id: string, update: Partial<DbJob>): Promise<DbJob> {
    const { data, error } = await this.client
      .from('jobs')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update job: ${error.message}`);
    return data;
  }

  async listJobs(options?: { type?: string; limit?: number }): Promise<DbJob[]> {
    let query = this.client
      .from('jobs')
      .select()
      .order('created_at', { ascending: false });

    if (options?.type) {
      query = query.eq('type', options.type);
    }
    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list jobs: ${error.message}`);
    return data || [];
  }

  async deleteJob(id: string): Promise<void> {
    const { error } = await this.client
      .from('jobs')
      .delete()
      .eq('id', id);

    if (error) throw new Error(`Failed to delete job: ${error.message}`);
  }

  // ============================================
  // DATABASE OPERATIONS - LORA MODELS
  // ============================================

  async createLoraModel(model: Omit<DbLoraModel, 'id' | 'created_at' | 'updated_at' | 'completed_at'>): Promise<DbLoraModel> {
    const { data, error } = await this.client
      .from('lora_models')
      .insert(model)
      .select()
      .single();

    if (error) throw new Error(`Failed to create LoRA model: ${error.message}`);
    return data;
  }

  async getLoraModel(id: string): Promise<DbLoraModel | null> {
    const { data, error } = await this.client
      .from('lora_models')
      .select()
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get LoRA model: ${error.message}`);
    }
    return data;
  }

  async updateLoraModel(id: string, update: Partial<DbLoraModel>): Promise<DbLoraModel> {
    const { data, error } = await this.client
      .from('lora_models')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update LoRA model: ${error.message}`);
    return data;
  }

  async listLoraModels(status?: string): Promise<DbLoraModel[]> {
    let query = this.client
      .from('lora_models')
      .select()
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list LoRA models: ${error.message}`);
    return data || [];
  }

  // ============================================
  // DATABASE OPERATIONS - CHARACTER DIAGRAMS
  // ============================================

  async createCharacterDiagram(diagram: Omit<DbCharacterDiagram, 'id' | 'created_at' | 'updated_at'>): Promise<DbCharacterDiagram> {
    const { data, error } = await this.client
      .from('character_diagrams')
      .insert(diagram)
      .select()
      .single();

    if (error) throw new Error(`Failed to create character diagram: ${error.message}`);
    return data;
  }

  async getCharacterDiagram(id: string): Promise<DbCharacterDiagram | null> {
    const { data, error } = await this.client
      .from('character_diagrams')
      .select()
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get character diagram: ${error.message}`);
    }
    return data;
  }

  async updateCharacterDiagram(id: string, update: Partial<DbCharacterDiagram>): Promise<DbCharacterDiagram> {
    const { data, error } = await this.client
      .from('character_diagrams')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update character diagram: ${error.message}`);
    return data;
  }

  async listCharacterDiagrams(status?: string): Promise<DbCharacterDiagram[]> {
    let query = this.client
      .from('character_diagrams')
      .select()
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list character diagrams: ${error.message}`);
    return data || [];
  }

  // ============================================
  // DATABASE OPERATIONS - VIDEOS
  // ============================================

  async createVideo(video: Omit<DbVideo, 'id' | 'created_at' | 'updated_at'>): Promise<DbVideo> {
    const { data, error } = await this.client
      .from('videos')
      .insert(video)
      .select()
      .single();

    if (error) throw new Error(`Failed to create video: ${error.message}`);
    return data;
  }

  async getVideo(id: string): Promise<DbVideo | null> {
    const { data, error } = await this.client
      .from('videos')
      .select()
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get video: ${error.message}`);
    }
    return data;
  }

  async listVideos(options?: { type?: string; collectionId?: string | null; uncategorized?: boolean }): Promise<DbVideo[]> {
    let query = this.client
      .from('videos')
      .select()
      .order('created_at', { ascending: false });

    if (options?.type) {
      query = query.eq('type', options.type);
    }
    if (options?.uncategorized) {
      // Filter for videos without a collection
      query = query.is('collection_id', null);
    } else if (options?.collectionId) {
      query = query.eq('collection_id', options.collectionId);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list videos: ${error.message}`);
    return data || [];
  }

  async countVideos(options?: { collectionId?: string | null; uncategorized?: boolean }): Promise<number> {
    let query = this.client
      .from('videos')
      .select('*', { count: 'exact', head: true });

    if (options?.uncategorized) {
      query = query.is('collection_id', null);
    } else if (options?.collectionId) {
      query = query.eq('collection_id', options.collectionId);
    }

    const { count, error } = await query;
    if (error) throw new Error(`Failed to count videos: ${error.message}`);
    return count || 0;
  }

  async updateVideo(id: string, update: Partial<DbVideo>): Promise<DbVideo> {
    const { data, error } = await this.client
      .from('videos')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update video: ${error.message}`);
    return data;
  }

  async deleteVideo(id: string): Promise<void> {
    const { error } = await this.client
      .from('videos')
      .delete()
      .eq('id', id);

    if (error) throw new Error(`Failed to delete video: ${error.message}`);
  }

  // ============================================
  // DATABASE OPERATIONS - COLLECTIONS
  // ============================================

  async createCollection(collection: Omit<DbCollection, 'id' | 'created_at' | 'updated_at'>): Promise<DbCollection> {
    const { data, error } = await this.client
      .from('collections')
      .insert(collection)
      .select()
      .single();

    if (error) throw new Error(`Failed to create collection: ${error.message}`);
    return data;
  }

  async getCollection(id: string): Promise<DbCollection | null> {
    const { data, error } = await this.client
      .from('collections')
      .select()
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get collection: ${error.message}`);
    }
    return data;
  }

  async updateCollection(id: string, update: Partial<DbCollection>): Promise<DbCollection> {
    const { data, error } = await this.client
      .from('collections')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update collection: ${error.message}`);
    return data;
  }

  async deleteCollection(id: string): Promise<void> {
    const { error } = await this.client
      .from('collections')
      .delete()
      .eq('id', id);

    if (error) throw new Error(`Failed to delete collection: ${error.message}`);
  }

  async listCollections(type?: 'video' | 'audio' | 'image'): Promise<DbCollection[]> {
    let query = this.client
      .from('collections')
      .select()
      .order('created_at', { ascending: false });

    if (type) {
      query = query.eq('type', type);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list collections: ${error.message}`);
    return data || [];
  }

  // ============================================
  // DATABASE OPERATIONS - AUDIO FILES
  // ============================================

  async createAudioFile(audio: Omit<DbAudioFile, 'id' | 'created_at'>): Promise<DbAudioFile> {
    const { data, error } = await this.client
      .from('audio_files')
      .insert(audio)
      .select()
      .single();

    if (error) throw new Error(`Failed to create audio file: ${error.message}`);
    return data;
  }

  async getAudioFile(id: string): Promise<DbAudioFile | null> {
    const { data, error } = await this.client
      .from('audio_files')
      .select()
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get audio file: ${error.message}`);
    }
    return data;
  }

  async listAudioFiles(collectionId?: string): Promise<DbAudioFile[]> {
    let query = this.client
      .from('audio_files')
      .select()
      .order('created_at', { ascending: false });

    if (collectionId) {
      query = query.eq('collection_id', collectionId);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list audio files: ${error.message}`);
    return data || [];
  }

  async updateAudioFile(id: string, updates: Partial<Pick<DbAudioFile, 'name' | 'collection_id'>>): Promise<DbAudioFile> {
    const { data, error } = await this.client
      .from('audio_files')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update audio file: ${error.message}`);
    return data;
  }

  async deleteAudioFile(id: string): Promise<void> {
    const { error } = await this.client
      .from('audio_files')
      .delete()
      .eq('id', id);

    if (error) throw new Error(`Failed to delete audio file: ${error.message}`);
  }

  // ============================================
  // DATABASE OPERATIONS - HOOKS
  // ============================================

  async createHook(hook: Omit<DbHook, 'id' | 'created_at'>): Promise<DbHook> {
    const { data, error } = await this.client
      .from('hooks')
      .insert(hook)
      .select()
      .single();

    if (error) throw new Error(`Failed to create hook: ${error.message}`);
    return data;
  }

  async getHook(id: string): Promise<DbHook | null> {
    const { data, error } = await this.client
      .from('hooks')
      .select()
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get hook: ${error.message}`);
    }
    return data;
  }

  async updateHook(id: string, updates: Partial<Pick<DbHook, 'text' | 'category'>>): Promise<DbHook> {
    const { data, error } = await this.client
      .from('hooks')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update hook: ${error.message}`);
    return data;
  }

  async listHooks(category?: string): Promise<DbHook[]> {
    let query = this.client
      .from('hooks')
      .select()
      .order('created_at', { ascending: false });

    if (category) {
      query = query.eq('category', category);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list hooks: ${error.message}`);
    return data || [];
  }

  async deleteHook(id: string): Promise<void> {
    const { error } = await this.client
      .from('hooks')
      .delete()
      .eq('id', id);

    if (error) throw new Error(`Failed to delete hook: ${error.message}`);
  }

  // ============================================
  // COST TRACKING
  // ============================================

  async recordCost(jobId: string, jobType: string, amountCents: number, description?: string): Promise<void> {
    const { error } = await this.client
      .from('cost_records')
      .insert({
        job_id: jobId,
        job_type: jobType,
        amount_cents: amountCents,
        description,
      });

    if (error) throw new Error(`Failed to record cost: ${error.message}`);
  }

  async getTodayCost(): Promise<number> {
    const { data, error } = await this.client.rpc('get_today_cost_cents');
    if (error) throw new Error(`Failed to get today's cost: ${error.message}`);
    return data || 0;
  }

  async checkCostLimit(limitCents: number): Promise<boolean> {
    const todayCost = await this.getTodayCost();
    return todayCost < limitCents;
  }

  // ============================================
  // STATS & DASHBOARD
  // ============================================

  async getStorageStats(): Promise<{
    videos: { count: number; totalSizeBytes: number };
    audio: { count: number; totalSizeBytes: number };
    loraModels: { count: number };
    characterDiagrams: { count: number };
    hooks: { count: number };
    collections: { video: number; audio: number };
  }> {
    // Get video stats
    const { data: videoData } = await this.client
      .from('videos')
      .select('file_size_bytes');
    const videos = {
      count: videoData?.length || 0,
      totalSizeBytes: videoData?.reduce((sum, v) => sum + (v.file_size_bytes || 0), 0) || 0,
    };

    // Get audio stats
    const { data: audioData } = await this.client
      .from('audio_files')
      .select('file_size_bytes');
    const audio = {
      count: audioData?.length || 0,
      totalSizeBytes: audioData?.reduce((sum, a) => sum + (a.file_size_bytes || 0), 0) || 0,
    };

    // Get LoRA model count
    const { count: loraCount } = await this.client
      .from('lora_models')
      .select('*', { count: 'exact', head: true });

    // Get character diagram count
    const { count: diagramCount } = await this.client
      .from('character_diagrams')
      .select('*', { count: 'exact', head: true });

    // Get hooks count
    const { count: hooksCount } = await this.client
      .from('hooks')
      .select('*', { count: 'exact', head: true });

    // Get collections by type
    const { data: collectionData } = await this.client
      .from('collections')
      .select('type');
    const videoCollections = collectionData?.filter(c => c.type === 'video').length || 0;
    const audioCollections = collectionData?.filter(c => c.type === 'audio').length || 0;

    return {
      videos,
      audio,
      loraModels: { count: loraCount || 0 },
      characterDiagrams: { count: diagramCount || 0 },
      hooks: { count: hooksCount || 0 },
      collections: { video: videoCollections, audio: audioCollections },
    };
  }

  async getCostsByPeriod(startDate: Date, endDate: Date): Promise<{
    total: number;
    byType: Record<string, number>;
  }> {
    const { data } = await this.client
      .from('cost_records')
      .select('job_type, amount_cents')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    const total = data?.reduce((sum, r) => sum + r.amount_cents, 0) || 0;
    const byType: Record<string, number> = {};

    for (const record of data || []) {
      byType[record.job_type] = (byType[record.job_type] || 0) + record.amount_cents;
    }

    return { total, byType };
  }

  async getActiveJobs(): Promise<DbJob[]> {
    const { data, error } = await this.client
      .from('jobs')
      .select()
      .in('status', ['pending', 'queued', 'processing'])
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to get active jobs: ${error.message}`);
    return data || [];
  }

  async getRecentJobs(limit = 10): Promise<DbJob[]> {
    const { data, error } = await this.client
      .from('jobs')
      .select()
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Failed to get recent jobs: ${error.message}`);
    return data || [];
  }

  // --- Image Collection Items ---

  async createImageCollectionItem(
    item: Omit<DbImageCollectionItem, 'id' | 'created_at'>,
  ): Promise<DbImageCollectionItem> {
    const { data, error } = await this.client
      .from('image_collection_items')
      .insert(item)
      .select()
      .single();

    if (error) throw new Error(`Failed to create image collection item: ${error.message}`);
    return data;
  }

  async listImageCollectionItems(collectionId: string): Promise<DbImageCollectionItem[]> {
    const { data, error } = await this.client
      .from('image_collection_items')
      .select()
      .eq('collection_id', collectionId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to list image collection items: ${error.message}`);
    return data || [];
  }

  async deleteImageCollectionItem(id: string): Promise<void> {
    const { error } = await this.client
      .from('image_collection_items')
      .delete()
      .eq('id', id);

    if (error) throw new Error(`Failed to delete image collection item: ${error.message}`);
  }

  // ============================================
  // DATABASE OPERATIONS - REFERENCE KITS
  // ============================================

  async createReferenceKit(
    kit: Omit<DbReferenceKit, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<DbReferenceKit> {
    const { data, error } = await this.client
      .from('reference_kits')
      .insert(kit)
      .select()
      .single();

    if (error) throw new Error(`Failed to create reference kit: ${error.message}`);
    return data;
  }

  async getReferenceKit(id: string): Promise<DbReferenceKit | null> {
    const { data, error } = await this.client
      .from('reference_kits')
      .select()
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get reference kit: ${error.message}`);
    }
    return data;
  }

  async updateReferenceKit(id: string, update: Partial<DbReferenceKit>): Promise<DbReferenceKit> {
    const { data, error } = await this.client
      .from('reference_kits')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update reference kit: ${error.message}`);
    return data;
  }

  async listReferenceKits(status?: string): Promise<DbReferenceKit[]> {
    let query = this.client
      .from('reference_kits')
      .select()
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list reference kits: ${error.message}`);
    return data || [];
  }

  async deleteReferenceKit(id: string): Promise<void> {
    const { error } = await this.client
      .from('reference_kits')
      .delete()
      .eq('id', id);

    if (error) throw new Error(`Failed to delete reference kit: ${error.message}`);
  }

  // ============================================
  // DATABASE OPERATIONS - EXPRESSION BOARDS
  // ============================================

  async getExpressionBoard(id: string): Promise<DbExpressionBoard | null> {
    const { data, error } = await this.client
      .from('expression_boards')
      .select()
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get expression board: ${error.message}`);
    }
    return data;
  }

  async listExpressionBoards(status?: string): Promise<DbExpressionBoard[]> {
    let query = this.client
      .from('expression_boards')
      .select()
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list expression boards: ${error.message}`);
    return data || [];
  }

  // ============================================
  // DATABASE OPERATIONS - IDENTITY PROFILES
  // ============================================

  async createAnalysisSession(
    session: Omit<DbCharacterAnalysisSession, 'id' | 'created_at' | 'updated_at' | 'completed_at'>,
  ): Promise<DbCharacterAnalysisSession> {
    const { data, error } = await this.client
      .from('character_analysis_sessions')
      .insert(session)
      .select()
      .single();

    if (error) throw new Error(`Failed to create analysis session: ${error.message}`);
    return data;
  }

  async getAnalysisSession(id: string): Promise<DbCharacterAnalysisSession | null> {
    const { data, error } = await this.client
      .from('character_analysis_sessions')
      .select()
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get analysis session: ${error.message}`);
    }
    return data;
  }

  async updateAnalysisSession(
    id: string,
    update: Partial<DbCharacterAnalysisSession>,
  ): Promise<DbCharacterAnalysisSession> {
    const { data, error } = await this.client
      .from('character_analysis_sessions')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update analysis session: ${error.message}`);
    return data;
  }

  async getAnalysisSessionByDiagram(diagramId: string): Promise<DbCharacterAnalysisSession | null> {
    const { data, error } = await this.client
      .from('character_analysis_sessions')
      .select()
      .eq('character_diagram_id', diagramId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get analysis session: ${error.message}`);
    }
    return data;
  }

  async createImageAnalysis(
    analysis: Omit<DbCharacterImageAnalysis, 'id' | 'created_at'>,
  ): Promise<DbCharacterImageAnalysis> {
    const { data, error } = await this.client
      .from('character_image_analyses')
      .insert(analysis)
      .select()
      .single();

    if (error) throw new Error(`Failed to create image analysis: ${error.message}`);
    return data;
  }

  async createImageAnalysesBatch(
    analyses: Array<Omit<DbCharacterImageAnalysis, 'id' | 'created_at'>>,
  ): Promise<DbCharacterImageAnalysis[]> {
    const { data, error } = await this.client
      .from('character_image_analyses')
      .insert(analyses)
      .select();

    if (error) throw new Error(`Failed to create image analyses: ${error.message}`);
    return data || [];
  }

  async getImageAnalysesBySession(sessionId: string): Promise<DbCharacterImageAnalysis[]> {
    const { data, error } = await this.client
      .from('character_image_analyses')
      .select()
      .eq('session_id', sessionId)
      .order('quality_score', { ascending: false });

    if (error) throw new Error(`Failed to get image analyses: ${error.message}`);
    return data || [];
  }

  async getValidImageAnalysesBySession(sessionId: string): Promise<DbCharacterImageAnalysis[]> {
    const { data, error } = await this.client
      .from('character_image_analyses')
      .select()
      .eq('session_id', sessionId)
      .eq('is_valid', true)
      .order('quality_score', { ascending: false });

    if (error) throw new Error(`Failed to get valid image analyses: ${error.message}`);
    return data || [];
  }

  async createIdentityProfile(
    profile: Omit<DbCharacterIdentityProfile, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<DbCharacterIdentityProfile> {
    const { data, error } = await this.client
      .from('character_identity_profiles')
      .insert(profile)
      .select()
      .single();

    if (error) throw new Error(`Failed to create identity profile: ${error.message}`);
    return data;
  }

  async getIdentityProfile(id: string): Promise<DbCharacterIdentityProfile | null> {
    const { data, error } = await this.client
      .from('character_identity_profiles')
      .select()
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get identity profile: ${error.message}`);
    }
    return data;
  }

  async getIdentityProfileByDiagram(diagramId: string): Promise<DbCharacterIdentityProfile | null> {
    const { data, error } = await this.client
      .from('character_identity_profiles')
      .select()
      .eq('character_diagram_id', diagramId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get identity profile: ${error.message}`);
    }
    return data;
  }

  async getIdentityProfileByReferenceKit(kitId: string): Promise<DbCharacterIdentityProfile | null> {
    const { data, error } = await this.client
      .from('character_identity_profiles')
      .select()
      .eq('reference_kit_id', kitId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get identity profile: ${error.message}`);
    }
    return data;
  }

  async updateIdentityProfile(
    id: string,
    update: Partial<DbCharacterIdentityProfile>,
  ): Promise<DbCharacterIdentityProfile> {
    const { data, error } = await this.client
      .from('character_identity_profiles')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update identity profile: ${error.message}`);
    return data;
  }

  async deleteIdentityProfile(id: string): Promise<void> {
    const { error } = await this.client
      .from('character_identity_profiles')
      .delete()
      .eq('id', id);

    if (error) throw new Error(`Failed to delete identity profile: ${error.message}`);
  }

  // ============================================
  // CHARACTER DIAGRAM IMAGES (multi-image support)
  // ============================================

  async getCharacterDiagramImages(diagramId: string): Promise<
    Array<{
      id: string;
      image_url: string;
      image_type: string;
      is_primary: boolean;
      sort_order: number;
    }>
  > {
    const { data, error } = await this.client
      .from('character_diagram_images')
      .select('id, image_url, image_type, is_primary, sort_order')
      .eq('character_diagram_id', diagramId)
      .order('sort_order', { ascending: true });

    if (error) throw new Error(`Failed to get character diagram images: ${error.message}`);
    return data || [];
  }
}
