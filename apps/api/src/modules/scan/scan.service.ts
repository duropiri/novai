import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomBytes } from 'crypto';
import { SupabaseService } from '../files/supabase.service';
import { FFmpegService } from '../../services/ffmpeg.service';

export interface ScanSession {
  id: string;
  session_code: string;
  session_secret: string;
  status: 'pending' | 'connected' | 'scanning' | 'completed' | 'expired';
  desktop_connected_at: string | null;
  phone_connected_at: string | null;
  last_heartbeat_at: string | null;
  target_angles: string[];
  auto_capture_enabled: boolean;
  captured_angles: Record<string, { url: string; quality: number }>;
  total_captures: number;
  name: string | null;
  expires_at: string;
  created_at: string;
  completed_at: string | null;
}

export interface ScanCapture {
  id: string;
  session_id: string;
  image_url: string;
  thumbnail_url: string | null;
  detected_angle: string | null;
  euler_angles: { pitch: number; yaw: number; roll: number } | null;
  quality_score: number | null;
  blur_score: number | null;
  face_confidence: number | null;
  bbox: { x: number; y: number; w: number; h: number } | null;
  is_selected: boolean;
  is_auto_captured: boolean;
  captured_at: string;
}

export interface CreateSessionDto {
  name?: string;
  targetAngles?: string[];
  autoCaptureEnabled?: boolean;
  expiryMinutes?: number;
}

export interface CreateCaptureDto {
  imageBase64: string;
  detectedAngle?: string;
  eulerAngles?: { pitch: number; yaw: number; roll: number };
  qualityScore?: number;
  blurScore?: number;
  faceConfidence?: number;
  bbox?: { x: number; y: number; w: number; h: number };
  isAutoCaptured?: boolean;
}

export interface ExportToLoraDto {
  name: string;
  triggerWord: string;
  steps?: number;
  learningRate?: number;
  isStyle?: boolean;
}

export interface ExportToCharacterDto {
  name: string;
}

export interface ExportToReferenceKitDto {
  name: string;
}

export interface ExportToEmotionBoardDto {
  name: string;
}

const DEFAULT_ANGLES = [
  'front',
  'profile_left',
  'profile_right',
  'quarter_left',
  'quarter_right',
  'up',
  'down',
  'smile',
];

