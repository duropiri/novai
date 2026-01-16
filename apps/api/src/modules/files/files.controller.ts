import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
  Body,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FilesService, STORAGE_BUCKETS, FileMetadata } from './files.service';

@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload/:bucket')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @Param('bucket') bucket: keyof typeof STORAGE_BUCKETS,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<FileMetadata> {
    if (!file) {
      throw new Error('No file uploaded');
    }

    return this.filesService.uploadFile(
      bucket,
      file.buffer,
      file.originalname,
      file.mimetype,
    );
  }

  @Get(':id')
  async getFile(@Param('id') id: string): Promise<FileMetadata | { error: string }> {
    const file = this.filesService.getFile(id);
    if (!file) {
      return { error: 'File not found' };
    }
    return file;
  }

  @Get(':id/url')
  async getFileUrl(
    @Param('id') id: string,
    @Query('signed') signed?: string,
  ): Promise<{ url: string }> {
    const url = await this.filesService.getFileUrl(id, signed === 'true');
    return { url };
  }

  @Delete(':id')
  async deleteFile(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.filesService.deleteFile(id);
    return { success: true };
  }

  /**
   * Extract frames from an uploaded video file
   * Returns array of image URLs for use in training
   */
  @Post('extract-frames')
  @UseInterceptors(FileInterceptor('video'))
  async extractFrames(
    @UploadedFile() video: Express.Multer.File,
    @Query('maxFrames') maxFrames?: string,
    @Query('targetFps') targetFps?: string,
  ): Promise<{ frames: string[]; count: number }> {
    if (!video) {
      throw new Error('No video file uploaded');
    }

    const frames = await this.filesService.extractFramesFromVideo(
      video.buffer,
      maxFrames ? parseInt(maxFrames, 10) : 50,
      targetFps ? parseFloat(targetFps) : 1,
    );

    return { frames, count: frames.length };
  }

  /**
   * Import images and video frames from a Google Drive folder
   * Folder must be publicly shared
   * Returns both individual image URLs and a ZIP URL for direct training use
   */
  @Post('import-gdrive')
  async importFromGoogleDrive(
    @Body('folderUrl') folderUrl: string,
    @Body('maxFramesPerVideo') maxFramesPerVideo?: number,
    @Body('createZip') createZip?: boolean,
  ): Promise<{ images: string[]; count: number; zipUrl?: string }> {
    if (!folderUrl) {
      throw new Error('Google Drive folder URL is required');
    }

    const images = await this.filesService.downloadGoogleDriveFolder(
      folderUrl,
      maxFramesPerVideo || 50,
    );

    // Optionally create a ZIP for direct training use
    let zipUrl: string | undefined;
    if (createZip !== false && images.length > 0) {
      zipUrl = await this.filesService.createZipFromUrls(images, 'gdrive-import');
    }

    return { images, count: images.length, zipUrl };
  }
}
