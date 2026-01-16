import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ScanService,
  ScanSession,
  ScanCapture,
  CreateSessionDto,
  CreateCaptureDto,
  ExportToLoraDto,
  ExportToCharacterDto,
  ExportToReferenceKitDto,
  ExportToEmotionBoardDto,
} from './scan.service';

@Controller('scan')
export class ScanController {
  constructor(private readonly scanService: ScanService) {}

  /**
   * Create a new scan session
   */
  @Post('sessions')
  async createSession(
    @Body() dto: CreateSessionDto,
  ): Promise<ScanSession> {
    return this.scanService.createSession(dto);
  }

  /**
   * Get session by ID with captures
   */
  @Get('sessions/:id')
  async getSession(
    @Param('id') id: string,
  ): Promise<{ session: ScanSession; captures: ScanCapture[] }> {
    return this.scanService.getSessionWithCaptures(id);
  }

  /**
   * Get session by code (for phone connection)
   */
  @Get('sessions/code/:code')
  async getSessionByCode(
    @Param('code') code: string,
  ): Promise<ScanSession> {
    return this.scanService.getSessionByCode(code);
  }

  /**
   * Complete a session
   */
  @Post('sessions/:id/complete')
  async completeSession(
    @Param('id') id: string,
  ): Promise<ScanSession> {
    return this.scanService.completeSession(id);
  }

  /**
   * Delete a session
   */
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSession(@Param('id') id: string): Promise<void> {
    return this.scanService.deleteSession(id);
  }

  /**
   * Add a capture to a session
   */
  @Post('sessions/:id/captures')
  async addCapture(
    @Param('id') sessionId: string,
    @Body() dto: CreateCaptureDto,
  ): Promise<ScanCapture> {
    return this.scanService.addCapture(sessionId, dto);
  }

  /**
   * Toggle capture selection
   */
  @Patch('captures/:id')
  async updateCapture(
    @Param('id') captureId: string,
    @Body() body: { isSelected: boolean },
  ): Promise<void> {
    return this.scanService.toggleCaptureSelection(captureId, body.isSelected);
  }

  /**
   * Delete a capture
   */
  @Delete('captures/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCapture(@Param('id') captureId: string): Promise<void> {
    return this.scanService.deleteCapture(captureId);
  }

  /**
   * Get selected captures for export
   */
  @Get('sessions/:id/selected')
  async getSelectedCaptures(
    @Param('id') sessionId: string,
  ): Promise<ScanCapture[]> {
    return this.scanService.getSelectedCaptures(sessionId);
  }

  /**
   * Upload video recording for processing
   */
  @Post('sessions/:id/video')
  async uploadVideo(
    @Param('id') sessionId: string,
    @Body() body: { videoBase64: string; verificationNumbers: string[] },
  ): Promise<{ success: boolean; jobId: string }> {
    return this.scanService.processVideoUpload(
      sessionId,
      body.videoBase64,
      body.verificationNumbers,
    );
  }

  /**
   * List all sessions (for debugging)
   */
  @Get('sessions')
  async listSessions(): Promise<ScanSession[]> {
    return this.scanService.listSessions();
  }

  /**
   * Export scan captures to LoRA training
   */
  @Post('sessions/:id/export/lora')
  async exportToLora(
    @Param('id') sessionId: string,
    @Body() dto: ExportToLoraDto,
  ): Promise<{ loraId: string; jobId: string }> {
    return this.scanService.exportToLora(
      sessionId,
      dto.name,
      dto.triggerWord,
      {
        steps: dto.steps,
        learningRate: dto.learningRate,
        isStyle: dto.isStyle,
      },
    );
  }

  /**
   * Export scan capture to Character Diagram
   */
  @Post('sessions/:id/export/character')
  async exportToCharacter(
    @Param('id') sessionId: string,
    @Body() dto: ExportToCharacterDto,
  ): Promise<{ characterId: string; jobId: string }> {
    return this.scanService.exportToCharacter(sessionId, dto.name);
  }

  /**
   * Export scan captures to Reference Kit
   */
  @Post('sessions/:id/export/reference-kit')
  async exportToReferenceKit(
    @Param('id') sessionId: string,
    @Body() dto: ExportToReferenceKitDto,
  ): Promise<{ kitId: string; jobId: string }> {
    return this.scanService.exportToReferenceKit(sessionId, dto.name);
  }

  /**
   * Export scan captures to Emotion Board
   */
  @Post('sessions/:id/export/emotion-board')
  async exportToEmotionBoard(
    @Param('id') sessionId: string,
    @Body() dto: ExportToEmotionBoardDto,
  ): Promise<{ boardId: string; jobId: string }> {
    return this.scanService.exportToEmotionBoard(sessionId, dto.name);
  }
}
