'use client';

import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Trash2, Loader2, CheckCircle, XCircle, Clock, FileUp, Check, X, Pencil } from 'lucide-react';
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
import { loraApi, filesApi, type LoraModel } from '@/lib/api';

export default function LoraCreatorPage() {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [triggerWord, setTriggerWord] = useState('');
  const [steps, setSteps] = useState(1000);
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [loraModels, setLoraModels] = useState<LoraModel[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(true);

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

  // Fetch existing LoRA models
  const fetchModels = useCallback(async () => {
    try {
      const models = await loraApi.list();
      setLoraModels(models);
    } catch (error) {
      console.error('Failed to fetch LoRA models:', error);
    } finally {
      setIsLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    fetchModels();
    // Poll for updates every 10 seconds for training models
    const interval = setInterval(fetchModels, 10000);
    return () => clearInterval(interval);
  }, [fetchModels]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    // Filter for image files only
    const imageFiles = acceptedFiles.filter((file) =>
      file.type.startsWith('image/')
    );
    setFiles((prev) => [...prev, ...imageFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.webp'],
    },
    multiple: true,
  });

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

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

    if (files.length < 3) {
      toast({
        title: 'Error',
        description: 'At least 3 images are required for training',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsCreating(true);
      setIsUploading(true);

      // Create ZIP file from images
      toast({ title: 'Preparing', description: 'Creating ZIP file from images...' });
      const zipBlob = await createZipFromFiles(files);
      const zipFile = new File([zipBlob], `${name.toLowerCase().replace(/\s+/g, '-')}-images.zip`, {
        type: 'application/zip',
      });

      // Upload ZIP to Supabase
      toast({ title: 'Uploading', description: 'Uploading training images...' });
      const uploadResult = await filesApi.uploadFile(zipFile, 'training-images');
      setIsUploading(false);

      // Create LoRA training job
      toast({ title: 'Starting', description: 'Starting LoRA training...' });
      await loraApi.create({
        name: name.trim(),
        triggerWord: triggerWord.trim().toLowerCase(),
        imagesZipUrl: uploadResult.url,
        steps,
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
    try {
      await loraApi.delete(id);
      toast({ title: 'Deleted', description: 'LoRA model deleted' });
      fetchModels();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete';
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

              <div className="space-y-2">
                <Label htmlFor="steps">Training Steps</Label>
                <Input
                  id="steps"
                  type="number"
                  min={100}
                  max={10000}
                  value={steps}
                  onChange={(e) => setSteps(parseInt(e.target.value) || 1000)}
                  disabled={isCreating}
                />
                <p className="text-xs text-muted-foreground">
                  More steps = better quality, longer training (recommended: 1000)
                </p>
              </div>

              <div className="space-y-2">
                <Label>Training Images ({files.length})</Label>
                <div
                  {...getRootProps()}
                  className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                    isDragActive
                      ? 'border-primary bg-primary/5'
                      : 'border-muted-foreground/25 hover:border-primary/50'
                  } ${isCreating ? 'pointer-events-none opacity-50' : ''}`}
                >
                  <input {...getInputProps()} />
                  <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                  {isDragActive ? (
                    <p>Drop the images here...</p>
                  ) : (
                    <p className="text-muted-foreground">
                      Drag & drop images, or click to select
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    PNG, JPG, JPEG, WebP (5-20 images recommended)
                  </p>
                </div>
              </div>

              {files.length > 0 && (
                <div className="space-y-2">
                  <Label>Selected Images</Label>
                  <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                    {files.map((file, index) => (
                      <div key={index} className="relative group">
                        <img
                          src={URL.createObjectURL(file)}
                          alt={file.name}
                          className="w-full h-20 object-cover rounded"
                        />
                        <button
                          type="button"
                          onClick={() => removeFile(index)}
                          className="absolute top-1 right-1 p-1 bg-destructive text-destructive-foreground rounded opacity-0 group-hover:opacity-100 transition-opacity"
                          disabled={isCreating}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={isCreating}>
                {isCreating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {isUploading ? 'Uploading...' : 'Starting Training...'}
                  </>
                ) : (
                  'Start Training (~$2.00)'
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
                {loraModels.map((model) => (
                  <div
                    key={model.id}
                    className="flex items-center gap-3 p-3 border rounded-lg"
                  >
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
                        <Progress value={50} className="h-1 w-32" />
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
                    </div>
                  </div>
                ))}
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
    </div>
  );
}
