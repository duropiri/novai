import { Controller, Get, Post, Body, Param, Query, HttpException, HttpStatus } from '@nestjs/common';
import { IsString, IsNotEmpty, IsIn, IsObject } from 'class-validator';
import { JobsService, JobType } from './jobs.service';
import { DbJob } from '../files/supabase.service';

class CreateJobDto {
  @IsString()
  @IsIn(['lora_training', 'character_diagram', 'face_swap', 'variant'])
  type!: JobType;

  @IsString()
  @IsNotEmpty()
  referenceId!: string;

  @IsObject()
  payload!: Record<string, unknown>;
}

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  async createJob(@Body() dto: CreateJobDto): Promise<DbJob> {
    const validTypes: JobType[] = ['lora_training', 'character_diagram', 'face_swap', 'variant'];
    if (!validTypes.includes(dto.type)) {
      throw new HttpException(
        `Invalid job type. Must be one of: ${validTypes.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.jobsService.createJob(dto.type, dto.referenceId, dto.payload);
  }

  @Get()
  async listJobs(
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ): Promise<DbJob[]> {
    return this.jobsService.listJobs(type, limit ? parseInt(limit, 10) : undefined);
  }

  @Get(':id')
  async getJob(@Param('id') id: string): Promise<DbJob> {
    const job = await this.jobsService.getJob(id);
    if (!job) {
      throw new HttpException('Job not found', HttpStatus.NOT_FOUND);
    }
    return job;
  }

  @Post(':id/cancel')
  async cancelJob(@Param('id') id: string): Promise<DbJob> {
    try {
      return await this.jobsService.cancelJob(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to cancel job';
      if (message === 'Job not found') {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      }
      if (message.includes('Cannot cancel')) {
        throw new HttpException(message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('cleanup-stuck')
  async cleanupStuckJobs(
    @Query('maxAgeMinutes') maxAgeMinutes?: string,
  ): Promise<{ cleaned: number }> {
    const maxAge = maxAgeMinutes ? parseInt(maxAgeMinutes, 10) : 60;
    const cleaned = await this.jobsService.cleanupStuckJobs(maxAge);
    return { cleaned };
  }
}
