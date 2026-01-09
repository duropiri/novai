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
  weights_url: string | null;
  config_url: string | null;
  thumbnail_url: string | null;
  cost_cents: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface DbCharacterDiagram {
  id: string;
  name: string;
  source_image_url: string | null;
  file_url: string | null;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  error_message: string | null;
  cost_cents: number | null;
  created_at: string;
  updated_at: string;
}

export interface DbCollection {
  id: string;
  name: string;
  type: 'video' | 'audio';
  created_at: string;
  updated_at: string;
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
  type: 'lora_training' | 'character_diagram' | 'face_swap' | 'variant';
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

@Injectable()
export class SupabaseService implements OnModuleInit {
  private client!: SupabaseClient;
  private readonly logger = new Logger(SupabaseService.name);
  private initialized = false;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      this.logger.warn('Supabase credentials not configured. Database operations will fail.');
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
    const { error } = await this.client.storage
      .from(bucket)
      .upload(path, file, {
        contentType,
        upsert: true,
      });

    if (error) {
      throw new Error(`Failed to upload file: ${error.message}`);
    }

    const { data: urlData } = this.client.storage
      .from(bucket)
      .getPublicUrl(path);

    return { url: urlData.publicUrl };
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

  async listVideos(options?: { type?: string; collectionId?: string }): Promise<DbVideo[]> {
    let query = this.client
      .from('videos')
      .select()
      .order('created_at', { ascending: false });

    if (options?.type) {
      query = query.eq('type', options.type);
    }
    if (options?.collectionId) {
      query = query.eq('collection_id', options.collectionId);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list videos: ${error.message}`);
    return data || [];
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

  async listCollections(type?: 'video' | 'audio'): Promise<DbCollection[]> {
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
}
