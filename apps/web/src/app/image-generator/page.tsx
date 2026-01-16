'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, Sparkles, Download, ImageIcon, ExternalLink, Check, Upload, X, User, Users, Trash2 } from 'lucide-react';
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
  characterApi,
  referenceKitApi,
  expressionBoardApi,
  imageGenApi,
  filesApi,
  type LoraModel,
  type CharacterDiagram,
  type ReferenceKit,
  type ExpressionBoard,
  type ImageGenerationJob,
  type GeneratedImage,
} from '@/lib/api';

type IdentitySource = 'lora' | 'character-diagram' | 'reference-kit' | 'expression-board';

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

  // Identity source selection
  const [identitySource, setIdentitySource] = useState<IdentitySource>('lora');
  const [selectedLora, setSelectedLora] = useState<LoraModel | null>(null);
  const [selectedDiagram, setSelectedDiagram] = useState<CharacterDiagram | null>(null);
  const [selectedReferenceKit, setSelectedReferenceKit] = useState<ReferenceKit | null>(null);
  const [selectedExpressionBoard, setSelectedExpressionBoard] = useState<ExpressionBoard | null>(null);

  // Form state
  const [prompt, setPrompt] = useState('');
  const [sourceImage, setSourceImage] = useState<{ url: string; file?: File } | null>(null);
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '16:9' | '9:16' | '4:5' | '3:4'>('9:16');
  const [numImages, setNumImages] = useState(4);
  const [loraStrength, setLoraStrength] = useState(0.8);
  const [imageStrength, setImageStrength] = useState(0.85);

  // Data
  const [loras, setLoras] = useState<LoraModel[]>([]);
  const [diagrams, setDiagrams] = useState<CharacterDiagram[]>([]);
  const [referenceKits, setReferenceKits] = useState<ReferenceKit[]>([]);
  const [expressionBoards, setExpressionBoards] = useState<ExpressionBoard[]>([]);
  const [recentJobs, setRecentJobs] = useState<ImageGenerationJob[]>([]);

  // Loading states
  const [isLoadingLoras, setIsLoadingLoras] = useState(true);
  const [isLoadingDiagrams, setIsLoadingDiagrams] = useState(true);
  const [isLoadingReferenceKits, setIsLoadingReferenceKits] = useState(true);
  const [isLoadingExpressionBoards, setIsLoadingExpressionBoards] = useState(true);
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

  const fetchExpressionBoards = useCallback(async () => {
    try {
      const data = await expressionBoardApi.list();
      setExpressionBoards(data.filter((b) => b.status === 'ready'));
    } catch (error) {
      console.error('Failed to fetch expression boards:', error);
    } finally {
      setIsLoadingExpressionBoards(false);
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
    fetchDiagrams();
    fetchReferenceKits();
    fetchExpressionBoards();
    fetchJobs();

    // Poll for job updates
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [fetchLoras, fetchDiagrams, fetchReferenceKits, fetchExpressionBoards, fetchJobs]);

  // Calculate estimated cost
  // Flux PuLID (Character Diagram): ~$0.04 per image
  // Reference Kit (Gemini): ~$0.03 per image
  // Expression Board (Gemini): ~$0.03 per image
  // LoRA Face swap: ~$0.04 per image
  // LoRA Text-to-image: ~$0.03 per image
  const isPulidOrFaceSwap = sourceImage || identitySource === 'character-diagram';
  const isReferenceKitMode = identitySource === 'reference-kit';
  const isExpressionBoardMode = identitySource === 'expression-board';
  const costPerImage = isPulidOrFaceSwap ? 0.04 : (isReferenceKitMode || isExpressionBoardMode) ? 0.03 : 0.03;
  const estimatedCost = (numImages * costPerImage).toFixed(2);

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
    // Validate identity source selection
    if (identitySource === 'lora' && !selectedLora) {
      toast({
        title: 'Missing Selection',
        description: 'Please select a LoRA model',
        variant: 'destructive',
      });
      return;
    }
    if (identitySource === 'character-diagram' && !selectedDiagram) {
      toast({
        title: 'Missing Selection',
        description: 'Please select a Character Diagram',
        variant: 'destructive',
      });
      return;
    }
    if (identitySource === 'reference-kit' && !selectedReferenceKit) {
      toast({
        title: 'Missing Selection',
        description: 'Please select a Reference Kit',
        variant: 'destructive',
      });
      return;
    }
    if (identitySource === 'expression-board' && !selectedExpressionBoard) {
      toast({
        title: 'Missing Selection',
        description: 'Please select an Expression Board',
        variant: 'destructive',
      });
      return;
    }

    // Text-to-image mode requires prompt (when no source image)
    if (!sourceImage && !prompt.trim()) {
      toast({
        title: 'Missing Prompt',
        description: 'Please enter a prompt to describe what you want to generate',
        variant: 'destructive',
      });
      return;
    }
    // Face swap mode (source image provided) - prompt is optional, will be auto-generated on backend

    setIsGenerating(true);

    try {
      let sourceImageUrl: string | undefined;

      // Upload source image if provided
      if (sourceImage?.file) {
        const uploadResult = await filesApi.uploadImage(sourceImage.file);
        sourceImageUrl = uploadResult.url;
      }

      const result = await imageGenApi.create({
        ...(identitySource === 'lora'
          ? { loraId: selectedLora!.id, loraStrength }
          : identitySource === 'character-diagram'
          ? { characterDiagramId: selectedDiagram!.id }
          : identitySource === 'reference-kit'
          ? { referenceKitId: selectedReferenceKit!.id }
          : { expressionBoardId: selectedExpressionBoard!.id }),
        prompt: prompt.trim() || undefined,
        sourceImageUrl,
        // Always pass aspectRatio for character diagram mode or LoRA text-to-image or expression board
        aspectRatio: identitySource === 'character-diagram' || identitySource === 'reference-kit' || identitySource === 'expression-board' || !sourceImageUrl ? aspectRatio : undefined,
        numImages,
        imageStrength: sourceImageUrl ? imageStrength : undefined,
      });

      const modeText = result.mode === 'character-diagram-swap' ? 'identity generation (Flux PuLID)'
        : result.mode === 'face-swap' ? 'face swap'
        : result.mode === 'expression-board-swap' ? 'expression board swap'
        : 'image generation';
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

  const handleDeleteJob = async (jobId: string) => {
    if (!confirm('Delete this generation? This cannot be undone.')) return;

    try {
      await imageGenApi.delete(jobId);
      setRecentJobs((prev) => prev.filter((j) => j.jobId !== jobId));
      toast({
        title: 'Deleted',
        description: 'Generation deleted successfully',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete';
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
    }
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

  // Can generate based on identity source and mode:
  // - Face swap mode (source image provided): need identity only, prompt is auto-generated
  // - Text-to-image mode (no source image): need identity AND prompt
  const isFaceSwapMode = !!sourceImage;
  const canGenerate =
    (identitySource === 'lora' && selectedLora && (isFaceSwapMode || prompt.trim())) ||
    (identitySource === 'character-diagram' && selectedDiagram && (isFaceSwapMode || prompt.trim())) ||
    (identitySource === 'reference-kit' && selectedReferenceKit && (isFaceSwapMode || prompt.trim())) ||
    (identitySource === 'expression-board' && selectedExpressionBoard && (isFaceSwapMode || prompt.trim()));
  const canGenerateNow = canGenerate && !isGenerating;

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
          {/* 1. Select Identity Source */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                {identitySource === 'lora' ? <Sparkles className="w-5 h-5" /> : identitySource === 'reference-kit' ? <Users className="w-5 h-5" /> : identitySource === 'expression-board' ? <ImageIcon className="w-5 h-5" /> : <User className="w-5 h-5" />}
                1. Select Identity Source
                <Badge variant="secondary" className="ml-1">Required</Badge>
                {(selectedLora || selectedDiagram || selectedReferenceKit || selectedExpressionBoard) && <Badge variant="outline" className="ml-auto">Selected</Badge>}
              </CardTitle>
              <CardDescription>
                Choose an identity source for face generation
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Toggle between LoRA, Character Diagram, Reference Kit, and Expression Board */}
              <div className="grid grid-cols-4 gap-2">
                <Button
                  variant={identitySource === 'lora' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setIdentitySource('lora');
                    setSelectedDiagram(null);
                    setSelectedReferenceKit(null);
                    setSelectedExpressionBoard(null);
                  }}
                >
                  <Sparkles className="w-4 h-4 mr-1" />
                  LoRA
                </Button>
                <Button
                  variant={identitySource === 'character-diagram' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setIdentitySource('character-diagram');
                    setSelectedLora(null);
                    setSelectedReferenceKit(null);
                    setSelectedExpressionBoard(null);
                  }}
                >
                  <User className="w-4 h-4 mr-1" />
                  Diagram
                </Button>
                <Button
                  variant={identitySource === 'reference-kit' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setIdentitySource('reference-kit');
                    setSelectedLora(null);
                    setSelectedDiagram(null);
                    setSelectedExpressionBoard(null);
                  }}
                >
                  <Users className="w-4 h-4 mr-1" />
                  Ref Kit
                </Button>
                <Button
                  variant={identitySource === 'expression-board' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setIdentitySource('expression-board');
                    setSelectedLora(null);
                    setSelectedDiagram(null);
                    setSelectedReferenceKit(null);
                  }}
                >
                  <ImageIcon className="w-4 h-4 mr-1" />
                  Expr Board
                </Button>
              </div>

              {/* Identity source comparison helper */}
              <div className="p-3 bg-muted/50 rounded-lg text-xs space-y-1">
                <p className="font-medium text-muted-foreground">Which should I use?</p>
                <ul className="text-muted-foreground space-y-0.5">
                  <li>• <strong>LoRA</strong> — Trained on real photos, highest accuracy (~$5, 1 hour)</li>
                  <li>• <strong>Diagram</strong> — Single reference image, quick face swaps</li>
                  <li>• <strong>Ref Kit</strong> — Multi-angle AI references (~$0.20, instant)</li>
                  <li>• <strong>Expr Board</strong> — Pre-generated expression set, multi-angle references</li>
                </ul>
              </div>

              {/* Show appropriate selector based on identity source */}
              {identitySource === 'lora' ? (
                // LoRA selector
                <>
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
                    <div className="p-2 bg-muted rounded-md">
                      <p className="text-sm font-medium truncate">{selectedLora.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Trigger word: <code className="bg-background px-1 rounded">{selectedLora.trigger_word}</code>
                      </p>
                    </div>
                  )}
                </>
              ) : identitySource === 'character-diagram' ? (
                // Character Diagram selector
                <>
                  {isLoadingDiagrams ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  ) : diagrams.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <p>No Character Diagrams found</p>
                      <p className="text-sm">Create a Character Diagram first</p>
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
                          <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1 truncate text-center">
                            {diagram.name}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedDiagram && (
                    <div className="p-2 bg-muted rounded-md">
                      <p className="text-sm font-medium truncate">{selectedDiagram.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Uses Flux PuLID for natural identity-preserving generation
                      </p>
                    </div>
                  )}
                </>
              ) : identitySource === 'reference-kit' ? (
                // Reference Kit selector
                <>
                  {isLoadingReferenceKits ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  ) : referenceKits.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <p>No Reference Kits found</p>
                      <p className="text-sm">Create a Reference Kit first</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
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
                              <Users className="w-6 h-6 text-muted-foreground" />
                            </div>
                          )}
                          <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1 truncate text-center">
                            {kit.name}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedReferenceKit && (
                    <div className="p-2 bg-muted rounded-md">
                      <p className="text-sm font-medium truncate">{selectedReferenceKit.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Multi-reference identity preservation (anchor + profile)
                      </p>
                    </div>
                  )}
                </>
              ) : identitySource === 'expression-board' ? (
                // Expression Board selector
                <>
                  {isLoadingExpressionBoards ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  ) : expressionBoards.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <p>No Expression Boards found</p>
                      <p className="text-sm">Create an Expression Board first</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                      {expressionBoards.map((board) => (
                        <button
                          key={board.id}
                          onClick={() => setSelectedExpressionBoard(board)}
                          className={`relative aspect-square rounded-md overflow-hidden border-2 transition-all ${
                            selectedExpressionBoard?.id === board.id
                              ? 'border-primary ring-2 ring-primary/50'
                              : 'border-transparent hover:border-muted-foreground/50'
                          }`}
                        >
                          {board.board_url ? (
                            <img
                              src={board.board_url}
                              alt={board.name || 'Expression Board'}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full bg-muted flex items-center justify-center">
                              <ImageIcon className="w-6 h-6 text-muted-foreground" />
                            </div>
                          )}
                          <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1 truncate text-center">
                            {board.name || 'Expression Board'}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedExpressionBoard && (
                    <div className="p-2 bg-muted rounded-md">
                      <p className="text-sm font-medium truncate">{selectedExpressionBoard.name || 'Expression Board'}</p>
                      <p className="text-xs text-muted-foreground">
                        {selectedExpressionBoard.expressions?.length || 0} expressions available
                      </p>
                    </div>
                  )}
                </>
              ) : null}
            </CardContent>
          </Card>

          {/* 2. Source Image - Required for Character Diagram, Optional for LoRA */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Upload className="w-5 h-5" />
                2. Source Image
                {identitySource === 'character-diagram' ? (
                  <Badge variant="secondary" className="ml-1">Required</Badge>
                ) : (
                  <Badge variant="outline" className="ml-1">Optional</Badge>
                )}
                {sourceImage && <Badge className="ml-auto bg-blue-500/10 text-blue-600 border-blue-500/20">Face Swap Mode</Badge>}
              </CardTitle>
              <CardDescription>
                {identitySource === 'character-diagram'
                  ? sourceImage
                    ? 'The face from your Character Diagram will be swapped into this image'
                    : 'Upload the image you want to swap the face into'
                  : sourceImage
                    ? 'The face in this image will be swapped with your LoRA identity'
                    : 'Upload an image to swap faces, or skip to generate from text prompt'}
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
                    {identitySource === 'character-diagram'
                      ? 'The face from your Character Diagram will be swapped into this image'
                      : 'The face in this image will be replaced with your LoRA identity'}
                  </p>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingImage}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file && file.type.startsWith('image/')) {
                      setSourceImage({ url: URL.createObjectURL(file), file });
                    }
                  }}
                  className="w-full border-2 border-dashed rounded-lg p-8 text-center hover:border-primary/50 transition-colors"
                >
                  {isUploadingImage ? (
                    <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin text-muted-foreground" />
                  ) : (
                    <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                  )}
                  <p className="text-sm text-muted-foreground">
                    Click to upload or drag and drop
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    PNG, JPG up to 10MB
                  </p>
                </button>
              )}
            </CardContent>
          </Card>

          {/* Prompt - Only show when NOT in face swap mode */}
          {!sourceImage ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ImageIcon className="w-5 h-5" />
                  3. Prompt
                  <Badge variant="secondary" className="ml-1">Required</Badge>
                </CardTitle>
                <CardDescription>
                  Describe the scene, pose, and style you want to generate
                  {identitySource === 'lora' && selectedLora && (
                    <span className="block mt-1 text-xs">
                      Trigger word <code className="bg-muted px-1 rounded">{selectedLora.trigger_word}</code> will be auto-added
                    </span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  placeholder="professional portrait photo, natural lighting, looking at camera..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                  className="resize-none"
                />
              </CardContent>
            </Card>
          ) : (
            /* Face Swap Mode Info Box */
            <Card className="border-blue-200 bg-blue-50/50">
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-full bg-blue-100">
                    <User className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="font-medium text-blue-900">Face Swap Mode</h3>
                    <p className="text-sm text-blue-700 mt-1">
                      {identitySource === 'character-diagram'
                        ? 'The face from your Character Diagram will be used to generate images with the same identity, pose, and style as your source image.'
                        : 'A reference face will be generated from your LoRA, then used to create images matching the pose and style of your source image.'}
                    </p>
                    <p className="text-xs text-blue-600 mt-2">
                      No prompt needed - the system will automatically optimize for best results.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Settings */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">4. Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {/* Aspect ratio only for generation mode (no source image) */}
                {!sourceImage ? (
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
                ) : (
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">Output Size</Label>
                    <p className="text-sm text-muted-foreground">
                      Matches source image dimensions
                    </p>
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

              {/* Only show LoRA strength for LoRA text-to-image mode (not face swap, not Character Diagram) */}
              {identitySource === 'lora' && !sourceImage && (
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
                  <p className="text-xs text-muted-foreground">
                    How strongly the LoRA influences the generated image
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
                Based on {numImages} image{numImages > 1 ? 's' : ''} (~${costPerImage.toFixed(2)} per image)
              </p>
              <Button
                onClick={handleGenerate}
                disabled={!canGenerateNow}
                className="w-full"
                size="lg"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {sourceImage ? 'Processing...' : 'Generating...'}
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    {sourceImage ? 'Swap Face' : 'Generate Images'}
                  </>
                )}
              </Button>
              {!canGenerate && !isGenerating && (
                <p className="text-xs text-center text-muted-foreground mt-2">
                  {identitySource === 'lora' && !selectedLora
                    ? 'Select a LoRA model'
                    : identitySource === 'character-diagram' && !selectedDiagram
                    ? 'Select a Character Diagram'
                    : identitySource === 'reference-kit' && !selectedReferenceKit
                    ? 'Select a Reference Kit'
                    : identitySource === 'expression-board' && !selectedExpressionBoard
                    ? 'Select an Expression Board'
                    : !sourceImage && !prompt.trim()
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
                        {(job.mode === 'face-swap' || job.mode === 'character-diagram-swap') && (
                          <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-600 border-blue-500/20">face swap</Badge>
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
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteJob(job.jobId)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    )}
                    {/* Delete button for non-completed jobs */}
                    {job.status !== 'completed' && (
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteJob(job.jobId)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="w-3 h-3 mr-1" />
                          Delete
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
