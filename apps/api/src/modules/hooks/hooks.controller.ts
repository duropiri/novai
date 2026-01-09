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
import { HooksService, CreateHookDto } from './hooks.service';
import { DbHook } from '../files/supabase.service';

class CreateHookRequestDto {
  text!: string;
  category?: string;
}

class CreateBulkHooksRequestDto {
  hooks!: Array<{ text: string; category?: string }>;
}

class UpdateHookRequestDto {
  text?: string;
  category?: string;
}

@Controller('hooks')
export class HooksController {
  constructor(private readonly hooksService: HooksService) {}

  @Post()
  async create(@Body() dto: CreateHookRequestDto): Promise<DbHook> {
    if (!dto.text?.trim()) {
      throw new HttpException('Text is required', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.hooksService.create({
        text: dto.text.trim(),
        category: dto.category?.trim(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create hook';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('bulk')
  async createBulk(@Body() dto: CreateBulkHooksRequestDto): Promise<{ created: number; hooks: DbHook[] }> {
    if (!dto.hooks || !Array.isArray(dto.hooks) || dto.hooks.length === 0) {
      throw new HttpException('Hooks array is required', HttpStatus.BAD_REQUEST);
    }

    // Validate and filter hooks
    const validHooks: CreateHookDto[] = [];
    for (const hook of dto.hooks) {
      const text = hook.text?.trim();
      if (text) {
        validHooks.push({
          text,
          category: hook.category?.trim(),
        });
      }
    }

    if (validHooks.length === 0) {
      throw new HttpException('No valid hooks provided', HttpStatus.BAD_REQUEST);
    }

    try {
      const hooks = await this.hooksService.createBulk(validHooks);
      return {
        created: hooks.length,
        hooks,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create hooks';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get()
  async findAll(@Query('category') category?: string): Promise<DbHook[]> {
    return this.hooksService.findAll(category);
  }

  @Get('categories')
  async getCategories(): Promise<string[]> {
    return this.hooksService.getCategories();
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<DbHook> {
    const hook = await this.hooksService.findOne(id);
    if (!hook) {
      throw new HttpException('Hook not found', HttpStatus.NOT_FOUND);
    }
    return hook;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateHookRequestDto,
  ): Promise<DbHook> {
    const updates: Partial<Pick<DbHook, 'text' | 'category'>> = {};

    if (dto.text !== undefined) {
      if (!dto.text.trim()) {
        throw new HttpException('Text cannot be empty', HttpStatus.BAD_REQUEST);
      }
      updates.text = dto.text.trim();
    }

    if (dto.category !== undefined) {
      updates.category = dto.category?.trim() || null;
    }

    if (Object.keys(updates).length === 0) {
      throw new HttpException('No updates provided', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.hooksService.update(id, updates);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update hook';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete(':id')
  async delete(@Param('id') id: string): Promise<{ success: boolean }> {
    try {
      await this.hooksService.delete(id);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete hook';
      if (message === 'Hook not found') {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
