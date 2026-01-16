'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Loader2,
  Video,
  User,
  Users,
  Sparkles,
  Download,
  Play,
  ExternalLink,
  XCircle,
  Trash2,
  RotateCcw,
  Upload,
  AlertCircle,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import {
  videosApi,
  characterApi,
  loraApi,
  referenceKitApi,
  jobsApi,
  swapApi,
  type Video as VideoType,
  type CharacterDiagram,
  type LoraModel,
  type ReferenceKit,
  type Job,
  type VideoStrategy,
} from '@/lib/api';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { formatDuration } from '@/lib/video-utils';
import {
  FaceUploadDropzone,
  VideoUploadDropzone,
  VideoModelSelector,
  UpscaleSelector,
  SkeletonPreviewPanel,
  PresetSelector,
  getVideoModelCost,
  getUpscaleCost,
  type VideoModel,
  type UpscaleMethod,
  type UpscaleResolution,
  type SwapPresetSettings,
} from './components';

// Strategy definitions
const STRATEGIES: { id: VideoStrategy; name: string; description: string; requiresLora: boolean; estimatedCostCents: number }[] = [
  {
    id: 'face_swap',
    name: 'Direct Face Swap',
    description: 'Fast frame-by-frame face swap. Best for preserving original motion.',
    requiresLora: false,
    estimatedCostCents: 45, // ~150 frames × $0.003
  },
  {
    id: 'lora_generate',
    name: 'LoRA Generation',
    description: 'High quality AI video generation with trained identity.',
    requiresLora: true,
    estimatedCostCents: 10, // Gemini + video gen
  },
  {
    id: 'video_lora',
    name: 'Video-Trained LoRA',
    description: 'Best quality. Trains on video frames for maximum identity preservation.',
    requiresLora: false,
    estimatedCostCents: 160, // Training + video gen
  },
  {
    id: 'hybrid',
    name: 'Hybrid (Generate + Refine)',
    description: 'AI generation followed by face swap refinement.',
    requiresLora: true,
    estimatedCostCents: 100, // lora_generate + face_swap
  },
];

// Cost constants (in cents)
const GEMINI_COST = 2; // ~$0.02 for Gemini regeneration
const FACE_SWAP_PER_FRAME = 0.3; // ~$0.003 per frame

