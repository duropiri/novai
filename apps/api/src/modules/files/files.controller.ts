import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
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
}
