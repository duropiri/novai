'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, Sparkles, Download, ImageIcon, ExternalLink, Check, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
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
import { useToast } from '@/components/ui/use-toast';
import {
  loraApi,
  imageGenApi,
  filesApi,
  type LoraModel,
  type ImageGenerationJob,
  type GeneratedImage,
} from '@/lib/api';

const ASPECT_RATIOS = [
  { value: '1:1', label: '1:1 (Square)' },
  { value: '9:16', label: '9:16 (Portrait)' },
  { value: '16:9', label: '16:9 (Landscape)' },
  { value: '4:5', label: '4:5 (Portrait)' },
  { value: '3:4', label: '3:4 (Portrait)' },
] as const;

const NUM_IMAGES_OPTIONS = [1, 2, 4];

export default function ImageGeneratorPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [selectedLora, setSelectedLora] = useState<LoraModel | null>(null);
  const [prompt, setPrompt] = useState('');
  const [sourceImage, setSourceImage] = useState<{ url: string; file?: File } | null>(null);
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '16:9' | '9:16' | '4:5' | '3:4'>('9:16');
  const [numImages, setNumImages] = useState(4);
  const [loraStrength, setLoraStrength] = useState(0.8);
  const [imageStrength, setImageStrength] = useState(0.85);

  // Data
  const [loras, setLoras] = useState<LoraModel[]>([]);
  const [recentJobs, setRecentJobs] = useState<ImageGenerationJob[]>([]);

  // Loading states
  const [isLoadingLoras, setIsLoadingLoras] = useState(true);
  const [isLoadingJobs, setIsLoadingJobs] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  // Preview modal
  const [previewImages, setPreviewImages] = useState<GeneratedImage[] | null>(null);
  const [previewPrompt, setPreviewPrompt] = useState<string>('');

  // Fetch data
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
      const data = await imageGenApi.getHistory(20);
      setRecentJobs(data);
    } catch (error) {
      console.error('Failed to fetch jobs:', error);
    } finally {
      setIsLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    fetchLoras();
    fetchJobs();

    // Poll for job updates
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [fetchLoras, fetchJobs]);

  // Calculate estimated cost (~$0.03 per image)
  const estimatedCost = (numImages * 0.03).toFixed(2);

  // Handle source image upload
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Invalid file',
        description: 'Please select an image file',
        variant: 'destructive',
      });
      return;
    }

    setIsUploadingImage(true);

    try {
      // Create a local preview URL
      const localUrl = URL.createObjectURL(file);
      setSourceImage({ url: localUrl, file });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to process image';
      toast({
        title: 'Upload Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsUploadingImage(false);
    }
  };

  const clearSourceImage = () => {
    if (sourceImage?.url && sourceImage.url.startsWith('blob:')) {
      URL.revokeObjectURL(sourceImage.url);
    }
    setSourceImage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleGenerate = async () => {
    if (!selectedLora) {
      toast({
        title: 'Missing Selection',
        description: 'Please select a LoRA model',
        variant: 'destructive',
      });
      return;
    }

    // Need either prompt or source image
    if (!prompt.trim() && !sourceImage) {
      toast({
        title: 'Missing Input',
        description: 'Please enter a prompt or upload a source image',
        variant: 'destructive',
      });
      return;
    }

    setIsGenerating(true);

    try {
      let sourceImageUrl: string | undefined;

      // Upload source image if provided
      if (sourceImage?.file) {
        const uploadResult = await filesApi.uploadImage(sourceImage.file);
        sourceImageUrl = uploadResult.url;
      }

      const result = await imageGenApi.create({
        loraId: selectedLora.id,
        prompt: prompt.trim() || undefined,
        sourceImageUrl,
        aspectRatio: sourceImageUrl ? undefined : aspectRatio,
        numImages,
        loraStrength,
        imageStrength: sourceImageUrl ? imageStrength : undefined,
      });

      const modeText = result.mode === 'image-to-image' ? 'image transformation' : 'image generation';
      toast({
        title: 'Generation Started',
        description: `Starting ${modeText}. Estimated cost: $${(result.estimatedCostCents / 100).toFixed(2)}`,
      });

      // Refresh jobs list
      fetchJobs();

      // Clear form
      setPrompt('');
      clearSourceImage();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start generation';
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePreviewJob = async (job: ImageGenerationJob) => {
    if (job.status !== 'completed' || !job.images) return;
    setPreviewImages(job.images);
    setPreviewPrompt(job.prompt || '');
  };

  const getJobStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
      case 'queued':
        return <Badge variant="outline">Queued</Badge>;
      case 'processing':
        return (
          <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            Processing
          </Badge>
        );
      case 'completed':
        return (
          <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
            <Check className="w-3 h-3 mr-1" />
            Completed
          </Badge>
        );
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  // Can generate if we have a LoRA and either a prompt or source image
  const canGenerate = selectedLora && (prompt.trim() || sourceImage) && !isGenerating;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Image Generator</h1>
        <p className="text-muted-foreground">
          Generate images using your trained LoRA models with FLUX
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column - Form */}
        <div className="space-y-4">
          {/* 1. Select LoRA Model */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="w-5 h-5" />
                1. Select Model (LoRA)
                <Badge variant="secondary" className="ml-1">Required</Badge>
                {selectedLora && <Badge variant="outline" className="ml-auto">Selected</Badge>}
              </CardTitle>
              <CardDescription>Choose a trained LoRA model for generation</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingLoras ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : loras.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No LoRA models found</p>
                  <p className="text-sm">Train or upload a LoRA model first</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
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
                      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1 truncate text-center">
                        {lora.name}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {selectedLora && (
                <div className="mt-3 p-2 bg-muted rounded-md">
                  <p className="text-sm font-medium truncate">{selectedLora.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Trigger word: <code className="bg-background px-1 rounded">{selectedLora.trigger_word}</code>
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 2. Source Image (Optional) */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Upload className="w-5 h-5" />
                2. Source Image
                <Badge variant="outline" className="ml-1">Optional</Badge>
              </CardTitle>
              <CardDescription>
                Upload an image to recreate with your LoRA model (replaces the person)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />

              {sourceImage ? (
                <div className="relative">
                  <img
                    src={sourceImage.url}
                    alt="Source"
                    className="w-full max-h-48 object-contain rounded-md border"
                  />
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute top-2 right-2 h-6 w-6"
                    onClick={clearSourceImage}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                  <p className="text-xs text-muted-foreground mt-2 text-center">
                    The person in this image will be replaced with your LoRA character
                  </p>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingImage}
                  className="w-full border-2 border-dashed rounded-lg p-6 text-center hover:border-primary/50 transition-colors"
                >
                  {isUploadingImage ? (
                    <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin text-muted-foreground" />
                  ) : (
                    <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                  )}
                  <p className="text-sm text-muted-foreground">
                    Click to upload a source image
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    PNG, JPG up to 10MB
                  </p>
                </button>
              )}
            </CardContent>
          </Card>

          {/* 3. Prompt */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <ImageIcon className="w-5 h-5" />
                3. Prompt
                {!sourceImage && <Badge variant="secondary" className="ml-1">Required</Badge>}
                {sourceImage && <Badge variant="outline" className="ml-1">Optional</Badge>}
              </CardTitle>
              <CardDescription>
                {sourceImage
                  ? 'Optional: Add a prompt to guide the transformation'
                  : 'Describe the image you want to generate'}
                {selectedLora && (
                  <span className="block mt-1 text-xs">
                    Trigger word <code className="bg-muted px-1 rounded">{selectedLora.trigger_word}</code> will be auto-added
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder={sourceImage
                  ? "Optional: describe any changes you want..."
                  : "standing on a beach at sunset, professional photo, high quality..."}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                className="resize-none"
              />
            </CardContent>
          </Card>

          {/* 4. Settings */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">4. Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {!sourceImage && (
                  <div className="space-y-2">
                    <Label>Aspect Ratio</Label>
                    <Select
                      value={aspectRatio}
                      onValueChange={(value) => setAspectRatio(value as typeof aspectRatio)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ASPECT_RATIOS.map((ar) => (
                          <SelectItem key={ar.value} value={ar.value}>
                            {ar.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Number of Images</Label>
                  <Select
                    value={numImages.toString()}
                    onValueChange={(value) => setNumImages(parseInt(value))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NUM_IMAGES_OPTIONS.map((n) => (
                        <SelectItem key={n} value={n.toString()}>
                          {n} image{n > 1 ? 's' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label>LoRA Strength</Label>
                  <span className="text-sm text-muted-foreground">{loraStrength.toFixed(1)}</span>
                </div>
                <Slider
                  value={[loraStrength]}
                  onValueChange={([value]) => setLoraStrength(value)}
                  min={0.5}
                  max={1.0}
                  step={0.1}
                />
              </div>

              {sourceImage && (
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label>Transformation Strength</Label>
                    <span className="text-sm text-muted-foreground">{((1 - imageStrength) * 100).toFixed(0)}%</span>
                  </div>
                  <Slider
                    value={[1 - imageStrength]}
                    onValueChange={([value]) => setImageStrength(1 - value)}
                    min={0}
                    max={1}
                    step={0.05}
                  />
                  <p className="text-xs text-muted-foreground">
                    Higher = more changes to the original image
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Cost + Generate Button */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm text-muted-foreground">Estimated Cost</span>
                <span className="text-lg font-semibold">${estimatedCost}</span>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                Based on {numImages} image{numImages > 1 ? 's' : ''} (~$0.03 per image)
              </p>
              <Button
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="w-full"
                size="lg"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {sourceImage ? 'Transforming...' : 'Generating...'}
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    {sourceImage ? 'Transform Image' : 'Generate Images'}
                  </>
                )}
              </Button>
              {!canGenerate && !isGenerating && (
                <p className="text-xs text-center text-muted-foreground mt-2">
                  {!selectedLora
                    ? 'Select a LoRA model'
                    : !prompt.trim() && !sourceImage
                    ? 'Enter a prompt or upload a source image'
                    : ''}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Results */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Generations</CardTitle>
            <CardDescription>Your image generation history</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingJobs ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : recentJobs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <ImageIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No generations yet</p>
                <p className="text-sm">Select a LoRA and enter a prompt to get started</p>
              </div>
            ) : (
              <div className="space-y-4">
                {recentJobs.map((job) => (
                  <div
                    key={job.jobId}
                    className="border rounded-lg p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {getJobStatusBadge(job.status)}
                        {job.mode === 'image-to-image' && (
                          <Badge variant="outline" className="text-xs">img2img</Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(job.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {job.prompt && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {job.prompt}
                      </p>
                    )}
                    {job.status === 'completed' && job.images && job.images.length > 0 && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-4 gap-1">
                          {job.images.slice(0, 4).map((img, idx) => (
                            <button
                              key={idx}
                              onClick={() => handlePreviewJob(job)}
                              className="aspect-square rounded overflow-hidden hover:ring-2 hover:ring-primary transition-all"
                            >
                              <img
                                src={img.url}
                                alt={`Generated ${idx + 1}`}
                                className="w-full h-full object-cover"
                              />
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="flex-1"
                            onClick={() => handlePreviewJob(job)}
                          >
                            <ExternalLink className="w-3 h-3 mr-1" />
                            View
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Preview Dialog */}
      <Dialog open={!!previewImages} onOpenChange={(open) => !open && setPreviewImages(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Generated Images</DialogTitle>
          </DialogHeader>
          {previewImages && (
            <div className="space-y-4">
              {previewPrompt && (
                <p className="text-sm text-muted-foreground">{previewPrompt}</p>
              )}
              <div className="grid grid-cols-2 gap-4">
                {previewImages.map((img, idx) => (
                  <div key={idx} className="space-y-2">
                    <div className="rounded-lg overflow-hidden border">
                      <img
                        src={img.url}
                        alt={`Generated ${idx + 1}`}
                        className="w-full h-auto"
                      />
                    </div>
                    <div className="flex justify-between items-center text-xs text-muted-foreground">
                      <span>{img.width} x {img.height}</span>
                      <Button size="sm" variant="ghost" asChild>
                        <a href={img.url} download target="_blank" rel="noopener noreferrer">
                          <Download className="w-3 h-3 mr-1" />
                          Download
                        </a>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
