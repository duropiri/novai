'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Wand2,
  User,
  Video,
  Layers,
  HardDrive,
  DollarSign,
  Activity,
  CheckCircle,
  XCircle,
  Clock,
  Music,
  Image,
  MessageSquare,
  FolderOpen,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { statsApi, DashboardStats, Job } from '@/lib/api';

const quickActions = [
  {
    title: 'Create LoRA',
    description: 'Train a new face model from images',
    icon: User,
    href: '/lora',
    color: 'text-blue-500',
  },
  {
    title: 'Character Diagram',
    description: 'Generate reference sheet from photo',
    icon: Wand2,
    href: '/characters',
    color: 'text-purple-500',
  },
  {
    title: 'Face Swap',
    description: 'Swap faces in video content',
    icon: Video,
    href: '/swap',
    color: 'text-green-500',
  },
  {
    title: 'Create Variants',
    description: 'Add overlays and audio to videos',
    icon: Layers,
    href: '/variants',
    color: 'text-orange-500',
  },
];

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

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

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-500',
    queued: 'bg-blue-500',
    processing: 'bg-purple-500',
    completed: 'bg-green-500',
    failed: 'bg-red-500',
  };
  return colors[status] || 'bg-gray-500';
}

function getTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function StorageStatsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <Card key={i}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-4" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-16 mb-1" />
            <Skeleton className="h-3 w-24" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function JobsSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 p-3 rounded-lg border">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="flex-1 space-y-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activeJobs, setActiveJobs] = useState<Job[]>([]);
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      const [statsData, activeJobsData, recentJobsData] = await Promise.all([
        statsApi.getDashboardStats(),
        statsApi.getActiveJobs(),
        statsApi.getRecentJobs(5),
      ]);

      setStats(statsData);
      setActiveJobs(activeJobsData);
      setRecentJobs(recentJobsData);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();

    // Auto-refresh every 30 seconds
    const interval = setInterval(() => loadData(true), 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome to NOVAI - your AI content creation platform
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

      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {quickActions.map((action) => (
          <Card key={action.title} className="hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{action.title}</CardTitle>
              <action.icon className={`h-4 w-4 ${action.color}`} />
            </CardHeader>
            <CardContent>
              <CardDescription className="mb-4">{action.description}</CardDescription>
              <Link href={action.href}>
                <Button size="sm" variant="outline" className="w-full">
                  Get Started
                </Button>
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Stats Overview */}
      <div>
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <HardDrive className="h-5 w-5" />
          Storage Overview
        </h2>
        {loading ? (
          <StorageStatsSkeleton />
        ) : stats ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Videos</CardTitle>
                <Video className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.storage.videos.count}</div>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(stats.storage.videos.totalSizeBytes)} total
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Audio Files</CardTitle>
                <Music className="h-4 w-4 text-purple-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.storage.audio.count}</div>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(stats.storage.audio.totalSizeBytes)} total
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">LoRA Models</CardTitle>
                <User className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.storage.loraModels.count}</div>
                <p className="text-xs text-muted-foreground">trained models</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Character Diagrams</CardTitle>
                <Image className="h-4 w-4 text-orange-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.storage.characterDiagrams.count}</div>
                <p className="text-xs text-muted-foreground">reference sheets</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Hooks</CardTitle>
                <MessageSquare className="h-4 w-4 text-pink-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.storage.hooks.count}</div>
                <p className="text-xs text-muted-foreground">text overlays</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Collections</CardTitle>
                <FolderOpen className="h-4 w-4 text-cyan-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {stats.storage.collections.video + stats.storage.collections.audio}
                </div>
                <p className="text-xs text-muted-foreground">
                  {stats.storage.collections.video} video, {stats.storage.collections.audio} audio
                </p>
              </CardContent>
            </Card>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Failed to load storage stats.</p>
        )}
      </div>

      {/* Jobs and Costs Row */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Active Jobs */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  Active Jobs
                </CardTitle>
                <CardDescription>Currently processing tasks</CardDescription>
              </div>
              {stats && (
                <Badge variant={stats.jobs.active > 0 ? 'default' : 'secondary'}>
                  {stats.jobs.active} active
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <JobsSkeleton />
            ) : activeJobs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No active jobs. Start by creating a LoRA or processing content.
              </p>
            ) : (
              <div className="space-y-3">
                {activeJobs.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center gap-3 p-3 rounded-lg border"
                  >
                    <div
                      className={`h-8 w-8 rounded-full flex items-center justify-center ${getStatusColor(job.status)}`}
                    >
                      {job.status === 'processing' ? (
                        <Loader2 className="h-4 w-4 text-white animate-spin" />
                      ) : (
                        <Clock className="h-4 w-4 text-white" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {getJobTypeLabel(job.type)}
                      </p>
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-muted-foreground">
                          {getTimeAgo(job.created_at)}
                        </p>
                        {job.progress > 0 && job.progress < 100 && (
                          <Progress value={job.progress} className="h-1 w-16" />
                        )}
                      </div>
                    </div>
                    <Badge variant="outline" className="capitalize">
                      {job.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Costs */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Usage This Month
            </CardTitle>
            <CardDescription>API costs and processing stats</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : stats ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 rounded-lg bg-muted">
                  <span className="text-sm font-medium">Monthly Total</span>
                  <span className="text-2xl font-bold">
                    {formatCents(stats.costs.thisMonth)}
                  </span>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>LoRA Training</span>
                    <span className="font-medium">
                      {formatCents(stats.costs.byType.lora_training || 0)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Character Diagrams</span>
                    <span className="font-medium">
                      {formatCents(stats.costs.byType.character_diagram || 0)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Face Swaps</span>
                    <span className="font-medium">
                      {formatCents(stats.costs.byType.face_swap || 0)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Variants</span>
                    <span className="font-medium">
                      {formatCents(stats.costs.byType.variant || 0)}
                    </span>
                  </div>
                </div>
                <div className="flex justify-between text-sm pt-2 border-t">
                  <span className="font-medium">Today&apos;s Spend</span>
                  <span className="font-medium">{formatCents(stats.costs.today)}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Failed to load cost data.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Jobs */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Recent Jobs</CardTitle>
              <CardDescription>Your latest processing tasks</CardDescription>
            </div>
            {stats && (
              <div className="flex gap-2">
                <Badge variant="outline" className="gap-1">
                  <CheckCircle className="h-3 w-3 text-green-500" />
                  {stats.jobs.completedToday} today
                </Badge>
                {stats.jobs.failedToday > 0 && (
                  <Badge variant="outline" className="gap-1">
                    <XCircle className="h-3 w-3 text-red-500" />
                    {stats.jobs.failedToday} failed
                  </Badge>
                )}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <JobsSkeleton />
          ) : recentJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No jobs yet. Start by creating a LoRA or uploading content.
            </p>
          ) : (
            <div className="space-y-3">
              {recentJobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center gap-3 p-3 rounded-lg border"
                >
                  <div
                    className={`h-8 w-8 rounded-full flex items-center justify-center ${getStatusColor(job.status)}`}
                  >
                    {job.status === 'completed' ? (
                      <CheckCircle className="h-4 w-4 text-white" />
                    ) : job.status === 'failed' ? (
                      <XCircle className="h-4 w-4 text-white" />
                    ) : job.status === 'processing' ? (
                      <Loader2 className="h-4 w-4 text-white animate-spin" />
                    ) : (
                      <Clock className="h-4 w-4 text-white" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {getJobTypeLabel(job.type)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {getTimeAgo(job.created_at)}
                      {job.cost_cents > 0 && ` - ${formatCents(job.cost_cents)}`}
                    </p>
                  </div>
                  <Badge variant="outline" className="capitalize">
                    {job.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