export default function AISwapperPage() {
  const { toast } = useToast();

  // === REQUIRED INPUTS (3-column layout) ===
  // Column 1: Source Video
  type VideoSource = 'library' | 'upload';
  const [videoSource, setVideoSource] = useState<VideoSource>('library');
  const [selectedVideo, setSelectedVideo] = useState<VideoType | null>(null);
  const [uploadedVideo, setUploadedVideo] = useState<VideoType | null>(null);

  // Column 2: Target Face
  type FaceSource = 'upload' | 'diagram' | 'kit';
  const [faceSource, setFaceSource] = useState<FaceSource>('diagram');
  const [uploadedFaceUrls, setUploadedFaceUrls] = useState<string[]>([]);
  const [selectedDiagram, setSelectedDiagram] = useState<CharacterDiagram | null>(null);
  const [selectedReferenceKit, setSelectedReferenceKit] = useState<ReferenceKit | null>(null);

  // Column 3: LoRA Model (required for lora_generate and hybrid)
  const [selectedLora, setSelectedLora] = useState<LoraModel | null>(null);

  // === STRATEGY SELECTION ===
  const [strategy, setStrategy] = useState<VideoStrategy>('lora_generate');

  // === OPTIONS PANEL ===
  const [videoModel, setVideoModel] = useState<VideoModel>('kling');
  const [upscaleMethod, setUpscaleMethod] = useState<UpscaleMethod>('none');
  const [upscaleResolution, setUpscaleResolution] = useState<UpscaleResolution>('2k');
  const [keyFrameCount, setKeyFrameCount] = useState(5);
  const [keepOriginalOutfit, setKeepOriginalOutfit] = useState(true);

  // === DATA LISTS ===
  const [videos, setVideos] = useState<VideoType[]>([]);
  const [diagrams, setDiagrams] = useState<CharacterDiagram[]>([]);
  const [referenceKits, setReferenceKits] = useState<ReferenceKit[]>([]);
  const [loras, setLoras] = useState<LoraModel[]>([]);
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);

  // === LOADING STATES ===
  const [isLoadingVideos, setIsLoadingVideos] = useState(true);
  const [isLoadingDiagrams, setIsLoadingDiagrams] = useState(true);
  const [isLoadingReferenceKits, setIsLoadingReferenceKits] = useState(true);
  const [isLoadingLoras, setIsLoadingLoras] = useState(true);
  const [isLoadingJobs, setIsLoadingJobs] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);

  // Ref to prevent duplicate submissions
  const isSubmittingRef = useRef(false);

  // === PREVIEW MODALS ===
  const [previewVideo, setPreviewVideo] = useState<VideoType | null>(null);
  const [previewSourceVideo, setPreviewSourceVideo] = useState<VideoType | null>(null);

  // === PROCESSING JOB STATE ===
  const [activeJob, setActiveJob] = useState<Job | null>(null);

  // === DATA FETCHING ===
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

  const fetchReferenceKits = useCallback(async () => {
    try {
      const data = await referenceKitApi.list('ready');
      setReferenceKits(data);
    } catch (error) {
      console.error('Failed to fetch reference kits:', error);
    } finally {
      setIsLoadingReferenceKits(false);
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

      // Find active job for skeleton preview
      const processing = data.find((j) => j.status === 'processing');
      if (processing) {
        setActiveJob(processing);
      } else if (activeJob?.status === 'processing') {
        setActiveJob(null);
      }
    } catch (error) {
      console.error('Failed to fetch jobs:', error);
    } finally {
      setIsLoadingJobs(false);
    }
  }, [activeJob]);

  useEffect(() => {
    fetchVideos();
    fetchDiagrams();
    fetchReferenceKits();
    fetchLoras();
    fetchJobs();
  }, [fetchVideos, fetchDiagrams, fetchReferenceKits, fetchLoras, fetchJobs]);

  // Poll for job updates - faster when there's an active job
  useEffect(() => {
    const hasActiveJob = recentJobs.some((j) => j.status === 'processing' || j.status === 'queued');
    const pollInterval = hasActiveJob ? 2000 : 5000; // 2s when active, 5s otherwise

    const interval = setInterval(fetchJobs, pollInterval);
    return () => clearInterval(interval);
  }, [fetchJobs, recentJobs]);

  // === COST CALCULATION ===
  const calculateEstimatedCost = useCallback(() => {
    const selectedStrategy = STRATEGIES.find((s) => s.id === strategy);
    let total = selectedStrategy?.estimatedCostCents || 0;

    // Add video model cost for strategies that use it
    if (strategy !== 'face_swap') {
      total += getVideoModelCost(videoModel);
    }

    // Add upscaling cost
    total += getUpscaleCost(upscaleMethod);

    return total;
  }, [strategy, videoModel, upscaleMethod]);

  const estimatedCostCents = calculateEstimatedCost();
  const estimatedCostDollars = (estimatedCostCents / 100).toFixed(2);

  // === VALIDATION ===
  const hasTargetFace =
    (faceSource === 'upload' && uploadedFaceUrls.length > 0) ||
    (faceSource === 'diagram' && selectedDiagram) ||
    (faceSource === 'kit' && selectedReferenceKit);

  const selectedStrategy = STRATEGIES.find((s) => s.id === strategy);
  const loraRequired = selectedStrategy?.requiresLora ?? false;
  const hasLora = !loraRequired || selectedLora;

  // Get the active video based on source type
  const activeVideo = videoSource === 'library' ? selectedVideo : uploadedVideo;
  const canGenerate = activeVideo && hasTargetFace && hasLora && !isGenerating;

  // === HANDLERS ===
  const handleGenerate = async () => {
    if (!activeVideo) {
      toast({ title: 'Missing Selection', description: 'Please select or upload a source video', variant: 'destructive' });
      return;
    }

    if (!hasTargetFace) {
      toast({ title: 'Missing Selection', description: 'Please provide a target face', variant: 'destructive' });
      return;
    }

    if (loraRequired && !selectedLora) {
      toast({ title: 'Missing Selection', description: `Please select a LoRA model for ${selectedStrategy?.name}`, variant: 'destructive' });
      return;
    }

    // Prevent duplicate submissions
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    setIsGenerating(true);

    try {
      const result = await swapApi.create({
        videoId: activeVideo.id,
        strategy,
        uploadedFaceUrl: faceSource === 'upload' && uploadedFaceUrls.length > 0 ? uploadedFaceUrls[0] : undefined,
        additionalReferenceUrls: faceSource === 'upload' && uploadedFaceUrls.length > 1 ? uploadedFaceUrls.slice(1) : undefined,
        characterDiagramId: faceSource === 'diagram' ? selectedDiagram?.id : undefined,
        referenceKitId: faceSource === 'kit' ? selectedReferenceKit?.id : undefined,
        loraId: selectedLora?.id,
        videoModel: strategy !== 'face_swap' ? videoModel : undefined,
        keepOriginalOutfit,
        upscaleMethod,
        upscaleResolution: upscaleMethod !== 'none' ? upscaleResolution : undefined,
        keyFrameCount: strategy === 'video_lora' ? keyFrameCount : undefined,
      });

      toast({
        title: 'Face Swap Started',
        description: `Job queued. Estimated cost: $${(result.estimatedCostCents / 100).toFixed(2)}`,
      });

      fetchJobs();

      // Clear selections
      setSelectedVideo(null);
      setUploadedVideo(null);
      setUploadedFaceUrls([]);
      setSelectedDiagram(null);
      setSelectedReferenceKit(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start face swap';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsGenerating(false);
      isSubmittingRef.current = false;
    }
  };

  const handlePreviewJob = async (job: Job) => {
    if (job.status !== 'completed') return;
    try {
      const video = await swapApi.getResult(job.id);
      if (video) setPreviewVideo(video);
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to load video preview', variant: 'destructive' });
    }
  };

  const handleRetryJob = async (job: Job) => {
    try {
      await swapApi.retry(job.id);
      toast({ title: 'Job Requeued', description: 'The job has been requeued for processing' });
      fetchJobs();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to retry job';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  const handleDeleteJob = async (job: Job) => {
    if (!confirm('Delete this job? This cannot be undone.')) return;
    try {
      await swapApi.delete(job.id);
      setRecentJobs((prev) => prev.filter((j) => j.id !== job.id));
      toast({ title: 'Deleted', description: 'Job deleted successfully' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete job';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  const isJobStuck = (job: Job) => {
    if (job.status !== 'processing' || !job.started_at) return false;
    const startedAt = new Date(job.started_at).getTime();
    return Date.now() - startedAt > 45 * 60 * 1000; // 45 minutes for advanced pipeline
  };

  // === PRESET HANDLING ===
  const currentPresetSettings: SwapPresetSettings = {
    strategy,
    videoModel,
    upscaleMethod,
    upscaleResolution,
    keyFrameCount,
    keepOriginalOutfit,
  };

  const handleApplyPreset = (settings: SwapPresetSettings) => {
    setStrategy(settings.strategy);
    setVideoModel(settings.videoModel);
    setUpscaleMethod(settings.upscaleMethod);
    setUpscaleResolution(settings.upscaleResolution);
    setKeyFrameCount(settings.keyFrameCount);
    setKeepOriginalOutfit(settings.keepOriginalOutfit);
  };

  const getJobStatusBadge = (job: Job) => {
    switch (job.status) {
      case 'pending':
      case 'queued':
        return <Badge variant="outline">Queued</Badge>;
      case 'processing':
        return (
          <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            {job.external_status || 'Processing'}
          </Badge>
        );
      case 'completed':
        return <Badge className="bg-green-500/10 text-green-600 border-green-500/20">Completed</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="outline">{job.status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Advanced AI Swapper</h1>
        <p className="text-muted-foreground">
          Professional video face swap with motion tracking and upscaling
        </p>
      </div>

      {/* === 3-COLUMN REQUIRED INPUTS === */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Column 1: Source Video - REQUIRED */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Video className="w-5 h-5" />
                Source Video
              </CardTitle>
              <Badge variant="destructive">Required</Badge>
            </div>
            <CardDescription>The video to apply the face swap to</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={videoSource} onValueChange={(v) => setVideoSource(v as VideoSource)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="library">
                  <Video className="w-3 h-3 mr-1" />
                  Library
                </TabsTrigger>
                <TabsTrigger value="upload">
                  <Upload className="w-3 h-3 mr-1" />
                  Upload
                </TabsTrigger>
              </TabsList>

              {/* Library Tab */}
              <TabsContent value="library" className="mt-3">
                {isLoadingVideos ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                ) : videos.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Video className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No source videos</p>
                    <p className="text-xs">Upload videos in Collections first</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                    {videos.map((video) => (
                      <button
                        key={video.id}
                        onClick={() => setPreviewSourceVideo(video)}
                        className={`relative aspect-video rounded-md overflow-hidden border-2 transition-all group ${
                          selectedVideo?.id === video.id
                            ? 'border-primary ring-2 ring-primary/50'
                            : 'border-transparent hover:border-muted-foreground/50'
                        }`}
                      >
                        {video.thumbnail_url ? (
                          <img src={video.thumbnail_url} alt={video.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-muted flex items-center justify-center">
                            <Video className="w-6 h-6 text-muted-foreground" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <Play className="w-6 h-6 text-white" />
                        </div>
                        <span className="absolute bottom-1 right-1 bg-black/70 text-white text-xs px-1 py-0.5 rounded">
                          {formatDuration(video.duration_seconds)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {selectedVideo && (
                  <div className="mt-3 p-2 bg-primary/5 border border-primary/20 rounded-md">
                    <p className="text-sm font-medium truncate">{selectedVideo.name}</p>
                    <p className="text-xs text-muted-foreground">{formatDuration(selectedVideo.duration_seconds)}</p>
                  </div>
                )}
              </TabsContent>

              {/* Upload Tab */}
              <TabsContent value="upload" className="mt-3">
                <VideoUploadDropzone
                  onUpload={(video) => {
                    setUploadedVideo(video);
                    // Also refresh videos list so it appears in library
                    fetchVideos();
                  }}
                  uploadedVideo={uploadedVideo}
                  onClear={() => setUploadedVideo(null)}
                />
                {strategy === 'video_lora' && (
                  <p className="text-xs text-muted-foreground mt-2">
                    For Video-Trained LoRA, upload the video you want to train on.
                  </p>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Column 2: Target Face - REQUIRED */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg">
                <User className="w-5 h-5" />
                Target Face
              </CardTitle>
              <Badge variant="destructive">Required</Badge>
            </div>
            <CardDescription>The face to swap into the video</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={faceSource} onValueChange={(v) => setFaceSource(v as FaceSource)}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="upload">
                  <Upload className="w-3 h-3 mr-1" />
                  Upload
                </TabsTrigger>
                <TabsTrigger value="diagram">
                  <User className="w-3 h-3 mr-1" />
                  Diagram
                </TabsTrigger>
                <TabsTrigger value="kit">
                  <Users className="w-3 h-3 mr-1" />
                  Ref Kit
                </TabsTrigger>
              </TabsList>

              {/* Upload Tab */}
              <TabsContent value="upload" className="mt-3">
                <FaceUploadDropzone
                  onUpload={setUploadedFaceUrls}
                  uploadedUrls={uploadedFaceUrls}
                  onClear={() => setUploadedFaceUrls([])}
                />
              </TabsContent>

              {/* Character Diagram Tab */}
              <TabsContent value="diagram" className="mt-3">
                {isLoadingDiagrams ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </div>
                ) : diagrams.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground text-sm">
                    <p>No diagrams available</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2 max-h-32 overflow-y-auto">
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
                          <img src={diagram.file_url} alt={diagram.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-muted flex items-center justify-center">
                            <User className="w-4 h-4 text-muted-foreground" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Reference Kit Tab */}
              <TabsContent value="kit" className="mt-3">
                {isLoadingReferenceKits ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </div>
                ) : referenceKits.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground text-sm">
                    <p>No reference kits available</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2 max-h-32 overflow-y-auto">
                    {referenceKits.map((kit) => (
                      <button
                        key={kit.id}
                        onClick={() => setSelectedReferenceKit(kit)}
                        className={`relative aspect-square rounded-md overflow-hidden border-2 transition-all ${
                          selectedReferenceKit?.id === kit.id
                            ? 'border-primary ring-2 ring-primary/50'
                            : 'border-transparent hover:border-muted-foreground/50'
                        }`}
                      >
                        {kit.anchor_face_url || kit.source_image_url ? (
                          <img
                            src={kit.anchor_face_url || kit.source_image_url}
                            alt={kit.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-muted flex items-center justify-center">
                            <Users className="w-4 h-4 text-muted-foreground" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Column 3: LoRA Model - REQUIRED */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="w-5 h-5" />
                LoRA Model
              </CardTitle>
              <Badge variant="destructive">Required</Badge>
            </div>
            <CardDescription>Trained model for identity preservation</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingLoras ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : loras.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No LoRA models</p>
                <p className="text-xs">Train a LoRA model first</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                {loras.map((lora) => (
                  <button
                    key={lora.id}
                    onClick={() => setSelectedLora(lora)}
                    className={`relative aspect-square rounded-md overflow-hidden border-2 transition-all ${
                      selectedLora?.id === lora.id
                        ? 'border-primary ring-2 ring-primary/50'
                        : 'border-transparent hover:border-muted-foreground/50'
                    }`}
                  >
                    {lora.thumbnail_url ? (
                      <img src={lora.thumbnail_url} alt={lora.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-muted flex items-center justify-center">
                        <Sparkles className="w-6 h-6 text-muted-foreground" />
                      </div>
                    )}
                    <span className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-xs p-1 truncate">
                      {lora.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {selectedLora && (
              <div className="mt-3 p-2 bg-primary/5 border border-primary/20 rounded-md">
                <p className="text-sm font-medium truncate">{selectedLora.name}</p>
                <p className="text-xs text-muted-foreground">Trigger: {selectedLora.trigger_word}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* === STRATEGY SELECTOR === */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Generation Strategy</CardTitle>
          <CardDescription>Choose how the video should be processed</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={strategy}
            onValueChange={(v) => setStrategy(v as VideoStrategy)}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3"
          >
            {STRATEGIES.map((s) => (
              <label
                key={s.id}
                className={`relative flex flex-col p-4 border rounded-lg cursor-pointer transition-all ${
                  strategy === s.id
                    ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                    : 'border-muted hover:border-muted-foreground/50'
                }`}
              >
                <div className="flex items-start gap-3">
                  <RadioGroupItem value={s.id} className="mt-1" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{s.name}</span>
                      {s.requiresLora && (
                        <Badge variant="outline" className="text-xs">Requires LoRA</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{s.description}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      Est: ~${(s.estimatedCostCents / 100).toFixed(2)}
                    </p>
                  </div>
                </div>
              </label>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      {/* === OPTIONS PANEL === */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Processing Options</CardTitle>
            <PresetSelector
              currentSettings={currentPresetSettings}
              onApplyPreset={handleApplyPreset}
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {/* Video Model - hide for face_swap strategy */}
            {strategy !== 'face_swap' && (
            <div>
              <Label className="text-sm font-medium mb-2 block">Video Model</Label>
              <VideoModelSelector selected={videoModel} onSelect={setVideoModel} />
            </div>
            )}

            {/* Upscaling */}
            <div>
              <UpscaleSelector
                method={upscaleMethod}
                resolution={upscaleResolution}
                onMethodChange={setUpscaleMethod}
                onResolutionChange={setUpscaleResolution}
              />
            </div>

            {/* Key Frames */}
            <div>
              <div className="flex justify-between mb-2">
                <Label className="text-sm font-medium">Key Frames</Label>
                <span className="text-sm text-muted-foreground">{keyFrameCount}</span>
              </div>
              <Slider
                value={[keyFrameCount]}
                onValueChange={([v]) => setKeyFrameCount(v)}
                min={5}
                max={10}
                step={1}
                className="mt-3"
              />
              <p className="text-xs text-muted-foreground mt-1">
                More frames = better accuracy, higher cost
              </p>
            </div>

            {/* Outfit Toggle */}
            <div>
              <Label className="text-sm font-medium mb-2 block">Outfit Handling</Label>
              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Keep Original Outfit</p>
                    <p className="text-xs text-muted-foreground">
                      {keepOriginalOutfit ? 'Only swap identity' : 'Replace everything'}
                    </p>
                  </div>
                  <Switch checked={keepOriginalOutfit} onCheckedChange={setKeepOriginalOutfit} />
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* === SKELETON PREVIEW (during processing) === */}
      {activeJob && (() => {
        const skeletonUrls = (activeJob.output_payload as { skeleton_urls?: string[] })?.skeleton_urls;
        return skeletonUrls && skeletonUrls.length > 0 ? (
          <SkeletonPreviewPanel
            skeletonUrls={skeletonUrls}
            progress={activeJob.progress}
            stage={activeJob.external_status || 'Processing'}
          />
        ) : null;
      })()}

      {/* === COST & GENERATE === */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Estimated Cost:</span>
                <span className="text-2xl font-bold">${estimatedCostDollars}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Gemini + {keyFrameCount} poses + {videoModel.charAt(0).toUpperCase() + videoModel.slice(1)}
                {upscaleMethod !== 'none' && ` + ${upscaleMethod}`}
              </p>
            </div>

            <div className="flex items-center gap-3">
              {!canGenerate && !isGenerating && (
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <AlertCircle className="w-4 h-4" />
                  <span>
                    {!activeVideo
                      ? videoSource === 'library' ? 'Select a video' : 'Upload a video'
                      : !hasTargetFace
                      ? 'Provide a target face'
                      : loraRequired && !selectedLora
                      ? 'Select a LoRA model'
                      : ''}
                  </span>
                </div>
              )}
              <Button onClick={handleGenerate} disabled={!canGenerate} size="lg" className="min-w-40">
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Generate Swap
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* === RECENT JOBS === */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Jobs</CardTitle>
          <CardDescription>Your face swap processing history</CardDescription>
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
              <p className="text-sm">Configure your inputs above to get started</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentJobs.map((job) => {
                const outputPayload = job.output_payload as {
                  videoModel?: string;
                  actualModelUsed?: string;
                  loraId?: string;
                  loraTriggerWord?: string;
                  targetFaceSource?: string;
                  upscaleMethod?: string;
                  upscaleResolution?: string;
                  engineUsed?: 'gemini' | 'local' | 'fal.ai' | 'none';
                  first_frame_skipped?: boolean;
                  skip_reason?: string;
                  logs?: string[];
                } | null;
                const firstFrameSkipped = outputPayload?.first_frame_skipped;
                const selectedModel = outputPayload?.videoModel;
                const actualModel = outputPayload?.actualModelUsed;
                const engineUsed = outputPayload?.engineUsed;
                const logs = outputPayload?.logs || [];

                // Model display name mapping
                const modelDisplayNames: Record<string, string> = {
                  kling: 'Kling 1.6',
                  'kling-2.5': 'Kling 2.5',
                  'kling-2.6': 'Kling 2.6',
                  luma: 'Luma',
                  sora2pro: 'Sora 2 Pro',
                  wan: 'WAN',
                };

                return (
                <div
                  key={job.id}
                  className={`border rounded-lg p-3 ${
                    isJobStuck(job) ? 'border-yellow-500/50 bg-yellow-500/5' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-16 h-12 bg-muted rounded flex items-center justify-center flex-shrink-0">
                      <Video className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {getJobStatusBadge(job)}
                        {/* Model Badges - show selected and actual when they differ */}
                        {(selectedModel || actualModel) && (
                          <>
                            {selectedModel && (
                              <Badge variant="outline" className="text-xs">
                                {modelDisplayNames[selectedModel] || selectedModel}
                              </Badge>
                            )}
                            {actualModel && actualModel !== selectedModel && (
                              <Badge variant="secondary" className="text-xs">
                                via {modelDisplayNames[actualModel] || actualModel}
                              </Badge>
                            )}
                          </>
                        )}
                        {job.progress > 0 && job.progress < 100 && (
                          <span className="text-xs text-muted-foreground">{job.progress}%</span>
                        )}
                        {isJobStuck(job) && (
                          <Badge variant="outline" className="text-yellow-600 border-yellow-500/50 text-xs">
                            Stuck
                          </Badge>
                        )}
                        {/* Engine Used Badge */}
                        {engineUsed && engineUsed !== 'none' && (
                          <Badge
                            className={`text-xs ${
                              engineUsed === 'gemini'
                                ? 'bg-blue-100 text-blue-800 border-blue-300'
                                : engineUsed === 'local'
                                ? 'bg-purple-100 text-purple-800 border-purple-300'
                                : 'bg-gray-100 text-gray-800 border-gray-300'
                            }`}
                          >
                            {engineUsed === 'gemini' && 'Gemini'}
                            {engineUsed === 'local' && 'Local AI'}
                            {engineUsed === 'fal.ai' && 'fal.ai'}
                          </Badge>
                        )}
                        {/* First Frame Skipped Indicator */}
                        {firstFrameSkipped && (
                          <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300 text-xs">
                            <AlertTriangle className="w-3 h-3 mr-1" />
                            Frame Skipped
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(job.created_at).toLocaleString()}
                      </p>
                      {/* Skip warning message for completed jobs */}
                      {firstFrameSkipped && job.status === 'completed' && (
                        <p className="text-xs text-yellow-700 mt-1 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          AI frame gen skipped (safety filter). Basic face swap used.
                        </p>
                      )}
                      {job.error_message && (
                        <p className="text-xs text-destructive mt-1 truncate">{job.error_message}</p>
                      )}
                    </div>
                  <div className="flex gap-1">
                    {(job.status === 'failed' || isJobStuck(job)) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Retry job"
                        onClick={() => handleRetryJob(job)}
                        className="text-muted-foreground hover:text-primary"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </Button>
                    )}
                    {job.status === 'completed' && (
                      <>
                        <Button variant="ghost" size="icon" title="Preview" onClick={() => handlePreviewJob(job)}>
                          <Play className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Open in new tab"
                          onClick={async () => {
                            const video = await swapApi.getResult(job.id);
                            if (video?.file_url) window.open(video.file_url, '_blank');
                          }}
                        >
                          <ExternalLink className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Delete job"
                      onClick={() => handleDeleteJob(job)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                  </div>
                  {/* Live Logs for Processing Jobs */}
                  {job.status === 'processing' && logs.length > 0 && (
                    <div className="mt-3 pt-3 border-t">
                      <div className="text-xs font-medium text-muted-foreground mb-2">Live Logs:</div>
                      <div className="bg-muted/50 rounded p-2 max-h-32 overflow-y-auto font-mono text-xs space-y-0.5">
                        {logs.slice(-10).map((log, idx) => (
                          <div key={idx} className="text-muted-foreground">
                            {log}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* === PREVIEW DIALOGS === */}
      <Dialog open={!!previewVideo} onOpenChange={(open) => !open && setPreviewVideo(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Face Swap Result</DialogTitle>
          </DialogHeader>
          {previewVideo && (
            <div className="space-y-4">
              <div className="aspect-video bg-black rounded-lg overflow-hidden">
                <video src={previewVideo.file_url} controls autoPlay className="w-full h-full" />
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

      <Dialog open={!!previewSourceVideo} onOpenChange={(open) => !open && setPreviewSourceVideo(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{previewSourceVideo?.name || 'Preview Video'}</DialogTitle>
          </DialogHeader>
          {previewSourceVideo && (
            <div className="space-y-4">
              <div className="aspect-video bg-black rounded-lg overflow-hidden">
                <video src={previewSourceVideo.file_url} controls autoPlay className="w-full h-full" />
              </div>
              <p className="text-sm text-muted-foreground text-center">
                Duration: {formatDuration(previewSourceVideo.duration_seconds)}
              </p>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setPreviewSourceVideo(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setSelectedVideo(previewSourceVideo);
                setPreviewSourceVideo(null);
              }}
            >
              Select This Video
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
