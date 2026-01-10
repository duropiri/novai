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
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsString, IsOptional, IsNotEmpty, IsUUID } from 'class-validator';
import {
  CharacterService,
  CreateCharacterDiagramDto,
  CreateCharacterDiagramFromLoraDto,
} from './character.service';
import { DbCharacterDiagram } from '../files/supabase.service';
import { FilesService } from '../files/files.service';

class CreateCharacterRequestDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsNotEmpty()
  sourceImageUrl!: string;
}

class CreateCharacterFromLoraRequestDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsUUID()
  @IsNotEmpty()
  loraId!: string;
}

class UpdateCharacterRequestDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}

@Controller('characters')
export class CharacterController {
  constructor(
    private readonly characterService: CharacterService,
    private readonly filesService: FilesService,
  ) {}

  @Post()
  async create(@Body() dto: CreateCharacterRequestDto): Promise<DbCharacterDiagram> {
    if (!dto.sourceImageUrl?.trim()) {
      throw new HttpException('Source image URL is required', HttpStatus.BAD_REQUEST);
    }

    const createDto: CreateCharacterDiagramDto = {
      name: dto.name?.trim(),
      sourceImageUrl: dto.sourceImageUrl.trim(),
    };

    try {
      return await this.characterService.create(createDto);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create character diagram';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('from-lora')
  async createFromLora(@Body() dto: CreateCharacterFromLoraRequestDto): Promise<DbCharacterDiagram> {
    if (!dto.loraId?.trim()) {
      throw new HttpException('LoRA ID is required', HttpStatus.BAD_REQUEST);
    }

    const createDto: CreateCharacterDiagramFromLoraDto = {
      name: dto.name?.trim(),
      loraId: dto.loraId.trim(),
    };

    try {
      return await this.characterService.createFromLora(createDto);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create character diagram from LoRA';
      if (message === 'LoRA model not found') {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('name') name: string,
  ): Promise<DbCharacterDiagram> {
    if (!file) {
      throw new HttpException('File is required', HttpStatus.BAD_REQUEST);
    }
    if (!name?.trim()) {
      throw new HttpException('Name is required', HttpStatus.BAD_REQUEST);
    }

    try {
      // Upload file to storage
      const result = await this.filesService.uploadFile(
        'CHARACTER_IMAGES',
        file.buffer,
        file.originalname,
        file.mimetype,
      );

      // Create character diagram record
      return await this.characterService.upload({
        name: name.trim(),
        fileUrl: result.url,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload character diagram';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get()
  async findAll(@Query('status') status?: string): Promise<DbCharacterDiagram[]> {
    const validStatuses = ['pending', 'processing', 'ready', 'failed'];
    if (status && !validStatuses.includes(status)) {
      throw new HttpException(
        `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.characterService.findAll(status);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<DbCharacterDiagram> {
    const diagram = await this.characterService.findOne(id);
    if (!diagram) {
      throw new HttpException('Character diagram not found', HttpStatus.NOT_FOUND);
    }
    return diagram;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCharacterRequestDto,
  ): Promise<DbCharacterDiagram> {
    if (!dto.name?.trim()) {
      throw new HttpException('Name is required', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.characterService.update(id, { name: dto.name.trim() });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update character diagram';
      if (message === 'Character diagram not found') {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete(':id')
  async delete(@Param('id') id: string): Promise<{ success: boolean }> {
    try {
      await this.characterService.delete(id);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete character diagram';
      if (message === 'Character diagram not found') {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      if (message.includes('Cannot delete')) {
        throw new HttpException(message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
