import { Controller, Get, Query } from '@nestjs/common';
import { StatsService } from './stats.service';

@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get()
  async getDashboardStats() {
    return this.statsService.getDashboardStats();
  }

  @Get('jobs/active')
  async getActiveJobs() {
    return this.statsService.getActiveJobs();
  }

  @Get('jobs/recent')
  async getRecentJobs(@Query('limit') limit?: string) {
    return this.statsService.getRecentJobs(limit ? parseInt(limit, 10) : 10);
  }
}
