'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Video, User, Sparkles, Download, Play, ExternalLink, Settings, ChevronDown, ChevronUp, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useToast } from '@/components/ui/use-toast';
import {
  videosApi,
  characterApi,
  loraApi,
  jobsApi,
  swapApi,
  type Video as VideoType,
  type CharacterDiagram,
  type LoraModel,
  type Job,
} from '@/lib/api';
import { formatDuration } from '@/lib/video-utils';

// WAN pricing per second by resolution (in cents)
const WAN_COST_PER_SECOND: Record<string, number> = {
  '480p': 4, // $0.04/second
  '580p': 6, // $0.06/second
  '720p': 8, // $0.08/second
};

export default function AISwapperPage() {
  const { toast } = useToast();

  // Selected items
  const [selectedVideo, setSelectedVideo] = useState<VideoType | null>(null);
  const [selectedDiagram, setSelectedDiagram] = useState<CharacterDiagram | null>(null);
  const [selectedLora, setSelectedLora] = useState<LoraModel | null>(null);

  // WAN settings
  const [resolution, setResolution] = useState<'480p' | '580p' | '720p'>('720p');
  const [videoQuality, setVideoQuality] = useState<'low' | 'medium' | 'high' | 'maximum'>('high');
  const [useTurbo, setUseTurbo] = useState(true);
  const [inferenceSteps, setInferenceSteps] = useState(20);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Data lists
  const [videos, setVideos] = useState<VideoType[]>([]);
  const [diagrams, setDiagrams] = useState<CharacterDiagram[]>([]);
  const [loras, setLoras] = useState<LoraModel[]>([]);
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);

  // Loading states
  const [isLoadingVideos, setIsLoadingVideos] = useState(true);
  const [isLoadingDiagrams, setIsLoadingDiagrams] = useState(true);
  const [isLoadingLoras, setIsLoadingLoras] = useState(true);
  const [isLoadingJobs, setIsLoadingJobs] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);

  // Preview modal
  const [previewVideo, setPreviewVideo] = useState<VideoType | null>(null);

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

  const fetchLoras = useCallback(async () => {
    try {
      const data = await loraApi.list('ready');
      setLoras(data);
    } catch (error) {
      console.error('Failed to fetch LoRAs:', error);
    } finally {
      setIsLoadingLoras(false);
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
    fetchLoras();
    fetchJobs();

    // Poll for job updates
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [fetchVideos, fetchDiagrams, fetchLoras, fetchJobs]);

  // Calculate estimated cost (WAN Animate Replace pricing)
  const durationSeconds = selectedVideo?.duration_seconds || 0;
  const costPerSecond = WAN_COST_PER_SECOND[resolution] || 8;
  const estimatedCost = durationSeconds > 0
    ? ((durationSeconds * costPerSecond) / 100).toFixed(2)
    : '0.00';
  const costDescription = durationSeconds > 0
    ? `$${(costPerSecond / 100).toFixed(2)}/sec at ${resolution}`
    : '';

  const handleGenerate = async () => {
    if (!selectedVideo || !selectedDiagram) {
      toast({
        title: 'Missing Selection',
        description: 'Please select a video and character diagram',
        variant: 'destructive',
      });
      return;
    }

    setIsGenerating(true);

    try {
      const result = await swapApi.create({
        videoId: selectedVideo.id,
        characterDiagramId: selectedDiagram.id,
        loraId: selectedLora?.id,
        resolution,
        videoQuality,
        useTurbo,
        inferenceSteps,
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
      setSelectedLora(null);
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

  const handlePreviewJob = async (job: Job) => {
    if (job.status !== 'completed') return;

    try {
      const video = await swapApi.getResult(job.id);
      if (video) {
        setPreviewVideo(video);
      }
    } catch (error) {
      console.error('Failed to load preview:', error);
      toast({
        title: 'Error',
        description: 'Failed to load video preview',
        variant: 'destructive',
      });
    }
  };

  const handleCancelJob = async (job: Job) => {
    try {
      await jobsApi.cancel(job.id);
      toast({
        title: 'Job Cancelled',
        description: 'The job has been cancelled',
      });
      fetchJobs();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to cancel job';
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
    }
  };

  // Check if a job is stuck (processing for more than 30 minutes)
  const isJobStuck = (job: Job) => {
    if (job.status !== 'processing' || !job.started_at) return false;
    const startedAt = new Date(job.started_at).getTime();
    const now = Date.now();
    return now - startedAt > 30 * 60 * 1000; // 30 minutes
  };

  const getJobStatusBadge = (status: Job['status']) => {
    switch (status) {
      case 'pending':
      case 'queued':
        return <Badge variant="outline">Queued</Badge>;
      case 'processing':
        return <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Processing</Badge>;
      case 'completed':
        return <Badge className="bg-green-500/10 text-green-600 border-green-500/20">Completed</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const canGenerate = selectedVideo && selectedDiagram && !isGenerating;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">AI Swapper</h1>
        <p className="text-muted-foreground">
          Replace characters in any video while preserving the scene&apos;s lighting, background, and color tone
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
                {selectedVideo && <Badge variant="outline" className="ml-auto">Selected</Badge>}
              </CardTitle>
              <CardDescription>Choose the video to apply the character swap to</CardDescription>
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
                {selectedDiagram && <Badge variant="outline" className="ml-auto">Selected</Badge>}
              </CardTitle>
              <CardDescription>Choose the character to swap into the video</CardDescription>
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

          {/* 3. Select LoRA Model (Optional) */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="w-5 h-5" />
                3. LoRA Model
                <Badge variant="outline" className="ml-1">Optional</Badge>
                {selectedLora && <Badge variant="secondary" className="ml-auto">Selected</Badge>}
              </CardTitle>
              <CardDescription>
                LoRA not required - character identity comes from your Character Diagram
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingLoras ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : loras.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground text-sm">
                  No LoRA models available (optional)
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 max-h-32 overflow-y-auto">
                  {loras.map((lora) => (
                    <button
                      key={lora.id}
                      onClick={() => setSelectedLora(selectedLora?.id === lora.id ? null : lora)}
                      className={`relative aspect-square rounded-md overflow-hidden border-2 transition-all ${
                        selectedLora?.id === lora.id
                          ? 'border-primary ring-2 ring-primary/50'
                          : 'border-transparent hover:border-muted-foreground/50'
                      }`}
                    >
                      {lora.thumbnail_url ? (
                        <img
                          src={lora.thumbnail_url}
                          alt={lora.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-muted flex items-center justify-center">
                          <Sparkles className="w-6 h-6 text-muted-foreground" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 4. Settings & Generate */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              {/* Advanced Settings */}
              <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between">
                    <span className="flex items-center gap-2">
                      <Settings className="w-4 h-4" />
                      Advanced Settings
                    </span>
                    {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 pt-4">
                    {/* Resolution */}
                    <div className="space-y-2">
                      <Label>Resolution</Label>
                      <Select value={resolution} onValueChange={(v) => setResolution(v as typeof resolution)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="480p">480p ($0.04/sec)</SelectItem>
                          <SelectItem value="580p">580p ($0.06/sec)</SelectItem>
                          <SelectItem value="720p">720p ($0.08/sec)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Video Quality */}
                    <div className="space-y-2">
                      <Label>Video Quality</Label>
                      <Select value={videoQuality} onValueChange={(v) => setVideoQuality(v as typeof videoQuality)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="maximum">Maximum</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Inference Steps */}
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <Label>Inference Steps</Label>
                        <span className="text-sm text-muted-foreground">{inferenceSteps}</span>
                      </div>
                      <Slider
                        value={[inferenceSteps]}
                        onValueChange={([v]) => setInferenceSteps(v)}
                        min={2}
                        max={40}
                        step={1}
                      />
                      <p className="text-xs text-muted-foreground">
                        Higher = better quality but slower
                      </p>
                    </div>

                    {/* Use Turbo */}
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>Use Turbo</Label>
                        <p className="text-xs text-muted-foreground">Quality enhancement for faster generation</p>
                      </div>
                      <Switch checked={useTurbo} onCheckedChange={setUseTurbo} />
                    </div>
                  </CollapsibleContent>
                </Collapsible>

              {/* Cost Display */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">Estimated Cost</span>
                  <span className="text-lg font-semibold">${estimatedCost}</span>
                </div>
                {costDescription && (
                  <p className="text-xs text-muted-foreground mb-4">{costDescription}</p>
                )}
              </div>

              {/* Generate Button */}
              <Button
                onClick={handleGenerate}
                disabled={!canGenerate}
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
              {!canGenerate && !isGenerating && (
                <p className="text-xs text-center text-muted-foreground">
                  {!selectedVideo ? 'Select a source video' :
                   !selectedDiagram ? 'Select a character diagram' : ''}
                </p>
              )}
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
                    className={`border rounded-lg p-3 flex items-center gap-3 ${isJobStuck(job) ? 'border-yellow-500/50 bg-yellow-500/5' : ''}`}
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
                        {isJobStuck(job) && (
                          <Badge variant="outline" className="text-yellow-600 border-yellow-500/50 text-xs">
                            Stuck
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(job.created_at).toLocaleString()}
                      </p>
                      {job.error_message && (
                        <p className="text-xs text-destructive mt-1 truncate">
                          {job.error_message}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1">
                      {/* Cancel button for pending/queued/processing jobs */}
                      {['pending', 'queued', 'processing'].includes(job.status) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Cancel job"
                          onClick={() => handleCancelJob(job)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <XCircle className="w-4 h-4" />
                        </Button>
                      )}
                      {/* Preview buttons for completed jobs */}
                      {job.status === 'completed' && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Preview"
                            onClick={() => handlePreviewJob(job)}
                          >
                            <Play className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Open in new tab"
                            onClick={async () => {
                              const video = await swapApi.getResult(job.id);
                              if (video?.file_url) {
                                window.open(video.file_url, '_blank');
                              }
                            }}
                          >
                            <ExternalLink className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Preview Dialog */}
      <Dialog open={!!previewVideo} onOpenChange={(open) => !open && setPreviewVideo(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Face Swap Result</DialogTitle>
          </DialogHeader>
          {previewVideo && (
            <div className="space-y-4">
              <div className="aspect-video bg-black rounded-lg overflow-hidden">
                <video
                  src={previewVideo.file_url}
                  controls
                  autoPlay
                  className="w-full h-full"
                />
              </div>
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-medium">{previewVideo.name}</p>
                  <p className="text-sm text-muted-foreground">
                    Duration: {formatDuration(previewVideo.duration_seconds)}
                  </p>
                </div>
                <Button asChild>
                  <a href={previewVideo.file_url} download>
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </a>
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
