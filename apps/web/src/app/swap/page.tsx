'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Video, User, Sparkles, Info, Download, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import {
  videosApi,
  characterApi,
  jobsApi,
  swapApi,
  type Video as VideoType,
  type CharacterDiagram,
  type Job,
} from '@/lib/api';

export default function AISwapperPage() {
  const { toast } = useToast();

  // Selected items
  const [selectedVideo, setSelectedVideo] = useState<VideoType | null>(null);
  const [selectedDiagram, setSelectedDiagram] = useState<CharacterDiagram | null>(null);

  // Data lists
  const [videos, setVideos] = useState<VideoType[]>([]);
  const [diagrams, setDiagrams] = useState<CharacterDiagram[]>([]);
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);

  // Loading states
  const [isLoadingVideos, setIsLoadingVideos] = useState(true);
  const [isLoadingDiagrams, setIsLoadingDiagrams] = useState(true);
  const [isLoadingJobs, setIsLoadingJobs] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);

  // Fetch data
  const fetchVideos = useCallback(async () => {
    try {
      const data = await videosApi.list({ type: 'source' });
      setVideos(data);
    } catch (error) {
      console.error('Failed to fetch videos:', error);
    } finally {
      setIsLoadingVideos(false);
    }
  }, []);

  const fetchDiagrams = useCallback(async () => {
    try {
      const data = await characterApi.list('ready');
      setDiagrams(data);
    } catch (error) {
      console.error('Failed to fetch diagrams:', error);
    } finally {
      setIsLoadingDiagrams(false);
    }
  }, []);

  const fetchJobs = useCallback(async () => {
    try {
      const data = await jobsApi.list('face_swap');
      setRecentJobs(data.slice(0, 10));
    } catch (error) {
      console.error('Failed to fetch jobs:', error);
    } finally {
      setIsLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    fetchVideos();
    fetchDiagrams();
    fetchJobs();

    // Poll for job updates
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [fetchVideos, fetchDiagrams, fetchJobs]);

  // Calculate estimated cost (2 credits per second)
  const estimatedCost = selectedVideo?.duration_seconds
    ? (selectedVideo.duration_seconds * 2 * 0.01).toFixed(2)
    : '0.00';

  const handleGenerate = async () => {
    if (!selectedVideo || !selectedDiagram) {
      toast({
        title: 'Missing Selection',
        description: 'Please select both a video and a character diagram',
        variant: 'destructive',
      });
      return;
    }

    setIsGenerating(true);

    try {
      const result = await swapApi.create({
        videoId: selectedVideo.id,
        characterDiagramId: selectedDiagram.id,
      });

      toast({
        title: 'Face Swap Started',
        description: `Job queued successfully. Estimated cost: $${(result.estimatedCostCents / 100).toFixed(2)}`,
      });

      // Refresh jobs list
      fetchJobs();

      // Clear selections
      setSelectedVideo(null);
      setSelectedDiagram(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start face swap';
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getJobStatusBadge = (status: Job['status']) => {
    switch (status) {
      case 'pending':
      case 'queued':
        return <Badge variant="outline">Queued</Badge>;
      case 'processing':
        return <Badge variant="warning"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Processing</Badge>;
      case 'completed':
        return <Badge variant="success">Completed</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">AI Swapper</h1>
        <p className="text-muted-foreground">
          Swap faces in videos using your character diagrams
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column - Selectors */}
        <div className="space-y-4">
          {/* 1. Select Source Video */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Video className="w-5 h-5" />
                1. Select Source Video
              </CardTitle>
              <CardDescription>Choose the video to swap faces onto</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingVideos ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : videos.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No source videos found</p>
                  <p className="text-sm">Upload videos in Video Collections first</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                  {videos.map((video) => (
                    <button
                      key={video.id}
                      onClick={() => setSelectedVideo(video)}
                      className={`relative aspect-video rounded-md overflow-hidden border-2 transition-all ${
                        selectedVideo?.id === video.id
                          ? 'border-primary ring-2 ring-primary/50'
                          : 'border-transparent hover:border-muted-foreground/50'
                      }`}
                    >
                      {video.thumbnail_url ? (
                        <img
                          src={video.thumbnail_url}
                          alt={video.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-muted flex items-center justify-center">
                          <Video className="w-6 h-6 text-muted-foreground" />
                        </div>
                      )}
                      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1 truncate">
                        {formatDuration(video.duration_seconds)}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {selectedVideo && (
                <div className="mt-3 p-2 bg-muted rounded-md">
                  <p className="text-sm font-medium truncate">{selectedVideo.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Duration: {formatDuration(selectedVideo.duration_seconds)}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 2. Select Character Diagram */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <User className="w-5 h-5" />
                2. Select Character Diagram
              </CardTitle>
              <CardDescription>Choose the face to swap in</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingDiagrams ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : diagrams.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No character diagrams found</p>
                  <p className="text-sm">Generate diagrams in Character Diagram Generator first</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                  {diagrams.map((diagram) => (
                    <button
                      key={diagram.id}
                      onClick={() => setSelectedDiagram(diagram)}
                      className={`relative aspect-square rounded-md overflow-hidden border-2 transition-all ${
                        selectedDiagram?.id === diagram.id
                          ? 'border-primary ring-2 ring-primary/50'
                          : 'border-transparent hover:border-muted-foreground/50'
                      }`}
                    >
                      {diagram.file_url ? (
                        <img
                          src={diagram.file_url}
                          alt={diagram.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-muted flex items-center justify-center">
                          <User className="w-6 h-6 text-muted-foreground" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {selectedDiagram && (
                <div className="mt-3 p-2 bg-muted rounded-md">
                  <p className="text-sm font-medium truncate">{selectedDiagram.name}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 3. Select LoRA (Disabled) */}
          <Card className="opacity-60">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="w-5 h-5" />
                3. Select Model (Optional)
                <Badge variant="outline" className="ml-2">Coming Soon</Badge>
              </CardTitle>
              <CardDescription className="flex items-start gap-2">
                <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>
                  LoRA enhances upstream generation consistency, not direct face swap input.
                  InsightFace uses the face image from your character diagram.
                </span>
              </CardDescription>
            </CardHeader>
          </Card>

          {/* Cost Display & Generate Button */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm text-muted-foreground">Estimated Cost</span>
                <span className="text-lg font-semibold">${estimatedCost}</span>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                Based on 2 credits per second of video
              </p>
              <Button
                onClick={handleGenerate}
                disabled={!selectedVideo || !selectedDiagram || isGenerating}
                className="w-full"
                size="lg"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Generate Face Swap
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Results */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Jobs</CardTitle>
            <CardDescription>Your face swap history</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingJobs ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : recentJobs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Video className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No face swap jobs yet</p>
                <p className="text-sm">Select a video and diagram to get started</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentJobs.map((job) => (
                  <div
                    key={job.id}
                    className="border rounded-lg p-3 flex items-center gap-3"
                  >
                    <div className="w-16 h-12 bg-muted rounded flex items-center justify-center flex-shrink-0">
                      <Video className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {getJobStatusBadge(job.status)}
                        {job.progress > 0 && job.progress < 100 && (
                          <span className="text-xs text-muted-foreground">
                            {job.progress}%
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(job.created_at).toLocaleString()}
                      </p>
                    </div>
                    {job.status === 'completed' && (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" title="Preview">
                          <Play className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Download">
                          <Download className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