@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly ffmpeg: FFmpegService,
    @InjectQueue('scan-video') private readonly scanVideoQueue: Queue,
    @InjectQueue('lora-training') private readonly loraQueue: Queue,
    @InjectQueue('character-diagram') private readonly characterQueue: Queue,
    @InjectQueue('reference-kit') private readonly referenceKitQueue: Queue,
    @InjectQueue('expression-board') private readonly expressionBoardQueue: Queue,
  ) {}

  /**
   * Generate a random session code (8 alphanumeric characters)
   */
  private generateSessionCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed ambiguous: 0, O, 1, I
    let code = '';
    const bytes = randomBytes(8);
    for (let i = 0; i < 8; i++) {
      code += chars[bytes[i] % chars.length];
    }
    return code;
  }

  /**
   * Generate a random session secret (64 hex characters)
   */
  private generateSessionSecret(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Create a new scan session
   */
  async createSession(dto: CreateSessionDto = {}): Promise<ScanSession> {
    const sessionCode = this.generateSessionCode();
    const sessionSecret = this.generateSessionSecret();
    const expiryMinutes = dto.expiryMinutes ?? 30;
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString();

    const { data, error } = await this.supabase.getClient()
      .from('phone_scan_sessions')
      .insert({
        session_code: sessionCode,
        session_secret: sessionSecret,
        name: dto.name || null,
        target_angles: dto.targetAngles || DEFAULT_ANGLES,
        auto_capture_enabled: dto.autoCaptureEnabled ?? true,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to create scan session', error);
      throw new BadRequestException('Failed to create scan session');
    }

    this.logger.log(`Created scan session ${data.id} with code ${sessionCode}`);
    return data;
  }

  /**
   * Get session by ID
   */
  async getSession(id: string): Promise<ScanSession> {
    const { data, error } = await this.supabase.getClient()
      .from('phone_scan_sessions')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Scan session ${id} not found`);
    }

    return data;
  }

  /**
   * Get session by code (for phone connection)
   */
  async getSessionByCode(code: string): Promise<ScanSession> {
    const { data, error } = await this.supabase.getClient()
      .from('phone_scan_sessions')
      .select('*')
      .eq('session_code', code.toUpperCase())
      .single();

    if (error || !data) {
      throw new NotFoundException('Invalid session code');
    }

    // Check if expired
    if (new Date(data.expires_at) < new Date()) {
      await this.updateSessionStatus(data.id, 'expired');
      throw new BadRequestException('Session has expired');
    }

    // Check if already completed
    if (data.status === 'completed' || data.status === 'expired') {
      throw new BadRequestException('Session is no longer active');
    }

    return data;
  }

  /**
   * Get session with captures
   */
  async getSessionWithCaptures(id: string): Promise<{ session: ScanSession; captures: ScanCapture[] }> {
    const session = await this.getSession(id);

    const { data: captures, error } = await this.supabase.getClient()
      .from('phone_scan_captures')
      .select('*')
      .eq('session_id', id)
      .order('captured_at', { ascending: true });

    if (error) {
      this.logger.error('Failed to get captures', error);
      throw new BadRequestException('Failed to get captures');
    }

    return { session, captures: captures || [] };
  }

  /**
   * Update session status
   */
  async updateSessionStatus(
    id: string,
    status: 'pending' | 'connected' | 'scanning' | 'completed' | 'expired',
  ): Promise<void> {
    const updates: Record<string, unknown> = { status };

    if (status === 'connected') {
      updates.phone_connected_at = new Date().toISOString();
    } else if (status === 'completed') {
      updates.completed_at = new Date().toISOString();
    }

    await this.supabase.getClient()
      .from('phone_scan_sessions')
      .update(updates)
      .eq('id', id);
  }

  /**
   * Update desktop connection timestamp
   */
  async markDesktopConnected(id: string): Promise<void> {
    await this.supabase.getClient()
      .from('phone_scan_sessions')
      .update({ desktop_connected_at: new Date().toISOString() })
      .eq('id', id);
  }

  /**
   * Update heartbeat timestamp
   */
  async updateHeartbeat(id: string): Promise<void> {
    await this.supabase.getClient()
      .from('phone_scan_sessions')
      .update({ last_heartbeat_at: new Date().toISOString() })
      .eq('id', id);
  }

  /**
   * Add a capture to a session
   */
  async addCapture(sessionId: string, dto: CreateCaptureDto): Promise<ScanCapture> {
    const session = await this.getSession(sessionId);

    if (session.status === 'completed' || session.status === 'expired') {
      throw new BadRequestException('Session is no longer active');
    }

    // Upload image to storage
    const imageBuffer = Buffer.from(dto.imageBase64, 'base64');
    const timestamp = Date.now();
    const imagePath = `scan-captures/${sessionId}/${dto.detectedAngle || 'unknown'}_${timestamp}.jpg`;

    const { url } = await this.supabase.uploadFile(
      'character-images', // Using character-images bucket for now
      imagePath,
      imageBuffer,
      'image/jpeg',
    );

    // Create capture record
    const { data, error } = await this.supabase.getClient()
      .from('phone_scan_captures')
      .insert({
        session_id: sessionId,
        image_url: url,
        detected_angle: dto.detectedAngle || null,
        euler_angles: dto.eulerAngles || null,
        quality_score: dto.qualityScore || null,
        blur_score: dto.blurScore || null,
        face_confidence: dto.faceConfidence || null,
        bbox: dto.bbox || null,
        is_auto_captured: dto.isAutoCaptured ?? true,
      })
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to create capture', error);
      throw new BadRequestException('Failed to create capture');
    }

    // Update session captured_angles and total_captures
    const capturedAngles = { ...session.captured_angles };
    if (dto.detectedAngle) {
      capturedAngles[dto.detectedAngle] = {
        url,
        quality: dto.qualityScore || 0,
      };
    }

    await this.supabase.getClient()
      .from('phone_scan_sessions')
      .update({
        captured_angles: capturedAngles,
        total_captures: session.total_captures + 1,
        status: 'scanning',
      })
      .eq('id', sessionId);

    this.logger.log(`Added capture to session ${sessionId}: ${dto.detectedAngle || 'unknown'}`);
    return data;
  }

  /**
   * Toggle capture selection
   */
  async toggleCaptureSelection(captureId: string, isSelected: boolean): Promise<void> {
    const { error } = await this.supabase.getClient()
      .from('phone_scan_captures')
      .update({ is_selected: isSelected })
      .eq('id', captureId);

    if (error) {
      throw new BadRequestException('Failed to update capture');
    }
  }

  /**
   * Delete a capture
   */
  async deleteCapture(captureId: string): Promise<void> {
    // Get capture first to update session
    const { data: capture, error: fetchError } = await this.supabase.getClient()
      .from('phone_scan_captures')
      .select('*')
      .eq('id', captureId)
      .single();

    if (fetchError || !capture) {
      throw new NotFoundException('Capture not found');
    }

    // Delete from database
    const { error } = await this.supabase.getClient()
      .from('phone_scan_captures')
      .delete()
      .eq('id', captureId);

    if (error) {
      throw new BadRequestException('Failed to delete capture');
    }

    // Update session total_captures
    await this.supabase.getClient()
      .from('phone_scan_sessions')
      .update({
        total_captures: Math.max(0, (await this.getSession(capture.session_id)).total_captures - 1),
      })
      .eq('id', capture.session_id);
  }

  /**
   * Delete a session and all its captures
   */
  async deleteSession(id: string): Promise<void> {
    const { error } = await this.supabase.getClient()
      .from('phone_scan_sessions')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error('Failed to delete session', error);
      throw new BadRequestException('Failed to delete session');
    }

    this.logger.log(`Deleted scan session ${id}`);
  }

  /**
   * Complete a session
   */
  async completeSession(id: string): Promise<ScanSession> {
    await this.updateSessionStatus(id, 'completed');
    return this.getSession(id);
  }

  /**
   * Get selected captures for a session (for export)
   */
  async getSelectedCaptures(sessionId: string): Promise<ScanCapture[]> {
    const { data, error } = await this.supabase.getClient()
      .from('phone_scan_captures')
      .select('*')
      .eq('session_id', sessionId)
      .eq('is_selected', true)
      .order('captured_at', { ascending: true });

    if (error) {
      throw new BadRequestException('Failed to get captures');
    }

    return data || [];
  }

  /**
   * List all sessions (for admin/debugging)
   */
  async listSessions(limit = 50): Promise<ScanSession[]> {
    const { data, error } = await this.supabase.getClient()
      .from('phone_scan_sessions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new BadRequestException('Failed to list sessions');
    }

    return data || [];
  }

  /**
   * Cleanup expired sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    const { data, error } = await this.supabase.getClient()
      .from('phone_scan_sessions')
      .update({ status: 'expired' })
      .lt('expires_at', new Date().toISOString())
      .not('status', 'in', '("completed","expired")')
      .select();

    if (error) {
      this.logger.error('Failed to cleanup expired sessions', error);
      return 0;
    }

    return data?.length || 0;
  }

  /**
   * Process video upload from phone
   * Uploads video and queues background job for frame extraction
   */
  async processVideoUpload(
    sessionId: string,
    videoBase64: string,
    verificationNumbers: string[],
  ): Promise<{ success: boolean; jobId: string }> {
    const session = await this.getSession(sessionId);

    if (session.status === 'completed' || session.status === 'expired') {
      throw new BadRequestException('Session is no longer active');
    }

    this.logger.log(`Processing video upload for session ${sessionId}`);
    this.logger.log(`Verification numbers: ${verificationNumbers.join(', ')}`);

    // Upload video to storage
    const videoBuffer = Buffer.from(videoBase64, 'base64');
    const timestamp = Date.now();
    const videoPath = `scan-videos/${sessionId}/recording_${timestamp}.webm`;

    const { url: videoUrl } = await this.supabase.uploadFile(
      'character-images',
      videoPath,
      videoBuffer,
      'video/webm',
    );

    this.logger.log(`Video uploaded to ${videoUrl}`);

    // Update session status to processing
    await this.supabase.getClient()
      .from('phone_scan_sessions')
      .update({
        status: 'scanning',
        captured_angles: {
          ...session.captured_angles,
          _video: { url: videoUrl, verificationNumbers },
        },
      })
      .eq('id', sessionId);

    // Queue background job to extract frames and analyze
    const job = await this.scanVideoQueue.add('process-scan-video', {
      sessionId,
      videoUrl,
      verificationNumbers,
    });

    this.logger.log(`Queued scan video processing job ${job.id} for session ${sessionId}`);

    return {
      success: true,
      jobId: job.id as string,
    };
  }

  /**
   * Export scan captures to LoRA training
   * Creates a ZIP of selected images and starts LoRA training
   */
  async exportToLora(
    sessionId: string,
    name: string,
    triggerWord: string,
    options: {
      steps?: number;
      learningRate?: number;
      isStyle?: boolean;
    } = {},
  ): Promise<{ loraId: string; jobId: string }> {
    const captures = await this.getSelectedCaptures(sessionId);

    if (captures.length < 5) {
      throw new BadRequestException('At least 5 captures are required for LoRA training');
    }

    const imageUrls = captures.map(c => c.image_url);

    // Create ZIP of training images
    const zipUrl = await this.ffmpeg.createTrainingZip(
      imageUrls,
      `lora-training/${sessionId}`,
    );

    this.logger.log(`Created training ZIP: ${zipUrl}`);

    // Create LoRA record in database
    const { data: lora, error } = await this.supabase.getClient()
      .from('lora_models')
      .insert({
        name,
        trigger_word: triggerWord,
        training_images_url: zipUrl,
        training_steps: options.steps || 1000,
        learning_rate: options.learningRate || 0.0007,
        is_style: options.isStyle || false,
        trainer: 'wan-22',
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      throw new BadRequestException('Failed to create LoRA record');
    }

    // Queue LoRA training job
    const job = await this.loraQueue.add('train-lora', {
      loraId: lora.id,
      imagesZipUrl: zipUrl,
      steps: options.steps || 1000,
      learningRate: options.learningRate || 0.0007,
      isStyle: options.isStyle || false,
    });

    this.logger.log(`Queued LoRA training job ${job.id} for scan session ${sessionId}`);

    return {
      loraId: lora.id,
      jobId: job.id as string,
    };
  }

  /**
   * Export scan capture to Character Diagram
   * Uses the best front-facing image
   */
  async exportToCharacter(
    sessionId: string,
    name: string,
  ): Promise<{ characterId: string; jobId: string }> {
    const captures = await this.getSelectedCaptures(sessionId);

    // Find best front-facing capture
    const frontCapture = captures.find(c => c.detected_angle === 'front') ||
                         captures.find(c => c.detected_angle?.includes('quarter')) ||
                         captures[0];

    if (!frontCapture) {
      throw new BadRequestException('No captures available for character diagram');
    }

    // Create character record
    const { data: character, error } = await this.supabase.getClient()
      .from('character_diagrams')
      .insert({
        name,
        source_image_url: frontCapture.image_url,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      throw new BadRequestException('Failed to create character diagram record');
    }

    // Queue character diagram job
    const job = await this.characterQueue.add('generate-diagram', {
      characterId: character.id,
      sourceImageUrl: frontCapture.image_url,
    });

    this.logger.log(`Queued character diagram job ${job.id} for scan session ${sessionId}`);

    return {
      characterId: character.id,
      jobId: job.id as string,
    };
  }

  /**
   * Export scan captures to Reference Kit
   */
  async exportToReferenceKit(
    sessionId: string,
    name: string,
  ): Promise<{ kitId: string; jobId: string }> {
    const captures = await this.getSelectedCaptures(sessionId);

    if (captures.length < 3) {
      throw new BadRequestException('At least 3 captures are required for a reference kit');
    }

    // Find best captures for different angles
    const findBest = (angles: string[]) =>
      captures.find(c => angles.includes(c.detected_angle || ''));

    const primaryCapture = findBest(['front', 'quarter_left', 'quarter_right']) || captures[0];

    // Create reference kit record
    const { data: kit, error } = await this.supabase.getClient()
      .from('reference_kits')
      .insert({
        name,
        primary_image_url: primaryCapture.image_url,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      throw new BadRequestException('Failed to create reference kit record');
    }

    // Add reference images
    const referenceImages = captures.map(c => ({
      kit_id: kit.id,
      image_url: c.image_url,
      angle: c.detected_angle || 'unknown',
      is_primary: c.id === primaryCapture.id,
    }));

    await this.supabase.getClient()
      .from('reference_kit_images')
      .insert(referenceImages);

    // Queue reference kit processing job
    const job = await this.referenceKitQueue.add('process-kit', {
      kitId: kit.id,
    });

    this.logger.log(`Queued reference kit job ${job.id} for scan session ${sessionId}`);

    return {
      kitId: kit.id,
      jobId: job.id as string,
    };
  }

  /**
   * Export scan captures to Emotion Board
   */
  async exportToEmotionBoard(
    sessionId: string,
    name: string,
  ): Promise<{ boardId: string; jobId: string }> {
    const captures = await this.getSelectedCaptures(sessionId);

    if (captures.length < 1) {
      throw new BadRequestException('At least 1 capture is required for an emotion board');
    }

    // Find best front-facing capture as source
    const sourceCapture = captures.find(c => c.detected_angle === 'front') ||
                          captures.find(c => c.detected_angle?.includes('quarter')) ||
                          captures[0];

    // Create emotion board record
    const { data: board, error } = await this.supabase.getClient()
      .from('expression_boards')
      .insert({
        name,
        source_image_url: sourceCapture.image_url,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      throw new BadRequestException('Failed to create emotion board record');
    }

    // Queue emotion board processing job
    const job = await this.expressionBoardQueue.add('generate-board', {
      boardId: board.id,
      sourceImageUrl: sourceCapture.image_url,
    });

    this.logger.log(`Queued emotion board job ${job.id} for scan session ${sessionId}`);

    return {
      boardId: board.id,
      jobId: job.id as string,
    };
  }
}
