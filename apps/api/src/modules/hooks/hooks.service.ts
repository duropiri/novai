import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService, DbHook } from '../files/supabase.service';

export interface CreateHookDto {
  text: string;
  category?: string;
}

@Injectable()
export class HooksService {
  private readonly logger = new Logger(HooksService.name);

  constructor(private readonly supabase: SupabaseService) {}

  private checkInitialized(): void {
    if (!this.supabase.isInitialized()) {
      throw new Error('Database not configured. Please set up Supabase credentials.');
    }
  }

  async create(dto: CreateHookDto): Promise<DbHook> {
    this.checkInitialized();
    this.logger.log(`Creating hook: ${dto.text.substring(0, 50)}...`);

    return this.supabase.createHook({
      text: dto.text,
      category: dto.category || null,
    });
  }

  async createBulk(hooks: CreateHookDto[]): Promise<DbHook[]> {
    this.checkInitialized();
    this.logger.log(`Creating ${hooks.length} hooks in bulk`);

    const results: DbHook[] = [];
    for (const hook of hooks) {
      const created = await this.supabase.createHook({
        text: hook.text,
        category: hook.category || null,
      });
      results.push(created);
    }

    return results;
  }

  async findAll(category?: string): Promise<DbHook[]> {
    if (!this.supabase.isInitialized()) {
      return [];
    }
    return this.supabase.listHooks(category);
  }

  async findOne(id: string): Promise<DbHook | null> {
    if (!this.supabase.isInitialized()) {
      return null;
    }
    return this.supabase.getHook(id);
  }

  async update(id: string, updates: Partial<Pick<DbHook, 'text' | 'category'>>): Promise<DbHook> {
    this.checkInitialized();
    return this.supabase.updateHook(id, updates);
  }

  async delete(id: string): Promise<void> {
    this.checkInitialized();
    const hook = await this.supabase.getHook(id);
    if (!hook) {
      throw new Error('Hook not found');
    }

    await this.supabase.deleteHook(id);
    this.logger.log(`Deleted hook ${id}`);
  }

  async getCategories(): Promise<string[]> {
    if (!this.supabase.isInitialized()) {
      return [];
    }
    const hooks = await this.supabase.listHooks();
    const categories = new Set<string>();
    for (const hook of hooks) {
      if (hook.category) {
        categories.add(hook.category);
      }
    }
    return Array.from(categories).sort();
  }
}
