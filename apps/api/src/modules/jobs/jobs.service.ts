import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUES } from './queues.constants';
import { SupabaseService, DbJob } from '../files/supabase.service';

export type JobType = 'lora_training' | 'character_diagram' | 'face_swap' | 'image_generation' | 'variant';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    @InjectQueue(QUEUES.LORA_TRAINING) private loraQueue: Queue,
    @InjectQueue(QUEUES.CHARACTER_DIAGRAM) private characterQueue: Queue,
    @InjectQueue(QUEUES.FACE_SWAP) private faceSwapQueue: Queue,
    @InjectQueue(QUEUES.IMAGE_GENERATION) private imageGenerationQueue: Queue,
    @InjectQueue(QUEUES.VARIANT) private variantQueue: Queue,
  ) {}

  async createJob(
    type: JobType,
    referenceId: string,
    payload: Record<string, unknown>,
  ): Promise<DbJob> {
    // Create job in database
    const job = await this.supabaseService.createJob({
      type,
      reference_id: referenceId,
      status: 'pending',
      progress: 0,
      input_payload: payload,
      external_request_id: null,
      external_status: null,
      output_payload: null,
      error_message: null,
      cost_cents: 0,
    });

    this.logger.log(`Created job ${job.id} of type ${type}`);

    // Enqueue the job
    const queue = this.getQueue(type);
    await queue.add(type, { jobId: job.id, ...payload });

    // Update status to queued
    return this.supabaseService.updateJob(job.id, { status: 'queued' });
  }

  async getJob(id: string): Promise<DbJob | null> {
    return this.supabaseService.getJob(id);
  }

  async updateJob(id: string, update: Partial<DbJob>): Promise<DbJob> {
    return this.supabaseService.updateJob(id, update);
  }

  async listJobs(type?: string, limit = 50): Promise<DbJob[]> {
    return this.supabaseService.listJobs({ type, limit });
  }

  async markJobProcessing(id: string): Promise<DbJob> {
    return this.supabaseService.updateJob(id, {
      status: 'processing',
      started_at: new Date().toISOString(),
    });
  }

  async markJobCompleted(
    id: string,
    outputPayload: Record<string, unknown>,
    costCents?: number,
  ): Promise<DbJob> {
    const job = await this.supabaseService.updateJob(id, {
      status: 'completed',
      progress: 100,
      output_payload: outputPayload,
      completed_at: new Date().toISOString(),
      cost_cents: costCents || 0,
    });

    // Record the cost
    if (costCents && costCents > 0) {
      await this.supabaseService.recordCost(id, job.type, costCents);
    }

    return job;
  }

  async markJobFailed(id: string, errorMessage: string): Promise<DbJob> {
    return this.supabaseService.updateJob(id, {
      status: 'failed',
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    });
  }

  async cancelJob(id: string): Promise<DbJob> {
    const job = await this.supabaseService.getJob(id);
    if (!job) {
      throw new Error('Job not found');
    }

    // Only allow cancellation of pending/queued/processing jobs
    if (!['pending', 'queued', 'processing'].includes(job.status)) {
      throw new Error(`Cannot cancel job with status: ${job.status}`);
    }

    this.logger.log(`Cancelling job ${id}`);

    return this.supabaseService.updateJob(id, {
      status: 'failed',
      error_message: 'Cancelled by user',
      completed_at: new Date().toISOString(),
    });
  }

  /**
   * Cleanup stuck jobs - mark any job that's been processing for too long as failed
   * This should be called periodically (e.g., every 5 minutes via cron)
   */
  async cleanupStuckJobs(maxAgeMinutes = 60): Promise<number> {
    const cutoffTime = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString();

    // Get all jobs that are still processing but started too long ago
    const stuckJobs = await this.supabaseService.getClient()
      .from('jobs')
      .select('id, type, started_at')
      .in('status', ['processing', 'queued'])
      .lt('started_at', cutoffTime);

    if (stuckJobs.error) {
      this.logger.error(`Failed to query stuck jobs: ${stuckJobs.error.message}`);
      return 0;
    }

    const jobs = stuckJobs.data || [];

    for (const job of jobs) {
      this.logger.warn(`Marking stuck job ${job.id} (type: ${job.type}) as failed`);
      await this.markJobFailed(job.id, `Job timed out after ${maxAgeMinutes} minutes`);
    }

    if (jobs.length > 0) {
      this.logger.log(`Cleaned up ${jobs.length} stuck jobs`);
    }

    return jobs.length;
  }

  async updateJobProgress(id: string, progress: number): Promise<DbJob> {
    return this.supabaseService.updateJob(id, { progress });
  }

  async setExternalRequestId(id: string, externalRequestId: string): Promise<DbJob> {
    return this.supabaseService.updateJob(id, {
      external_request_id: externalRequestId,
    });
  }

  private getQueue(type: JobType): Queue {
    switch (type) {
      case 'lora_training':
        return this.loraQueue;
      case 'character_diagram':
        return this.characterQueue;
      case 'face_swap':
        return this.faceSwapQueue;
      case 'image_generation':
        return this.imageGenerationQueue;
      case 'variant':
        return this.variantQueue;
      default:
        throw new Error(`Unknown queue type: ${type}`);
    }
  }
}
