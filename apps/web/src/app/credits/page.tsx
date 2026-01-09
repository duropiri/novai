'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  DollarSign,
  TrendingUp,
  Calendar,
  User,
  Wand2,
  Video,
  Layers,
  RefreshCw,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { statsApi, DashboardStats, Job } from '@/lib/api';

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function getJobTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    lora_training: 'LoRA Training',
    character_diagram: 'Character Diagram',
    face_swap: 'Face Swap',
    variant: 'Variant',
  };
  return labels[type] || type;
}

function getJobTypeIcon(type: string) {
  const icons: Record<string, React.ReactNode> = {
    lora_training: <User className="h-4 w-4" />,
    character_diagram: <Wand2 className="h-4 w-4" />,
    face_swap: <Video className="h-4 w-4" />,
    variant: <Layers className="h-4 w-4" />,
  };
  return icons[type] || <DollarSign className="h-4 w-4" />;
}

function getJobTypeColor(type: string): string {
  const colors: Record<string, string> = {
    lora_training: 'bg-blue-500',
    character_diagram: 'bg-purple-500',
    face_swap: 'bg-green-500',
    variant: 'bg-orange-500',
  };
  return colors[type] || 'bg-gray-500';
}

function CostsSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-20 w-full" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export default function CreditsPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Mock daily limit - in production this would come from user settings
  const dailyLimit = 5000; // $50.00

  const loadData = async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      const [statsData, jobs] = await Promise.all([
        statsApi.getDashboardStats(),
        statsApi.getRecentJobs(20),
      ]);

      setStats(statsData);
      // Filter only jobs with costs
      setRecentJobs(jobs.filter((j) => j.cost_cents > 0));
    } catch (error) {
      console.error('Failed to load credits data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const todayPercentage = stats ? Math.min((stats.costs.today / dailyLimit) * 100, 100) : 0;

  // Calculate breakdown percentages for monthly costs
  const totalMonthly = stats?.costs.thisMonth || 1;
  const costBreakdown = stats
    ? Object.entries(stats.costs.byType).map(([type, cents]) => ({
        type,
        cents,
        percentage: (cents / totalMonthly) * 100,
      }))
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Credits & Usage</h1>
          <p className="text-muted-foreground">
            Track your API costs and usage across all services
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => loadData(true)}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="ml-2">Refresh</span>
        </Button>
      </div>

      {loading ? (
        <CostsSkeleton />
      ) : stats ? (
        <>
          {/* Overview Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            {/* Today's Spend */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Today&apos;s Spend
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{formatCents(stats.costs.today)}</div>
                <div className="mt-2">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Daily limit</span>
                    <span>{formatCents(dailyLimit)}</span>
                  </div>
                  <Progress value={todayPercentage} className="h-2" />
                </div>
                {todayPercentage > 80 && (
                  <div className="flex items-center gap-1 mt-2 text-xs text-yellow-500">
                    <AlertTriangle className="h-3 w-3" />
                    Approaching daily limit
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Monthly Total */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  This Month
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{formatCents(stats.costs.thisMonth)}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </p>
              </CardContent>
            </Card>

            {/* Jobs Summary */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Jobs Today
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-4">
                  <div>
                    <div className="text-3xl font-bold text-green-500">
                      {stats.jobs.completedToday}
                    </div>
                    <p className="text-xs text-muted-foreground">Completed</p>
                  </div>
                  {stats.jobs.failedToday > 0 && (
                    <div>
                      <div className="text-3xl font-bold text-red-500">
                        {stats.jobs.failedToday}
                      </div>
                      <p className="text-xs text-muted-foreground">Failed</p>
                    </div>
                  )}
                  {stats.jobs.active > 0 && (
                    <div>
                      <div className="text-3xl font-bold text-blue-500">{stats.jobs.active}</div>
                      <p className="text-xs text-muted-foreground">Active</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Cost Breakdown by Type */}
          <Card>
            <CardHeader>
              <CardTitle>Cost Breakdown</CardTitle>
              <CardDescription>Monthly spending by service type</CardDescription>
            </CardHeader>
            <CardContent>
              {costBreakdown.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No costs recorded this month yet.
                </p>
              ) : (
                <div className="space-y-4">
                  {costBreakdown.map(({ type, cents, percentage }) => (
                    <div key={type} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className={`h-8 w-8 rounded-full flex items-center justify-center ${getJobTypeColor(type)}`}
                          >
                            <span className="text-white">{getJobTypeIcon(type)}</span>
                          </div>
                          <div>
                            <p className="text-sm font-medium">{getJobTypeLabel(type)}</p>
                            <p className="text-xs text-muted-foreground">
                              {percentage.toFixed(1)}% of total
                            </p>
                          </div>
                        </div>
                        <span className="text-lg font-semibold">{formatCents(cents)}</span>
                      </div>
                      <Progress value={percentage} className="h-2" />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Transactions */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Transactions</CardTitle>
              <CardDescription>Jobs that incurred API costs</CardDescription>
            </CardHeader>
            <CardContent>
              {recentJobs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No transactions recorded yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {recentJobs.map((job) => (
                    <div
                      key={job.id}
                      className="flex items-center justify-between p-3 rounded-lg border"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`h-8 w-8 rounded-full flex items-center justify-center ${getJobTypeColor(job.type)}`}
                        >
                          <span className="text-white">{getJobTypeIcon(job.type)}</span>
                        </div>
                        <div>
                          <p className="text-sm font-medium">{getJobTypeLabel(job.type)}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(job.created_at).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{formatCents(job.cost_cents)}</p>
                        <Badge
                          variant={job.status === 'completed' ? 'default' : 'destructive'}
                          className="text-xs"
                        >
                          {job.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pricing Reference */}
          <Card>
            <CardHeader>
              <CardTitle>Pricing Reference</CardTitle>
              <CardDescription>Estimated costs per operation</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="p-4 rounded-lg border">
                  <div className="flex items-center gap-2 mb-2">
                    <User className="h-4 w-4 text-blue-500" />
                    <span className="font-medium">LoRA Training</span>
                  </div>
                  <p className="text-2xl font-bold">~$2.00</p>
                  <p className="text-xs text-muted-foreground">per model (1000 steps)</p>
                </div>
                <div className="p-4 rounded-lg border">
                  <div className="flex items-center gap-2 mb-2">
                    <Wand2 className="h-4 w-4 text-purple-500" />
                    <span className="font-medium">Character Diagram</span>
                  </div>
                  <p className="text-2xl font-bold">~$0.10</p>
                  <p className="text-xs text-muted-foreground">per generation</p>
                </div>
                <div className="p-4 rounded-lg border">
                  <div className="flex items-center gap-2 mb-2">
                    <Video className="h-4 w-4 text-green-500" />
                    <span className="font-medium">Face Swap</span>
                  </div>
                  <p className="text-2xl font-bold">~$0.50</p>
                  <p className="text-xs text-muted-foreground">per video (varies by length)</p>
                </div>
                <div className="p-4 rounded-lg border">
                  <div className="flex items-center gap-2 mb-2">
                    <Layers className="h-4 w-4 text-orange-500" />
                    <span className="font-medium">Variant Generation</span>
                  </div>
                  <p className="text-2xl font-bold">Free</p>
                  <p className="text-xs text-muted-foreground">local FFmpeg processing</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="py-8">
            <p className="text-center text-muted-foreground">Failed to load credits data.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
