'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Layers,
  Video,
  Music,
  FileText,
  Play,
  Calculator,
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
  Plus,
} from 'lucide-react';
import {
  collectionsApi,
  hooksApi,
  variantsApi,
  Collection,
  Video as VideoType,
  AudioFile,
  Hook,
  VariantBatchResult,
  VariantBatchStatus,
} from '@/lib/api';

interface SelectedCollection {
  id: string;
  name: string;
  type: 'video' | 'audio';
  itemCount?: number;
}

export default function VariantsPage() {
  // Data
  const [videoCollections, setVideoCollections] = useState<Collection[]>([]);
  const [audioCollections, setAudioCollections] = useState<Collection[]>([]);
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [loading, setLoading] = useState(true);

  // Selection state
  const [selectedVideoCollections, setSelectedVideoCollections] = useState<SelectedCollection[]>(
    []
  );
  const [selectedAudioCollections, setSelectedAudioCollections] = useState<SelectedCollection[]>(
    []
  );
  const [selectedHooks, setSelectedHooks] = useState<Hook[]>([]);

  // Collection details (for counts)
  const [collectionDetails, setCollectionDetails] = useState<Map<string, number>>(new Map());

  // Selection dialogs
  const [videoDialogOpen, setVideoDialogOpen] = useState(false);
  const [audioDialogOpen, setAudioDialogOpen] = useState(false);
  const [hookDialogOpen, setHookDialogOpen] = useState(false);

  // Processing state
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentBatch, setCurrentBatch] = useState<VariantBatchResult | null>(null);
  const [batchStatus, setBatchStatus] = useState<VariantBatchStatus | null>(null);

  // Load initial data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [videoCols, audioCols, hooksData] = await Promise.all([
        collectionsApi.list('video'),
        collectionsApi.list('audio'),
        hooksApi.list(),
      ]);
      setVideoCollections(videoCols);
      setAudioCollections(audioCols);
      setHooks(hooksData);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Calculate total variants
  const variantCalculation = useMemo(() => {
    const videoCount = selectedVideoCollections.reduce(
      (sum, col) => sum + (collectionDetails.get(col.id) || col.name.match(/\((\d+)\)$/)?.[1] ? parseInt(col.name.match(/\((\d+)\)$/)?.[1] || '0') : 0),
      0
    );
    const audioCount = selectedAudioCollections.reduce(
      (sum, col) => sum + (collectionDetails.get(col.id) || 0),
      0
    );
    const hookCount = selectedHooks.length;

    // Calculate combinations based on "round robin" assignment
    // In round robin, each video gets paired with audio/hooks in sequence
    // Total variants = videos * (audios > 0 ? 1 : 1) * (hooks > 0 ? 1 : 1) when round robin
    // For full combinations: videos * audios * hooks (if all selected)

    const totalVideos = selectedVideoCollections.reduce(
      (sum, col) => sum + (col.itemCount || 0),
      0
    );
    const totalAudios = selectedAudioCollections.reduce(
      (sum, col) => sum + (col.itemCount || 0),
      0
    );
    const totalHooks = selectedHooks.length;

    // For round robin, max variants = max(videos, audios, hooks) combinations per "round"
    // but typically: each video * rotation through audios/hooks
    const maxVariants = totalVideos > 0 ? totalVideos : 0;

    return {
      videoCount: totalVideos,
      audioCount: totalAudios,
      hookCount: totalHooks,
      totalVariants: maxVariants,
      isReady: totalVideos > 0,
    };
  }, [selectedVideoCollections, selectedAudioCollections, selectedHooks, collectionDetails]);

  // Add video collection
  const addVideoCollection = (collection: Collection) => {
    if (!selectedVideoCollections.find((c) => c.id === collection.id)) {
      setSelectedVideoCollections([
        ...selectedVideoCollections,
        { id: collection.id, name: collection.name, type: 'video', itemCount: collection.itemCount },
      ]);
    }
    setVideoDialogOpen(false);
  };

  // Add audio collection
  const addAudioCollection = (collection: Collection) => {
    if (!selectedAudioCollections.find((c) => c.id === collection.id)) {
      setSelectedAudioCollections([
        ...selectedAudioCollections,
        { id: collection.id, name: collection.name, type: 'audio', itemCount: collection.itemCount },
      ]);
    }
    setAudioDialogOpen(false);
  };

  // Toggle hook selection
  const toggleHook = (hook: Hook) => {
    const isSelected = selectedHooks.find((h) => h.id === hook.id);
    if (isSelected) {
      setSelectedHooks(selectedHooks.filter((h) => h.id !== hook.id));
    } else {
      setSelectedHooks([...selectedHooks, hook]);
    }
  };

  // Remove selections
  const removeVideoCollection = (id: string) => {
    setSelectedVideoCollections(selectedVideoCollections.filter((c) => c.id !== id));
  };

  const removeAudioCollection = (id: string) => {
    setSelectedAudioCollections(selectedAudioCollections.filter((c) => c.id !== id));
  };

  const removeHook = (id: string) => {
    setSelectedHooks(selectedHooks.filter((h) => h.id !== id));
  };

  // Generate variants
  const handleGenerate = async () => {
    if (!variantCalculation.isReady) return;

    setGenerating(true);
    setProgress(0);
    setCurrentBatch(null);
    setBatchStatus(null);

    try {
      // Create variant batch via API
      const batch = await variantsApi.createBatch({
        videoCollectionIds: selectedVideoCollections.map((c) => c.id),
        audioCollectionIds: selectedAudioCollections.length > 0
          ? selectedAudioCollections.map((c) => c.id)
          : undefined,
        hookIds: selectedHooks.length > 0
          ? selectedHooks.map((h) => h.id)
          : undefined,
        hookDuration: 5,
        hookPosition: 'bottom',
      });

      setCurrentBatch(batch);

      // Poll for batch status
      const pollInterval = setInterval(async () => {
        try {
          const status = await variantsApi.getBatchStatus(batch.batchId);
          setBatchStatus(status);

          const completed = status.completed + status.failed;
          const progressPercent = status.total > 0 ? (completed / status.total) * 100 : 0;
          setProgress(progressPercent);

          if (status.pending === 0 && status.processing === 0) {
            clearInterval(pollInterval);
            setGenerating(false);

            if (status.failed > 0) {
              alert(`Batch completed with ${status.failed} failures out of ${status.total} variants`);
            } else {
              alert(`Successfully generated ${status.completed} variants!`);
            }
          }
        } catch (err) {
          console.error('Failed to poll batch status:', err);
        }
      }, 3000);

    } catch (error) {
      console.error('Failed to generate variants:', error);
      alert('Failed to start variant generation');
      setGenerating(false);
      setProgress(0);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Variant Generator</h1>
          <p className="text-muted-foreground">
            Combine videos, audio tracks, and hooks to create unique variants
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Video Collections */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Video className="h-5 w-5" />
              Videos
            </CardTitle>
            <CardDescription>Select video collections to include</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedVideoCollections.map((col) => (
              <div
                key={col.id}
                className="flex items-center justify-between p-2 rounded bg-muted"
              >
                <span className="text-sm truncate flex-1">{col.name}</span>
                <Badge variant="secondary" className="ml-2">
                  {col.itemCount || 0}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 ml-2"
                  onClick={() => removeVideoCollection(col.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}

            <Button
              variant="outline"
              className="w-full"
              onClick={() => setVideoDialogOpen(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Collection
            </Button>
          </CardContent>
        </Card>

        {/* Audio Collections */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Music className="h-5 w-5" />
              Audio Tracks
            </CardTitle>
            <CardDescription>Select audio collections (round-robin)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedAudioCollections.map((col) => (
              <div
                key={col.id}
                className="flex items-center justify-between p-2 rounded bg-muted"
              >
                <span className="text-sm truncate flex-1">{col.name}</span>
                <Badge variant="secondary" className="ml-2">
                  {col.itemCount || 0}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 ml-2"
                  onClick={() => removeAudioCollection(col.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}

            <Button
              variant="outline"
              className="w-full"
              onClick={() => setAudioDialogOpen(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Collection
            </Button>
          </CardContent>
        </Card>

        {/* Hooks */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Text Hooks
            </CardTitle>
            <CardDescription>Select hooks to overlay (round-robin)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedHooks.map((hook) => (
              <div
                key={hook.id}
                className="flex items-center justify-between p-2 rounded bg-muted"
              >
                <span className="text-sm truncate flex-1">{hook.text}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 ml-2"
                  onClick={() => removeHook(hook.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}

            <Button
              variant="outline"
              className="w-full"
              onClick={() => setHookDialogOpen(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Hooks
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Summary and Generate */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Generation Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4 mb-6">
            <div className="text-center p-4 rounded bg-muted">
              <p className="text-2xl font-bold">{variantCalculation.videoCount}</p>
              <p className="text-sm text-muted-foreground">Videos</p>
            </div>
            <div className="text-center p-4 rounded bg-muted">
              <p className="text-2xl font-bold">{variantCalculation.audioCount}</p>
              <p className="text-sm text-muted-foreground">Audio Tracks</p>
            </div>
            <div className="text-center p-4 rounded bg-muted">
              <p className="text-2xl font-bold">{variantCalculation.hookCount}</p>
              <p className="text-sm text-muted-foreground">Hooks</p>
            </div>
            <div className="text-center p-4 rounded bg-primary text-primary-foreground">
              <p className="text-2xl font-bold">{variantCalculation.totalVariants}</p>
              <p className="text-sm opacity-80">Total Variants</p>
            </div>
          </div>

          {generating && (
            <div className="mb-4">
              <Progress value={progress} className="h-2" />
              <p className="text-sm text-muted-foreground mt-2 text-center">
                Generating variants... {progress}%
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              size="lg"
              disabled={!variantCalculation.isReady || generating}
              onClick={handleGenerate}
            >
              {generating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Generate Variants
                </>
              )}
            </Button>
          </div>

          {!variantCalculation.isReady && (
            <p className="text-sm text-muted-foreground mt-4 text-center">
              Add at least one video collection to generate variants
            </p>
          )}
        </CardContent>
      </Card>

      {/* Video Collection Selection Dialog */}
      <Dialog open={videoDialogOpen} onOpenChange={setVideoDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Select Video Collection</DialogTitle>
            <DialogDescription>
              Choose a video collection to add to the variant generator
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {videoCollections.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No video collections available. Create one in the Videos library.
              </p>
            ) : (
              videoCollections
                .filter((col) => !selectedVideoCollections.find((s) => s.id === col.id))
                .map((col) => (
                  <div
                    key={col.id}
                    className="flex items-center justify-between p-3 rounded border hover:bg-muted cursor-pointer"
                    onClick={() => addVideoCollection(col)}
                  >
                    <span>{col.name}</span>
                    <Badge variant="secondary">{col.itemCount || 0} videos</Badge>
                  </div>
                ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Audio Collection Selection Dialog */}
      <Dialog open={audioDialogOpen} onOpenChange={setAudioDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Select Audio Collection</DialogTitle>
            <DialogDescription>
              Choose an audio collection to add to the variant generator
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {audioCollections.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No audio collections available. Create one in the Audios library.
              </p>
            ) : (
              audioCollections
                .filter((col) => !selectedAudioCollections.find((s) => s.id === col.id))
                .map((col) => (
                  <div
                    key={col.id}
                    className="flex items-center justify-between p-3 rounded border hover:bg-muted cursor-pointer"
                    onClick={() => addAudioCollection(col)}
                  >
                    <span>{col.name}</span>
                    <Badge variant="secondary">{col.itemCount || 0} tracks</Badge>
                  </div>
                ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Hooks Selection Dialog */}
      <Dialog open={hookDialogOpen} onOpenChange={setHookDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Select Hooks</DialogTitle>
            <DialogDescription>
              Choose hooks to include in the variant generator ({selectedHooks.length} selected)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {hooks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No hooks available. Create some in the Hooks library.
              </p>
            ) : (
              hooks.map((hook) => {
                const isSelected = selectedHooks.find((h) => h.id === hook.id);
                return (
                  <div
                    key={hook.id}
                    className={`flex items-center justify-between p-3 rounded border cursor-pointer ${
                      isSelected ? 'bg-primary/10 border-primary' : 'hover:bg-muted'
                    }`}
                    onClick={() => toggleHook(hook)}
                  >
                    <span className="text-sm flex-1">{hook.text}</span>
                    {hook.category && (
                      <Badge variant="outline" className="ml-2">
                        {hook.category}
                      </Badge>
                    )}
                    {isSelected && <CheckCircle2 className="h-4 w-4 text-primary ml-2" />}
                  </div>
                );
              })
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setHookDialogOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
