import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../files/supabase.service';

export interface Setting {
  id: string;
  key: string;
  value: string | null;
  is_secret: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface SettingUpdate {
  key: string;
  value: string;
}

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Get all settings (secrets are masked)
   */
  async getAllSettings(): Promise<Setting[]> {
    if (!this.supabase.isInitialized()) {
      return [];
    }
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('settings')
      .select('*')
      .order('key');

    if (error) {
      throw new Error(`Failed to get settings: ${error.message}`);
    }

    // Mask secret values
    return (data || []).map((setting) => ({
      ...setting,
      value: setting.is_secret && setting.value ? this.maskValue(setting.value) : setting.value,
    }));
  }

  /**
   * Get a single setting by key
   */
  async getSetting(key: string): Promise<Setting | null> {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('settings')
      .select('*')
      .eq('key', key)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get setting: ${error.message}`);
    }

    if (data && data.is_secret && data.value) {
      data.value = this.maskValue(data.value);
    }

    return data;
  }

  /**
   * Get the actual (unmasked) value for internal use
   * Falls back to environment variable if database value is empty
   */
  async getSettingValue(key: string): Promise<string | null> {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('settings')
      .select('value')
      .eq('key', key)
      .single();

    if (error && error.code !== 'PGRST116') {
      this.logger.warn(`Failed to get setting ${key}: ${error.message}`);
    }

    // If database has a value, use it
    if (data?.value) {
      return data.value;
    }

    // Fall back to environment variable
    return this.configService.get<string>(key) || null;
  }

  /**
   * Update a setting value
   */
  async updateSetting(key: string, value: string): Promise<Setting> {
    const client = this.supabase.getClient();

    // Check if setting exists
    const { data: existing } = await client
      .from('settings')
      .select('id')
      .eq('key', key)
      .single();

    if (!existing) {
      // Create new setting
      const { data, error } = await client
        .from('settings')
        .insert({ key, value, is_secret: this.isSecretKey(key) })
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create setting: ${error.message}`);
      }

      this.logger.log(`Created setting: ${key}`);
      return this.maskSettingIfSecret(data);
    }

    // Update existing setting
    const { data, error } = await client
      .from('settings')
      .update({ value })
      .eq('key', key)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update setting: ${error.message}`);
    }

    this.logger.log(`Updated setting: ${key}`);
    return this.maskSettingIfSecret(data);
  }

  /**
   * Update multiple settings at once
   */
  async updateSettings(updates: SettingUpdate[]): Promise<Setting[]> {
    const results: Setting[] = [];

    for (const update of updates) {
      // Skip empty values for secrets (don't overwrite with empty)
      if (this.isSecretKey(update.key) && !update.value) {
        continue;
      }
      const result = await this.updateSetting(update.key, update.value);
      results.push(result);
    }

    return results;
  }

  /**
   * Check API key validity by testing the service
   */
  async testApiKey(key: string): Promise<{ valid: boolean; message: string }> {
    const value = await this.getSettingValue(key);

    if (!value) {
      return { valid: false, message: 'API key not configured' };
    }

    switch (key) {
      case 'GOOGLE_GEMINI_API_KEY':
        return this.testGeminiKey(value);
      case 'FAL_API_KEY':
        return this.testFalKey(value);
      case 'PICSI_API_KEY':
        return this.testPicsiKey(value);
      default:
        return { valid: true, message: 'Key saved' };
    }
  }

  private async testGeminiKey(apiKey: string): Promise<{ valid: boolean; message: string }> {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
        { method: 'GET' },
      );

      if (response.ok) {
        return { valid: true, message: 'Gemini API key is valid' };
      }

      const error = await response.json();
      return { valid: false, message: error.error?.message || 'Invalid API key' };
    } catch (error) {
      return { valid: false, message: 'Failed to test API key' };
    }
  }

  private async testFalKey(apiKey: string): Promise<{ valid: boolean; message: string }> {
    try {
      const response = await fetch('https://rest.fal.ai/fal-ai/flux/dev', {
        method: 'GET',
        headers: {
          Authorization: `Key ${apiKey}`,
        },
      });

      // fal.ai returns 405 for GET on model endpoints but authenticates first
      if (response.status === 405 || response.ok) {
        return { valid: true, message: 'fal.ai API key is valid' };
      }

      if (response.status === 401 || response.status === 403) {
        return { valid: false, message: 'Invalid API key' };
      }

      return { valid: true, message: 'fal.ai API key saved' };
    } catch (error) {
      return { valid: false, message: 'Failed to test API key' };
    }
  }

  private async testPicsiKey(apiKey: string): Promise<{ valid: boolean; message: string }> {
    // Picsi doesn't have a simple validation endpoint
    // We just check the format
    if (apiKey && apiKey.length > 10) {
      return { valid: true, message: 'Picsi API key saved (will be validated on first use)' };
    }
    return { valid: false, message: 'API key appears invalid' };
  }

  private maskValue(value: string): string {
    if (value.length <= 8) {
      return '••••••••';
    }
    return value.substring(0, 4) + '••••••••' + value.substring(value.length - 4);
  }

  private maskSettingIfSecret(setting: Setting): Setting {
    if (setting.is_secret && setting.value) {
      return { ...setting, value: this.maskValue(setting.value) };
    }
    return setting;
  }

  private isSecretKey(key: string): boolean {
    return key.includes('API_KEY') || key.includes('SECRET') || key.includes('PASSWORD');
  }
}
