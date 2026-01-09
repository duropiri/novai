import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../files/supabase.service';

export interface DashboardStats {
  storage: {
    videos: { count: number; totalSizeBytes: number };
    audio: { count: number; totalSizeBytes: number };
    loraModels: { count: number };
    characterDiagrams: { count: number };
    hooks: { count: number };
    collections: { video: number; audio: number };
  };
  costs: {
    today: number;
    thisMonth: number;
    byType: Record<string, number>;
  };
  jobs: {
    active: number;
    completedToday: number;
    failedToday: number;
  };
}

@Injectable()
export class StatsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async getDashboardStats(): Promise<DashboardStats> {
    const storage = await this.supabaseService.getStorageStats();

    // Get today's costs
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get this month's costs
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);

    const [todayCosts, monthCosts, activeJobs, recentJobs] = await Promise.all([
      this.supabaseService.getCostsByPeriod(today, tomorrow),
      this.supabaseService.getCostsByPeriod(monthStart, monthEnd),
      this.supabaseService.getActiveJobs(),
      this.supabaseService.getRecentJobs(100), // Get more to filter by date
    ]);

    // Count jobs completed/failed today
    const todayStr = today.toISOString().split('T')[0];
    const completedToday = recentJobs.filter(
      (j) => j.status === 'completed' && j.completed_at?.startsWith(todayStr),
    ).length;
    const failedToday = recentJobs.filter(
      (j) => j.status === 'failed' && j.completed_at?.startsWith(todayStr),
    ).length;

    return {
      storage,
      costs: {
        today: todayCosts.total,
        thisMonth: monthCosts.total,
        byType: monthCosts.byType,
      },
      jobs: {
        active: activeJobs.length,
        completedToday,
        failedToday,
      },
    };
  }

  async getActiveJobs() {
    return this.supabaseService.getActiveJobs();
  }

  async getRecentJobs(limit = 10) {
    return this.supabaseService.getRecentJobs(limit);
  }
}
