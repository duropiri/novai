import { Controller, Get, Put, Post, Body, Param, HttpException, HttpStatus } from '@nestjs/common';
import { SettingsService, SettingUpdate } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  /**
   * Get all settings (secrets are masked)
   */
  @Get()
  async getAllSettings() {
    try {
      return await this.settingsService.getAllSettings();
    } catch (error) {
      throw new HttpException(
        error instanceof Error ? error.message : 'Failed to get settings',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get a single setting by key
   */
  @Get(':key')
  async getSetting(@Param('key') key: string) {
    try {
      const setting = await this.settingsService.getSetting(key);
      if (!setting) {
        throw new HttpException('Setting not found', HttpStatus.NOT_FOUND);
      }
      return setting;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error ? error.message : 'Failed to get setting',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Update a single setting
   */
  @Put(':key')
  async updateSetting(
    @Param('key') key: string,
    @Body() body: { value: string },
  ) {
    try {
      if (body.value === undefined) {
        throw new HttpException('Value is required', HttpStatus.BAD_REQUEST);
      }
      return await this.settingsService.updateSetting(key, body.value);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error ? error.message : 'Failed to update setting',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Update multiple settings at once
   */
  @Put()
  async updateSettings(@Body() body: { settings: SettingUpdate[] }) {
    try {
      if (!body.settings || !Array.isArray(body.settings)) {
        throw new HttpException('Settings array is required', HttpStatus.BAD_REQUEST);
      }
      return await this.settingsService.updateSettings(body.settings);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error ? error.message : 'Failed to update settings',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Test an API key's validity
   */
  @Post(':key/test')
  async testApiKey(@Param('key') key: string) {
    try {
      return await this.settingsService.testApiKey(key);
    } catch (error) {
      throw new HttpException(
        error instanceof Error ? error.message : 'Failed to test API key',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
