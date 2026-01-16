'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Trash2, Loader2, CheckCircle, XCircle, Clock, FileUp, Check, X, Pencil, Terminal, ChevronDown, ChevronUp, StopCircle, RotateCcw, Info, Settings, ChevronLeft, ChevronRight, Images, Grid3X3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/components/ui/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { loraApi, filesApi, type LoraModel } from '@/lib/api';
import { processFilesWithZipSupport } from '@/lib/zip-utils';
import { FaceSelector, type FaceProcessingResult } from '@/components/face-selector';

// Training log entry for persistent storage
interface TrainingLogEntry {
  id: string;
  name: string;
  status: LoraModel['status'];
  progress: number;
  statusMessage: string;
  timestamp: string;
  completedAt?: string;
}

const TRAINING_LOG_KEY = 'lora-training-log';

// Load training log from localStorage
function loadTrainingLog(): TrainingLogEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(TRAINING_LOG_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

// Save training log to localStorage
function saveTrainingLog(log: TrainingLogEntry[]) {
  if (typeof window === 'undefined') return;
  // Keep only last 50 entries
  const trimmed = log.slice(-50);
  localStorage.setItem(TRAINING_LOG_KEY, JSON.stringify(trimmed));
}

export default function LoraCreatorPage() {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [triggerWord, setTriggerWord] = useState('');
  const [steps, setSteps] = useState(1000);
  const [files, setFiles] = useState<File[]>([]);
  const [isProcessingZip, setIsProcessingZip] = useState(false);
  const [isProcessingVideo, setIsProcessingVideo] = useState(false);
  const [googleDriveUrl, setGoogleDriveUrl] = useState('');
  const [googleDriveZipUrl, setGoogleDriveZipUrl] = useState<string | null>(null);
  const [googleDriveImageCount, setGoogleDriveImageCount] = useState(0);
  const [isImportingDrive, setIsImportingDrive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [loraModels, setLoraModels] = useState<LoraModel[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(true);

  // WAN 2.2 training settings
  const [isStyle, setIsStyle] = useState(false);
  const [learningRate, setLearningRate] = useState(0.0007);
  const [includeSyntheticCaptions, setIncludeSyntheticCaptions] = useState(false);
  const [useFaceDetection, setUseFaceDetection] = useState(true);
  const [useFaceCropping, setUseFaceCropping] = useState(true); // HiRA - prioritize face resemblance
  const [useMasks, setUseMasks] = useState(true);
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false);

  // Upload/Import modal state
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadTab, setUploadTab] = useState<'file' | 'url'>('file');
  // File upload state
  const [uploadName, setUploadName] = useState('');
  const [uploadTriggerWord, setUploadTriggerWord] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadThumbnail, setUploadThumbnail] = useState<File | null>(null);
  const [isUploadingLora, setIsUploadingLora] = useState(false);
  // URL import state
  const [importName, setImportName] = useState('');
  const [importTriggerWord, setImportTriggerWord] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [importThumbnailUrl, setImportThumbnailUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  // Edit modal state
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameModel, setRenameModel] = useState<LoraModel | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renameTriggerWord, setRenameTriggerWord] = useState('');
  const [renameThumbnail, setRenameThumbnail] = useState<File | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);

  // Training log state
  const [trainingLog, setTrainingLog] = useState<TrainingLogEntry[]>([]);
  const prevModelsRef = useRef<Map<string, LoraModel>>(new Map());

  // HiRA (High Rank Adaptation) face identity state
  const [enableFaceIdentity, setEnableFaceIdentity] = useState(true);
  const [createdLoraId, setCreatedLoraId] = useState<string | null>(null);
  const [faceProcessingResult, setFaceProcessingResult] = useState<FaceProcessingResult | null>(null);
  const [selectedFaceIdentityId, setSelectedFaceIdentityId] = useState<string | null>(null);

  // Pending deletions state (for undo functionality)
  const [pendingDeletions, setPendingDeletions] = useState<Set<string>>(new Set());
  const deletionTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const DELETION_DELAY_MS = 5000; // 5 seconds to undo

  // Image gallery state
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const PREVIEW_LIMIT = 12; // Max images to show in grid preview

  // Load training log from localStorage on mount
  useEffect(() => {
    setTrainingLog(loadTrainingLog());
  }, []);

  // Update training log when models change
  const updateTrainingLog = useCallback((models: LoraModel[]) => {
    const now = new Date().toISOString();
    const prevModels = prevModelsRef.current;

    setTrainingLog((currentLog) => {
      let updatedLog = [...currentLog];

      for (const model of models) {
        // Only track models that are training, pending, or recently completed/failed
        if (model.status === 'pending' || model.status === 'training' ||
            model.status === 'ready' || model.status === 'failed') {

          const prevModel = prevModels.get(model.id);
          const existingIndex = updatedLog.findIndex(e => e.id === model.id);

          // Check if there's a meaningful update
          const hasUpdate = !prevModel ||
            prevModel.status !== model.status ||
            prevModel.progress !== model.progress ||
            prevModel.status_message !== model.status_message;

          if (hasUpdate) {
            const entry: TrainingLogEntry = {
              id: model.id,
              name: model.name,
              status: model.status,
              progress: model.progress ?? 0,
              statusMessage: model.status_message || getDefaultStatusMessage(model.status),
              timestamp: now,
              completedAt: (model.status === 'ready' || model.status === 'failed') ? now : undefined,
            };

            if (existingIndex >= 0) {
              // Update existing entry
              updatedLog[existingIndex] = entry;
            } else if (model.status === 'pending' || model.status === 'training') {
              // Add new entry for active trainings
              updatedLog.push(entry);
            }
          }
        }
      }

      // Save to localStorage
      saveTrainingLog(updatedLog);
      return updatedLog;
    });

    // Update previous models reference
    const newMap = new Map<string, LoraModel>();
    models.forEach(m => newMap.set(m.id, m));
    prevModelsRef.current = newMap;
  }, []);

  function getDefaultStatusMessage(status: LoraModel['status']): string {
    switch (status) {
      case 'pending': return 'Waiting in queue...';
      case 'training': return 'Training in progress...';
      case 'ready': return 'Training completed successfully!';
      case 'failed': return 'Training failed';
      default: return '';
    }
  }

  // Fetch existing LoRA models
  const fetchModels = useCallback(async () => {
    try {
      const models = await loraApi.list();
      setLoraModels(models);
      updateTrainingLog(models);
    } catch (error) {
      console.error('Failed to fetch LoRA models:', error);
    } finally {
      setIsLoadingModels(false);
    }
  }, [updateTrainingLog]);

  useEffect(() => {
    fetchModels();
    // Poll for updates every 5 seconds for training models (faster updates)
    const interval = setInterval(fetchModels, 5000);
    return () => clearInterval(interval);
  }, [fetchModels]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    // Separate videos from other files
    const videoFiles = acceptedFiles.filter(f =>
      f.type.startsWith('video/') || ['.mp4', '.mov', '.avi', '.webm'].some(ext => f.name.toLowerCase().endsWith(ext))
    );
    const otherFiles = acceptedFiles.filter(f =>
      !f.type.startsWith('video/') && !['.mp4', '.mov', '.avi', '.webm'].some(ext => f.name.toLowerCase().endsWith(ext))
    );

    // Process non-video files (images and ZIPs)
    if (otherFiles.length > 0) {
      setIsProcessingZip(true);
      try {
        const imageFiles = await processFilesWithZipSupport(otherFiles);
        setFiles((prev) => [...prev, ...imageFiles]);
      } finally {
        setIsProcessingZip(false);
      }
    }

    // Process video files - extract frames via API
    if (videoFiles.length > 0) {
      setIsProcessingVideo(true);
      toast({ title: 'Processing Videos', description: `Extracting frames from ${videoFiles.length} video(s)...` });

      for (const video of videoFiles) {
        try {
          const formData = new FormData();
          formData.append('video', video);

          const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/files/extract-frames?maxFrames=50&targetFps=1`, {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            throw new Error(`Failed to extract frames from ${video.name}`);
          }

          const data = await response.json();
          const frameUrls: string[] = data.frames || [];

          // Convert frame URLs to File objects by fetching them
          const frameFiles: File[] = [];
          for (let i = 0; i < frameUrls.length; i++) {
            const frameResponse = await fetch(frameUrls[i]);
            const blob = await frameResponse.blob();
            const file = new File([blob], `${video.name}_frame_${i.toString().padStart(4, '0')}.png`, { type: 'image/png' });
            frameFiles.push(file);
          }

          setFiles((prev) => [...prev, ...frameFiles]);
          toast({ title: 'Frames Extracted', description: `Extracted ${frameFiles.length} frames from ${video.name}` });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to process video';
          toast({ title: 'Error', description: message, variant: 'destructive' });
        }
      }
      setIsProcessingVideo(false);
    }
  }, [toast]);

  // Import from Google Drive folder
  // Uses server-side ZIP creation - no need to download files locally
  const handleGoogleDriveImport = async () => {
    if (!googleDriveUrl.trim()) {
      toast({ title: 'Error', description: 'Please enter a Google Drive folder URL', variant: 'destructive' });
      return;
    }

    setIsImportingDrive(true);
    toast({ title: 'Importing', description: 'Importing files from Google Drive...' });

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/files/import-gdrive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderUrl: googleDriveUrl.trim(),
          maxFramesPerVideo: 50,
          createZip: true,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to import from Google Drive');
      }

      const data = await response.json();
      const imageCount = data.count || 0;
      const zipUrl = data.zipUrl;

      if (!zipUrl) {
        throw new Error('No images found in Google Drive folder');
      }

      // Store the ZIP URL directly - no need to download files locally
      setGoogleDriveZipUrl(zipUrl);
      setGoogleDriveImageCount(imageCount);
      setGoogleDriveUrl('');
      // Clear any local files to avoid confusion
      setFiles([]);
      toast({
        title: 'Import Complete',
        description: `Ready to train with ${imageCount} images from Google Drive`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsImportingDrive(false);
    }
  };

  // Clear Google Drive import
  const clearGoogleDriveImport = () => {
    setGoogleDriveZipUrl(null);
    setGoogleDriveImageCount(0);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.webp'],
      'application/zip': ['.zip'],
      'application/x-zip-compressed': ['.zip'],
      'video/*': ['.mp4', '.mov', '.avi', '.webm'],
    },
    multiple: true,
    disabled: isProcessingZip || isProcessingVideo,
  });

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Memoized preview URLs - only create object URLs for visible images
  const previewUrls = useMemo(() => {
    const urls: string[] = [];
    const limit = Math.min(files.length, PREVIEW_LIMIT);
    for (let i = 0; i < limit; i++) {
      urls.push(URL.createObjectURL(files[i]));
    }
    return urls;
  }, [files, PREVIEW_LIMIT]);

  // Cleanup preview URLs when files change
  useEffect(() => {
    return () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previewUrls]);

  // Gallery navigation
  const openGallery = (index: number) => {
    setGalleryIndex(index);
    setGalleryOpen(true);
  };

  const nextImage = () => {
    setGalleryIndex((prev) => (prev + 1) % files.length);
  };

  const prevImage = () => {
    setGalleryIndex((prev) => (prev - 1 + files.length) % files.length);
  };

  // Get URL for gallery (create on demand for non-preview images)
  const getGalleryUrl = useCallback((index: number) => {
    if (index < previewUrls.length) {
      return previewUrls[index];
    }
    return URL.createObjectURL(files[index]);
  }, [files, previewUrls]);

  const createZipFromFiles = async (files: File[]): Promise<Blob> => {
    // Dynamic import for JSZip (we'll need to add this package)
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      zip.file(file.name, arrayBuffer);
    }

    return zip.generateAsync({ type: 'blob' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast({ title: 'Error', description: 'Name is required', variant: 'destructive' });
      return;
    }

    if (!triggerWord.trim()) {
      toast({ title: 'Error', description: 'Trigger word is required', variant: 'destructive' });
      return;
    }

    // Check for images: either local files OR Google Drive import
    const hasLocalFiles = files.length >= 3;
    const hasGoogleDriveImport = googleDriveZipUrl && googleDriveImageCount >= 3;

    if (!hasLocalFiles && !hasGoogleDriveImport) {
      toast({
        title: 'Error',
        description: 'At least 3 images are required for training',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsCreating(true);
      let imagesZipUrl: string;

      if (googleDriveZipUrl) {
        // Use the pre-created ZIP from Google Drive import directly
        imagesZipUrl = googleDriveZipUrl;
        toast({ title: 'Starting', description: 'Using imported Google Drive images...' });
      } else {
        // Create ZIP file from local images
        setIsUploading(true);
        toast({ title: 'Preparing', description: 'Creating ZIP file from images...' });
        const zipBlob = await createZipFromFiles(files);
        const zipFile = new File([zipBlob], `${name.toLowerCase().replace(/\s+/g, '-')}-images.zip`, {
          type: 'application/zip',
        });

        // Upload ZIP to Supabase
        toast({ title: 'Uploading', description: 'Uploading training images...' });
        const uploadResult = await filesApi.uploadFile(zipFile, 'training-images');
        imagesZipUrl = uploadResult.url;
        setIsUploading(false);
      }

      // Create LoRA training job
      toast({ title: 'Starting', description: 'Starting LoRA training...' });
      await loraApi.create({
        name: name.trim(),
        triggerWord: triggerWord.trim().toLowerCase(),
        imagesZipUrl,
        steps,
        learningRate,
        isStyle,
        includeSyntheticCaptions,
        useFaceDetection: isStyle ? false : useFaceDetection,
        useFaceCropping: isStyle ? false : useFaceCropping,
        useMasks: isStyle ? false : useMasks,
      });

      toast({
        title: 'Success',
        description: 'LoRA training started! This typically takes 5-15 minutes.',
      });

      // Reset form
      setName('');
      setTriggerWord('');
      setSteps(1000);
      setFiles([]);
      setGoogleDriveZipUrl(null);
      setGoogleDriveImageCount(0);
      setIsStyle(false);
      setLearningRate(0.0007);
      setIncludeSyntheticCaptions(false);
      setUseFaceDetection(true);
      setUseFaceCropping(true); // HiRA default - prioritize face resemblance
      setUseMasks(true);
      setAdvancedSettingsOpen(false);

      // Refresh models list
      fetchModels();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create LoRA';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsCreating(false);
      setIsUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    const model = loraModels.find(m => m.id === id);
    if (!model) return;

    // Mark as pending deletion (optimistic UI update)
    setPendingDeletions(prev => new Set(prev).add(id));

    // Show toast with undo button
    const { dismiss } = toast({
      title: 'Model deleted',
      description: `"${model.name}" will be permanently deleted`,
      duration: DELETION_DELAY_MS,
      action: (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            undoDelete(id);
            dismiss();
          }}
        >
          Undo
        </Button>
      ),
    });

    // Set timer for actual deletion
    const timer = setTimeout(async () => {
      try {
        await loraApi.delete(id);
        // Remove from pending and refresh
        setPendingDeletions(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        deletionTimersRef.current.delete(id);
        fetchModels();
      } catch (error) {
        // Deletion failed - restore the item
        setPendingDeletions(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        deletionTimersRef.current.delete(id);
        const message = error instanceof Error ? error.message : 'Failed to delete';
        toast({ title: 'Error', description: message, variant: 'destructive' });
      }
    }, DELETION_DELAY_MS);

    deletionTimersRef.current.set(id, timer);
  };

  const undoDelete = (id: string) => {
    // Cancel the deletion timer
    const timer = deletionTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      deletionTimersRef.current.delete(id);
    }

    // Remove from pending deletions
    setPendingDeletions(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    toast({ title: 'Restored', description: 'Deletion cancelled' });
  };

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      deletionTimersRef.current.forEach(timer => clearTimeout(timer));
    };
  }, []);

  const handleCancel = async (id: string, name: string) => {
    try {
      await loraApi.cancel(id);
      toast({ title: 'Cancelled', description: `Training for "${name}" has been cancelled` });
      fetchModels();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to cancel';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  const handleRetry = async (id: string, name: string) => {
    try {
      await loraApi.retry(id);
      toast({ title: 'Retrying', description: `Restarting training for "${name}"` });
      fetchModels();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to retry';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  const openRenameModal = (model: LoraModel) => {
    setRenameModel(model);
    setRenameName(model.name);
    setRenameTriggerWord(model.trigger_word);
    setRenameThumbnail(null);
    setRenameModalOpen(true);
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!renameModel) return;

    if (!renameName.trim()) {
      toast({ title: 'Error', description: 'Name is required', variant: 'destructive' });
      return;
    }

    if (!renameTriggerWord.trim()) {
      toast({ title: 'Error', description: 'Trigger word is required', variant: 'destructive' });
      return;
    }

    try {
      setIsRenaming(true);

      // Update name and trigger word
      await loraApi.update(renameModel.id, {
        name: renameName.trim(),
        triggerWord: renameTriggerWord.trim().toLowerCase(),
      });

      // Upload thumbnail if provided
      if (renameThumbnail) {
        await loraApi.updateThumbnail(renameModel.id, renameThumbnail);
      }

      toast({ title: 'Updated', description: 'LoRA model updated' });
      setRenameModalOpen(false);
      setRenameModel(null);
      setRenameThumbnail(null);
      fetchModels();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsRenaming(false);
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!uploadFile) {
      toast({ title: 'Error', description: 'Please select a .safetensors file', variant: 'destructive' });
      return;
    }

    if (!uploadName.trim()) {
      toast({ title: 'Error', description: 'Name is required', variant: 'destructive' });
      return;
    }

    if (!uploadTriggerWord.trim()) {
      toast({ title: 'Error', description: 'Trigger word is required', variant: 'destructive' });
      return;
    }

    try {
      setIsUploadingLora(true);
      toast({ title: 'Uploading', description: 'Uploading LoRA file...' });

      await loraApi.upload({
        file: uploadFile,
        name: uploadName.trim(),
        triggerWord: uploadTriggerWord.trim().toLowerCase(),
        thumbnail: uploadThumbnail || undefined,
      });

      toast({ title: 'Success', description: 'LoRA uploaded successfully!' });

      // Reset form and close modal
      setUploadName('');
      setUploadTriggerWord('');
      setUploadFile(null);
      setUploadThumbnail(null);
      setUploadModalOpen(false);

      // Refresh models list
      fetchModels();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload LoRA';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsUploadingLora(false);
    }
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!importUrl.trim()) {
      toast({ title: 'Error', description: 'Please enter a LoRA URL', variant: 'destructive' });
      return;
    }

    if (!importName.trim()) {
      toast({ title: 'Error', description: 'Name is required', variant: 'destructive' });
      return;
    }

    if (!importTriggerWord.trim()) {
      toast({ title: 'Error', description: 'Trigger word is required', variant: 'destructive' });
      return;
    }

    try {
      setIsImporting(true);
      toast({ title: 'Importing', description: 'Importing LoRA from URL...' });

      await loraApi.import({
        name: importName.trim(),
        triggerWord: importTriggerWord.trim().toLowerCase(),
        weightsUrl: importUrl.trim(),
        thumbnailUrl: importThumbnailUrl.trim() || undefined,
      });

      toast({ title: 'Success', description: 'LoRA imported successfully!' });

      // Reset form and close modal
      setImportName('');
      setImportTriggerWord('');
      setImportUrl('');
      setImportThumbnailUrl('');
      setUploadModalOpen(false);

      // Refresh models list
      fetchModels();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import LoRA';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsImporting(false);
    }
  };

  const getStatusBadge = (status: LoraModel['status']) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
      case 'training':
        return <Badge variant="warning"><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Training</Badge>;
      case 'ready':
        return <Badge variant="success"><CheckCircle className="w-3 h-3 mr-1" /> Ready</Badge>;
      case 'failed':
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" /> Failed</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">LoRA Creator</h1>
        <p className="text-muted-foreground">
          Train a custom LoRA model to capture a specific face for AI generation
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Create Form */}
        <Card>
          <CardHeader>
            <CardTitle>Create New LoRA</CardTitle>
            <CardDescription>
              Upload 5-20 high-quality face images for best results
            </CardDescription>
            {/* Image Guidelines Panel */}
            <div className="mt-4 p-3 bg-muted/50 rounded-lg space-y-2">
              <p className="text-sm font-medium">Image Guidelines</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                  <Check className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>High quality JPEG images</span>
                </div>
                <div className="flex items-center gap-1.5 text-destructive">
                  <X className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>No glasses, hats, masks</span>
                </div>
                <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                  <Check className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>Full body and close-up faces</span>
                </div>
                <div className="flex items-center gap-1.5 text-destructive">
                  <X className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>No phones in hand</span>
                </div>
                <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                  <Check className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>Even lighting</span>
                </div>
                <div className="flex items-center gap-1.5 text-destructive">
                  <X className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>No other people</span>
                </div>
                <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                  <Check className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>Varied angles and poses</span>
                </div>
                <div className="flex items-center gap-1.5 text-destructive">
                  <X className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>No blurry photos</span>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Model Name</Label>
                <Input
                  id="name"
                  placeholder="e.g., Jane Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isCreating}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="triggerWord">Trigger Word</Label>
                <Input
                  id="triggerWord"
                  placeholder="e.g., janedoe"
                  value={triggerWord}
                  onChange={(e) => setTriggerWord(e.target.value.toLowerCase())}
                  disabled={isCreating}
                />
                <p className="text-xs text-muted-foreground">
                  Use this word in prompts to activate the LoRA
                </p>
              </div>

              {/* Is Style Toggle */}
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="isStyle" className="font-medium">Style Training</Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-[250px]">
                          <p>Enable for training artistic styles instead of faces. Face-related options will be disabled.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Train on artistic style instead of faces
                  </p>
                </div>
                <Switch
                  id="isStyle"
                  checked={isStyle}
                  onCheckedChange={setIsStyle}
                  disabled={isCreating}
                />
              </div>

              {/* Training Steps */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="steps">Training Steps</Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-[250px]">
                          <p>Number of training iterations. More steps generally mean better quality but longer training time. 1000 steps is recommended for most subjects.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <Input
                    id="steps"
                    type="number"
                    min={10}
                    max={6000}
                    value={steps}
                    onChange={(e) => setSteps(Math.min(6000, Math.max(10, parseInt(e.target.value) || 1000)))}
                    disabled={isCreating}
                    className="w-24 text-right"
                  />
                </div>
                <Slider
                  value={[steps]}
                  onValueChange={([value]) => setSteps(value)}
                  min={10}
                  max={6000}
                  step={10}
                  disabled={isCreating}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>10 (Quick)</span>
                  <span>1000 (Recommended)</span>
                  <span>6000 (Max)</span>
                </div>
              </div>

              {/* Advanced Settings Collapsible */}
              <Collapsible
                open={advancedSettingsOpen}
                onOpenChange={setAdvancedSettingsOpen}
                className="border rounded-lg"
              >
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full flex items-center justify-between px-3 py-2 h-auto"
                    disabled={isCreating}
                  >
                    <div className="flex items-center gap-2">
                      <Settings className="w-4 h-4" />
                      <span className="font-medium">Advanced Settings</span>
                    </div>
                    {advancedSettingsOpen ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="px-3 pb-3 space-y-4">
                  {/* Learning Rate */}
                  <div className="space-y-3 pt-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="learningRate">Learning Rate</Label>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-[250px]">
                              <p>Controls how quickly the model learns. Higher values learn faster but may overfit. Default 0.0007 works well for most cases.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <Input
                        id="learningRate"
                        type="number"
                        min={0.00001}
                        max={0.01}
                        step={0.00001}
                        value={learningRate}
                        onChange={(e) => setLearningRate(Math.min(0.01, Math.max(0.00001, parseFloat(e.target.value) || 0.0007)))}
                        disabled={isCreating}
                        className="w-28 text-right"
                      />
                    </div>
                    <Slider
                      value={[learningRate * 10000]}
                      onValueChange={([value]) => setLearningRate(value / 10000)}
                      min={0.1}
                      max={100}
                      step={0.1}
                      disabled={isCreating}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>0.00001</span>
                      <span>0.0007 (Default)</span>
                      <span>0.01</span>
                    </div>
                  </div>

                  {/* Face Options - Only show when not style training */}
                  {!isStyle && (
                    <>
                      <div className="h-px bg-border" />
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Face Detection Options</p>

                      {/* Use Face Detection */}
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <Label htmlFor="useFaceDetection" className="text-sm">Face Detection</Label>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent side="right" className="max-w-[250px]">
                                  <p>Automatically detect and focus on faces in training images for better results.</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        </div>
                        <Switch
                          id="useFaceDetection"
                          checked={useFaceDetection}
                          onCheckedChange={setUseFaceDetection}
                          disabled={isCreating}
                        />
                      </div>

                      {/* Use Face Cropping */}
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <Label htmlFor="useFaceCropping" className="text-sm">Face Cropping</Label>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent side="right" className="max-w-[250px]">
                                  <p>Crop training images to focus on detected faces. Useful when faces are small in images.</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        </div>
                        <Switch
                          id="useFaceCropping"
                          checked={useFaceCropping}
                          onCheckedChange={setUseFaceCropping}
                          disabled={isCreating}
                        />
                      </div>

                      {/* Use Masks */}
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <Label htmlFor="useMasks" className="text-sm">Use Masks</Label>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent side="right" className="max-w-[250px]">
                                  <p>Use segmentation masks during training to help the model focus on the subject.</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        </div>
                        <Switch
                          id="useMasks"
                          checked={useMasks}
                          onCheckedChange={setUseMasks}
                          disabled={isCreating}
                        />
                      </div>
                    </>
                  )}

                  <div className="h-px bg-border" />

                  {/* Synthetic Captions */}
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="includeSyntheticCaptions" className="text-sm">Synthetic Captions</Label>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-[250px]">
                              <p>Generate AI captions for training images. Can improve training results by providing context.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </div>
                    <Switch
                      id="includeSyntheticCaptions"
                      checked={includeSyntheticCaptions}
                      onCheckedChange={setIncludeSyntheticCaptions}
                      disabled={isCreating}
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {/* Cost Estimation */}
              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Estimated cost</span>
                  <span className="font-medium">
                    ~${((steps / 1000) * 2).toFixed(2)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Based on {steps.toLocaleString()} training steps
                </p>
              </div>

              <div className="space-y-2">
                <Label>
                  Training Images ({googleDriveZipUrl ? googleDriveImageCount : files.length})
                  {googleDriveZipUrl && (
                    <Badge variant="secondary" className="ml-2 text-xs">Google Drive</Badge>
                  )}
                </Label>

                {/* Google Drive Import Success State */}
                {googleDriveZipUrl ? (
                  <div className="border-2 border-primary/50 bg-primary/5 rounded-lg p-6 text-center">
                    <CheckCircle className="w-8 h-8 mx-auto mb-2 text-primary" />
                    <p className="font-medium">{googleDriveImageCount} images from Google Drive</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Ready to start training
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-3"
                      onClick={clearGoogleDriveImport}
                      disabled={isCreating}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Clear and upload different images
                    </Button>
                  </div>
                ) : (
                  <>
                    <div
                      {...getRootProps()}
                      className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                        isDragActive
                          ? 'border-primary bg-primary/5'
                          : 'border-muted-foreground/25 hover:border-primary/50'
                      } ${isCreating || isProcessingZip || isProcessingVideo ? 'pointer-events-none opacity-50' : ''}`}
                    >
                      <input {...getInputProps()} />
                      {isProcessingZip ? (
                        <>
                          <Loader2 className="w-8 h-8 mx-auto mb-2 text-muted-foreground animate-spin" />
                          <p className="text-muted-foreground">Extracting images from ZIP...</p>
                        </>
                      ) : isProcessingVideo ? (
                        <>
                          <Loader2 className="w-8 h-8 mx-auto mb-2 text-muted-foreground animate-spin" />
                          <p className="text-muted-foreground">Extracting frames from video...</p>
                        </>
                      ) : (
                        <>
                          <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                          {isDragActive ? (
                            <p>Drop the files here...</p>
                          ) : (
                            <p className="text-muted-foreground">
                              Drag & drop images, videos, or ZIP files
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            Images (PNG, JPG, WebP), Videos (MP4, MOV), or ZIP
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Videos will be frame-extracted automatically
                          </p>
                        </>
                      )}
                    </div>

                    {/* Google Drive Import */}
                    <div className="flex gap-2 mt-3">
                      <Input
                        placeholder="Google Drive folder URL..."
                        value={googleDriveUrl}
                        onChange={(e) => setGoogleDriveUrl(e.target.value)}
                        disabled={isCreating || isImportingDrive}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleGoogleDriveImport}
                        disabled={isCreating || isImportingDrive || !googleDriveUrl.trim()}
                      >
                        {isImportingDrive ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          'Import'
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Paste a Google Drive folder link (folder must be publicly shared)
                    </p>
                  </>
                )}
              </div>

              {files.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Selected Images ({files.length})</Label>
                    {files.length > PREVIEW_LIMIT && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => openGallery(0)}
                        className="text-xs"
                      >
                        <Grid3X3 className="w-3 h-3 mr-1" />
                        View All
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {previewUrls.map((url, index) => (
                      <div key={index} className="relative group">
                        <button
                          type="button"
                          onClick={() => openGallery(index)}
                          className="w-full focus:outline-none focus:ring-2 focus:ring-primary rounded"
                        >
                          <img
                            src={url}
                            alt={files[index]?.name || `Image ${index + 1}`}
                            className="w-full h-20 object-cover rounded"
                          />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFile(index);
                          }}
                          className="absolute top-1 right-1 p-1 bg-destructive text-destructive-foreground rounded opacity-0 group-hover:opacity-100 transition-opacity"
                          disabled={isCreating}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    {/* Show "+X more" indicator */}
                    {files.length > PREVIEW_LIMIT && (
                      <button
                        type="button"
                        onClick={() => openGallery(PREVIEW_LIMIT)}
                        className="w-full h-20 bg-muted rounded flex flex-col items-center justify-center text-muted-foreground hover:bg-muted/80 transition-colors"
                      >
                        <Images className="w-5 h-5 mb-1" />
                        <span className="text-xs font-medium">+{files.length - PREVIEW_LIMIT} more</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* HiRA Enable Toggle - Only show for non-style training */}
              {!isStyle && files.length >= 3 && (
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="enableFaceIdentity" className="font-medium">HiRA Face Identity</Label>
                      <Badge variant="secondary" className="text-xs">New</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Detect faces to verify identity and check for multiple people
                    </p>
                  </div>
                  <Switch
                    id="enableFaceIdentity"
                    checked={enableFaceIdentity}
                    onCheckedChange={setEnableFaceIdentity}
                    disabled={isCreating}
                  />
                </div>
              )}

              {/* HiRA Face Identity - Show in detect mode (no loraId required) */}
              {!isStyle && files.length >= 3 && enableFaceIdentity && (
                <div className="border rounded-lg p-4">
                  <FaceSelector
                    imageUrls={files.map((file) => URL.createObjectURL(file))}
                    mode="detect"
                    onFaceProcessed={(result) => {
                      setFaceProcessingResult(result);
                    }}
                    onPrimarySelected={(identityId, clusterIndex) => {
                      setSelectedFaceIdentityId(identityId || `cluster-${clusterIndex}`);
                    }}
                    disabled={isCreating}
                  />
                </div>
              )}

              <Button type="submit" className="w-full" disabled={isCreating}>
                {isCreating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {isUploading ? 'Uploading...' : 'Starting Training...'}
                  </>
                ) : (
                  `Start Training (~$${((steps / 1000) * 2).toFixed(2)})`
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Models List */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Your LoRA Models</CardTitle>
                <CardDescription>
                  Trained and uploaded models ready for use
                </CardDescription>
              </div>
              <Dialog open={uploadModalOpen} onOpenChange={setUploadModalOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <FileUp className="w-4 h-4 mr-2" />
                    Upload LoRA
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Add LoRA</DialogTitle>
                    <DialogDescription>
                      Upload a file or import from URL
                    </DialogDescription>
                  </DialogHeader>
                  <Tabs value={uploadTab} onValueChange={(v) => setUploadTab(v as 'file' | 'url')}>
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="file">Upload File</TabsTrigger>
                      <TabsTrigger value="url">Import URL</TabsTrigger>
                    </TabsList>
                    <TabsContent value="file">
                      <form onSubmit={handleUploadSubmit} className="space-y-4 mt-4">
                        <div className="space-y-2">
                          <Label htmlFor="uploadFile">.safetensors File</Label>
                          <Input
                            id="uploadFile"
                            type="file"
                            accept=".safetensors"
                            onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                            disabled={isUploadingLora}
                          />
                          {uploadFile && (
                            <p className="text-xs text-muted-foreground">
                              Selected: {uploadFile.name} ({(uploadFile.size / 1024 / 1024).toFixed(1)} MB)
                            </p>
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="uploadName">Name</Label>
                          <Input
                            id="uploadName"
                            placeholder="e.g., Jane Doe"
                            value={uploadName}
                            onChange={(e) => setUploadName(e.target.value)}
                            disabled={isUploadingLora}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="uploadTriggerWord">Trigger Word</Label>
                          <Input
                            id="uploadTriggerWord"
                            placeholder="e.g., janedoe"
                            value={uploadTriggerWord}
                            onChange={(e) => setUploadTriggerWord(e.target.value.toLowerCase())}
                            disabled={isUploadingLora}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="uploadThumbnail">Thumbnail (optional)</Label>
                          <Input
                            id="uploadThumbnail"
                            type="file"
                            accept="image/*"
                            onChange={(e) => setUploadThumbnail(e.target.files?.[0] || null)}
                            disabled={isUploadingLora}
                          />
                        </div>

                        <Button type="submit" className="w-full" disabled={isUploadingLora}>
                          {isUploadingLora ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Uploading...
                            </>
                          ) : (
                            'Upload LoRA'
                          )}
                        </Button>
                      </form>
                    </TabsContent>
                    <TabsContent value="url">
                      <form onSubmit={handleImportSubmit} className="space-y-4 mt-4">
                        <div className="space-y-2">
                          <Label htmlFor="importUrl">LoRA URL</Label>
                          <Input
                            id="importUrl"
                            type="url"
                            placeholder="https://..."
                            value={importUrl}
                            onChange={(e) => setImportUrl(e.target.value)}
                            disabled={isImporting}
                          />
                          <p className="text-xs text-muted-foreground">
                            URL to .safetensors file (fal.ai, Civitai, HuggingFace)
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="importName">Name</Label>
                          <Input
                            id="importName"
                            placeholder="e.g., Jane Doe"
                            value={importName}
                            onChange={(e) => setImportName(e.target.value)}
                            disabled={isImporting}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="importTriggerWord">Trigger Word</Label>
                          <Input
                            id="importTriggerWord"
                            placeholder="e.g., janedoe"
                            value={importTriggerWord}
                            onChange={(e) => setImportTriggerWord(e.target.value.toLowerCase())}
                            disabled={isImporting}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="importThumbnailUrl">Thumbnail URL (optional)</Label>
                          <Input
                            id="importThumbnailUrl"
                            type="url"
                            placeholder="https://..."
                            value={importThumbnailUrl}
                            onChange={(e) => setImportThumbnailUrl(e.target.value)}
                            disabled={isImporting}
                          />
                        </div>

                        <Button type="submit" className="w-full" disabled={isImporting}>
                          {isImporting ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Importing...
                            </>
                          ) : (
                            'Import LoRA'
                          )}
                        </Button>
                      </form>
                    </TabsContent>
                  </Tabs>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            {isLoadingModels ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : loraModels.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>No LoRA models yet</p>
                <p className="text-sm">Create your first model to get started</p>
              </div>
            ) : (
              <div className="space-y-3">
                {loraModels.map((model) => {
                  const isPendingDeletion = pendingDeletions.has(model.id);
                  return (
                  <div
                    key={model.id}
                    className={`border rounded-lg transition-all duration-300 ${
                      isPendingDeletion ? 'opacity-50 bg-destructive/5 border-destructive/20' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3 p-3">
                      {/* Thumbnail */}
                      <div className="w-12 h-12 flex-shrink-0 bg-muted rounded overflow-hidden">
                        {model.thumbnail_url ? (
                          <img
                            src={model.thumbnail_url}
                            alt={model.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                            <Upload className="w-5 h-5" />
                          </div>
                        )}
                      </div>
                      {/* Info */}
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{model.name}</span>
                          {getStatusBadge(model.status)}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Trigger: <code className="bg-muted px-1 rounded">{model.trigger_word}</code>
                        </div>
                        {model.status === 'training' && (
                          <div className="space-y-1">
                            <Progress value={model.progress ?? 0} className="h-1 w-32" />
                          </div>
                        )}
                        {model.status === 'failed' && model.error_message && (
                          <p className="text-xs text-destructive">{model.error_message}</p>
                        )}
                        {model.cost_cents !== null && model.cost_cents > 0 && (
                          <p className="text-xs text-muted-foreground">
                            Cost: ${(model.cost_cents / 100).toFixed(2)}
                          </p>
                        )}
                      </div>
                      {/* Actions */}
                      <div className="flex gap-1">
                        {isPendingDeletion ? (
                          /* Undo button when pending deletion */
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => undoDelete(model.id)}
                            className="text-xs"
                          >
                            <RotateCcw className="w-3 h-3 mr-1" />
                            Undo
                          </Button>
                        ) : (
                          <>
                            {/* Cancel button for training/pending */}
                            {(model.status === 'training' || model.status === 'pending') && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleCancel(model.id, model.name)}
                                title="Cancel training"
                                className="text-destructive hover:text-destructive"
                              >
                                <StopCircle className="w-4 h-4" />
                              </Button>
                            )}
                            {/* Retry button for failed */}
                            {model.status === 'failed' && model.training_images_url && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRetry(model.id, model.name)}
                                title="Retry training"
                                className="text-blue-600 hover:text-blue-700"
                              >
                                <RotateCcw className="w-4 h-4" />
                              </Button>
                            )}
                            {/* Edit button for ready */}
                            {model.status === 'ready' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openRenameModal(model)}
                                title="Edit"
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                            )}
                            {/* Delete button for ready/failed */}
                            {(model.status === 'ready' || model.status === 'failed') && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDelete(model.id)}
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    {/* Inline Training Log for active models */}
                    {(model.status === 'training' || model.status === 'pending') && (
                      <div className="px-3 pb-3">
                        <div className="pt-3 border-t">
                          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                            <Terminal className="w-3 h-3" />
                            Training Log
                          </div>
                          <div className="bg-muted/50 rounded p-2 max-h-32 overflow-y-auto font-mono text-xs space-y-1">
                            {trainingLog
                              .filter(entry => entry.id === model.id)
                              .slice(-10)
                              .map((entry, idx) => (
                                <div
                                  key={`${entry.id}-${idx}`}
                                  className={`flex items-start gap-2 ${
                                    entry.status === 'failed' ? 'text-destructive' :
                                    entry.status === 'ready' ? 'text-green-600 dark:text-green-400' :
                                    'text-muted-foreground'
                                  }`}
                                >
                                  <span className="shrink-0">
                                    [{new Date(entry.timestamp).toLocaleTimeString()}]
                                  </span>
                                  <span className="flex-1">
                                    {entry.status === 'training' && (
                                      <span className="text-blue-600 dark:text-blue-400">
                                        [{entry.progress}%] {entry.statusMessage}
                                      </span>
                                    )}
                                    {entry.status === 'pending' && (
                                      <span className="text-yellow-600 dark:text-yellow-400">
                                        {entry.statusMessage}
                                      </span>
                                    )}
                                  </span>
                                </div>
                              ))
                            }
                            {trainingLog.filter(entry => entry.id === model.id).length === 0 && model.status_message && (
                              <div className="text-muted-foreground">
                                {model.status === 'training' && `[${model.progress ?? 0}%] `}
                                {model.status_message}
                              </div>
                            )}
                          </div>
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
      </div>

      {/* Edit Modal */}
      <Dialog open={renameModalOpen} onOpenChange={setRenameModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit LoRA Model</DialogTitle>
            <DialogDescription>
              Update the name, trigger word, or thumbnail for this model
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRenameSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="renameName">Name</Label>
              <Input
                id="renameName"
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                disabled={isRenaming}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="renameTriggerWord">Trigger Word</Label>
              <Input
                id="renameTriggerWord"
                value={renameTriggerWord}
                onChange={(e) => setRenameTriggerWord(e.target.value.toLowerCase())}
                disabled={isRenaming}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="renameThumbnail">Thumbnail</Label>
              {renameModel?.thumbnail_url && !renameThumbnail && (
                <div className="mb-2">
                  <img
                    src={renameModel.thumbnail_url}
                    alt="Current thumbnail"
                    className="w-16 h-16 object-cover rounded"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Current thumbnail</p>
                </div>
              )}
              {renameThumbnail && (
                <div className="mb-2">
                  <img
                    src={URL.createObjectURL(renameThumbnail)}
                    alt="New thumbnail"
                    className="w-16 h-16 object-cover rounded"
                  />
                  <p className="text-xs text-muted-foreground mt-1">New thumbnail</p>
                </div>
              )}
              <Input
                id="renameThumbnail"
                type="file"
                accept="image/*"
                onChange={(e) => setRenameThumbnail(e.target.files?.[0] || null)}
                disabled={isRenaming}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameModalOpen(false)}
                disabled={isRenaming}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isRenaming}>
                {isRenaming ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Image Gallery Modal */}
      <Dialog open={galleryOpen} onOpenChange={setGalleryOpen}>
        <DialogContent className="max-w-4xl h-[80vh] p-0 gap-0">
          <DialogHeader className="p-4 pb-2">
            <DialogTitle className="flex items-center justify-between">
              <span>Training Images</span>
              <span className="text-sm font-normal text-muted-foreground">
                {galleryIndex + 1} of {files.length}
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 flex items-center justify-center bg-muted/30 relative overflow-hidden">
            {files.length > 0 && (
              <>
                <img
                  src={getGalleryUrl(galleryIndex)}
                  alt={files[galleryIndex]?.name || `Image ${galleryIndex + 1}`}
                  className="max-w-full max-h-full object-contain"
                />
                {/* Navigation buttons */}
                <Button
                  variant="secondary"
                  size="icon"
                  className="absolute left-4 top-1/2 -translate-y-1/2"
                  onClick={prevImage}
                >
                  <ChevronLeft className="w-5 h-5" />
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  className="absolute right-4 top-1/2 -translate-y-1/2"
                  onClick={nextImage}
                >
                  <ChevronRight className="w-5 h-5" />
                </Button>
              </>
            )}
          </div>
          <div className="p-4 pt-2 border-t">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground truncate max-w-[300px]">
                {files[galleryIndex]?.name || `Image ${galleryIndex + 1}`}
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  removeFile(galleryIndex);
                  if (galleryIndex >= files.length - 1 && galleryIndex > 0) {
                    setGalleryIndex(galleryIndex - 1);
                  }
                  if (files.length <= 1) {
                    setGalleryOpen(false);
                  }
                }}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Remove
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
