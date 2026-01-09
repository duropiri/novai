import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { LoraService, CreateLoraDto } from './lora.service';
import { DbLoraModel } from '../files/supabase.service';

class CreateLoraRequestDto {
  name!: string;
  triggerWord!: string;
  imagesZipUrl!: string;
  steps?: number;
}

@Controller('lora')
export class LoraController {
  constructor(private readonly loraService: LoraService) {}

  @Post()
  async create(@Body() dto: CreateLoraRequestDto): Promise<DbLoraModel> {
    if (!dto.name?.trim()) {
      throw new HttpException('Name is required', HttpStatus.BAD_REQUEST);
    }
    if (!dto.triggerWord?.trim()) {
      throw new HttpException('Trigger word is required', HttpStatus.BAD_REQUEST);
    }
    if (!dto.imagesZipUrl?.trim()) {
      throw new HttpException('Images ZIP URL is required', HttpStatus.BAD_REQUEST);
    }

    const createDto: CreateLoraDto = {
      name: dto.name.trim(),
      triggerWord: dto.triggerWord.trim().toLowerCase(),
      imagesZipUrl: dto.imagesZipUrl.trim(),
      steps: dto.steps,
    };

    // Validate steps if provided
    if (createDto.steps !== undefined) {
      if (createDto.steps < 100 || createDto.steps > 10000) {
        throw new HttpException(
          'Steps must be between 100 and 10000',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    try {
      return await this.loraService.create(createDto);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create LoRA';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('upload')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'file', maxCount: 1 },
      { name: 'thumbnail', maxCount: 1 },
    ]),
  )
  async upload(
    @UploadedFiles()
    files: {
      file?: Express.Multer.File[];
      thumbnail?: Express.Multer.File[];
    },
    @Body() body: { name?: string; triggerWord?: string },
  ): Promise<DbLoraModel> {
    // Validate required file
    if (!files.file || files.file.length === 0) {
      throw new HttpException(
        'A .safetensors file is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const weightsFile = files.file[0];

    // Validate file extension
    if (!weightsFile.originalname.endsWith('.safetensors')) {
      throw new HttpException(
        'File must be a .safetensors file',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate required fields
    if (!body.name?.trim()) {
      throw new HttpException('Name is required', HttpStatus.BAD_REQUEST);
    }
    if (!body.triggerWord?.trim()) {
      throw new HttpException('Trigger word is required', HttpStatus.BAD_REQUEST);
    }

    const thumbnailFile = files.thumbnail?.[0];

    try {
      return await this.loraService.uploadManual({
        name: body.name.trim(),
        triggerWord: body.triggerWord.trim().toLowerCase(),
        weightsBuffer: weightsFile.buffer,
        weightsFileName: weightsFile.originalname,
        thumbnailBuffer: thumbnailFile?.buffer,
        thumbnailFileName: thumbnailFile?.originalname,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload LoRA';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get()
  async findAll(@Query('status') status?: string): Promise<DbLoraModel[]> {
    const validStatuses = ['pending', 'training', 'ready', 'failed'];
    if (status && !validStatuses.includes(status)) {
      throw new HttpException(
        `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.loraService.findAll(status);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<DbLoraModel> {
    const model = await this.loraService.findOne(id);
    if (!model) {
      throw new HttpException('LoRA model not found', HttpStatus.NOT_FOUND);
    }
    return model;
  }

  @Delete(':id')
  async delete(@Param('id') id: string): Promise<{ success: boolean }> {
    try {
      await this.loraService.delete(id);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete LoRA';
      if (message === 'LoRA model not found') {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      if (message.includes('Cannot delete')) {
        throw new HttpException(message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
