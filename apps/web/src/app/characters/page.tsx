'use client';

import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Trash2, Loader2, CheckCircle, XCircle, Clock, Download, ArrowRight, Plus, Pencil, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useToast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { characterApi, filesApi, loraApi, type CharacterDiagram, type LoraModel } from '@/lib/api';

type IdentitySource = 'photo' | 'lora';

export default function CharacterDiagramPage() {
  const { toast } = useToast();

  // Form state
  const [identitySource, setIdentitySource] = useState<IdentitySource>('photo');
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedLora, setSelectedLora] = useState<LoraModel | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // Data state
  const [loras, setLoras] = useState<LoraModel[]>([]);
  const [isLoadingLoras, setIsLoadingLoras] = useState(true);
  const [diagrams, setDiagrams] = useState<CharacterDiagram[]>([]);
  const [isLoadingDiagrams, setIsLoadingDiagrams] = useState(true);

  // Upload modal state
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [isUploadingManual, setIsUploadingManual] = useState(false);

  // Rename modal state
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameDiagram, setRenameDiagram] = useState<CharacterDiagram | null>(null);
  const [renameName, setRenameName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

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
      const data = await characterApi.list();
      setDiagrams(data);
    } catch (error) {
      console.error('Failed to fetch character diagrams:', error);
    } finally {
      setIsLoadingDiagrams(false);
    }
  }, []);

  useEffect(() => {
    fetchLoras();
    fetchDiagrams();
    const interval = setInterval(fetchDiagrams, 5000);
    return () => clearInterval(interval);
  }, [fetchLoras, fetchDiagrams]);

  // Photo dropzone
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const imageFile = acceptedFiles[0];
    if (imageFile && imageFile.type.startsWith('image/')) {
      setFile(imageFile);
      setPreview(URL.createObjectURL(imageFile));
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp'] },
    multiple: false,
  });

  const clearFile = () => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview(null);
  };

  // Submit handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (identitySource === 'photo') {
      if (!file) {
        toast({ title: 'Error', description: 'Please upload an image', variant: 'destructive' });
        return;
      }

      try {
        setIsGenerating(true);
        setIsUploading(true);

        toast({ title: 'Uploading', description: 'Uploading source image...' });
        const uploadResult = await filesApi.uploadFile(file, 'character-images');
        setIsUploading(false);

        toast({ title: 'Starting', description: 'Starting character diagram generation...' });
        await characterApi.create({
          name: name.trim() || undefined,
          sourceImageUrl: uploadResult.url,
        });

        toast({
          title: 'Success',
          description: 'Character diagram generation started! This typically takes 30-60 seconds.',
        });

        setName('');
        clearFile();
        fetchDiagrams();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create character diagram';
        toast({ title: 'Error', description: message, variant: 'destructive' });
      } finally {
        setIsGenerating(false);
        setIsUploading(false);
      }
    } else {
      if (!selectedLora) {
        toast({ title: 'Error', description: 'Please select a LoRA model', variant: 'destructive' });
        return;
      }

      try {
        setIsGenerating(true);

        toast({ title: 'Starting', description: 'Generating reference image and character diagram...' });
        await characterApi.createFromLora({
          name: name.trim() || undefined,
          loraId: selectedLora.id,
        });

        toast({
          title: 'Success',
          description: 'Character diagram generation started! This typically takes 1-2 minutes.',
        });

        setName('');
        setSelectedLora(null);
        fetchDiagrams();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create character diagram';
        toast({ title: 'Error', description: message, variant: 'destructive' });
      } finally {
        setIsGenerating(false);
      }
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await characterApi.delete(id);
      toast({ title: 'Deleted', description: 'Character diagram deleted' });
      fetchDiagrams();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  // Rename handlers
  const openRenameModal = (diagram: CharacterDiagram) => {
    setRenameDiagram(diagram);
    setRenameName(diagram.name);
    setRenameModalOpen(true);
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameDiagram || !renameName.trim()) return;

    try {
      setIsRenaming(true);
      await characterApi.update(renameDiagram.id, { name: renameName.trim() });
      toast({ title: 'Updated', description: 'Character diagram renamed' });
      setRenameModalOpen(false);
      setRenameDiagram(null);
      fetchDiagrams();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rename';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsRenaming(false);
    }
  };

  // Upload modal handlers
  const onUploadDrop = useCallback((acceptedFiles: File[]) => {
    const imageFile = acceptedFiles[0];
    if (imageFile && imageFile.type.startsWith('image/')) {
      setUploadFile(imageFile);
      setUploadPreview(URL.createObjectURL(imageFile));
    }
  }, []);

  const {
    getRootProps: getUploadRootProps,
    getInputProps: getUploadInputProps,
    isDragActive: isUploadDragActive,
  } = useDropzone({
    onDrop: onUploadDrop,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp'] },
    multiple: false,
  });

  const clearUploadFile = () => {
    if (uploadPreview) URL.revokeObjectURL(uploadPreview);
    setUploadFile(null);
    setUploadPreview(null);
  };

  const resetUploadModal = () => {
    clearUploadFile();
    setUploadName('');
    setUploadModalOpen(false);
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile || !uploadName.trim()) return;

    try {
      setIsUploadingManual(true);
      await characterApi.upload({ file: uploadFile, name: uploadName.trim() });
      toast({ title: 'Success', description: 'Character diagram uploaded successfully' });
      resetUploadModal();
      fetchDiagrams();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsUploadingManual(false);
    }
  };

  const handleDownload = (url: string, diagramName: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = `${diagramName.replace(/\s+/g, '-').toLowerCase()}-diagram.jpg`;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getStatusBadge = (status: CharacterDiagram['status']) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
      case 'processing':
        return <Badge variant="warning"><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Processing</Badge>;
      case 'ready':
        return <Badge variant="success"><CheckCircle className="w-3 h-3 mr-1" /> Ready</Badge>;
      case 'failed':
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" /> Failed</Badge>;
    }
  };

  const getSourceBadge = (diagram: CharacterDiagram) => {
    if (diagram.source_lora_id) {
      return <Badge variant="secondary" className="text-xs"><Sparkles className="w-3 h-3 mr-1" />LoRA</Badge>;
    }
    if (diagram.source_image_url) {
      return <Badge variant="outline" className="text-xs">Photo</Badge>;
    }
    return <Badge variant="outline" className="text-xs">Uploaded</Badge>;
  };

  const canSubmit = identitySource === 'photo' ? !!file : !!selectedLora;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Character Diagram Generator</h1>
        <p className="text-muted-foreground">
          Create reference sheets for face swapping
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Create Form */}
        <Card>
          <CardHeader>
            <CardTitle>Generate New Diagram</CardTitle>
            <CardDescription>
              Create a character reference sheet with full-body and face close-up views
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Identity Source Toggle */}
              <div className="space-y-3">
                <Label>Identity Source</Label>
                <RadioGroup
                  value={identitySource}
                  onValueChange={(v) => setIdentitySource(v as IdentitySource)}
                  className="flex gap-4"
                  disabled={isGenerating}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="photo" id="photo" />
                    <Label htmlFor="photo" className="cursor-pointer">Upload Photo</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="lora" id="lora" />
                    <Label htmlFor="lora" className="cursor-pointer flex items-center gap-1">
                      <Sparkles className="w-4 h-4" />
                      Use Trained LoRA
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Photo Upload */}
              {identitySource === 'photo' && (
                <div className="space-y-2">
                  <Label>Source Image</Label>
                  {!file ? (
                    <div
                      {...getRootProps()}
                      className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                        isDragActive
                          ? 'border-primary bg-primary/5'
                          : 'border-muted-foreground/25 hover:border-primary/50'
                      } ${isGenerating ? 'pointer-events-none opacity-50' : ''}`}
                    >
                      <input {...getInputProps()} />
                      <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                      {isDragActive ? (
                        <p>Drop the image here...</p>
                      ) : (
                        <p className="text-muted-foreground">
                          Drag & drop an image, or click to select
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-2">
                        PNG, JPG, JPEG, or WebP
                      </p>
                    </div>
                  ) : (
                    <div className="relative">
                      <img
                        src={preview!}
                        alt="Preview"
                        className="w-full max-h-64 object-contain rounded-lg border"
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute top-2 right-2"
                        onClick={clearFile}
                        disabled={isGenerating}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* LoRA Selection */}
              {identitySource === 'lora' && (
                <div className="space-y-2">
                  <Label>Select LoRA</Label>
                  {isLoadingLoras ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  ) : loras.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground border-2 border-dashed rounded-lg">
                      <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p>No LoRA models found</p>
                      <p className="text-sm">Train or upload a LoRA model first</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 gap-2">
                      {loras.map((lora) => (
                        <button
                          key={lora.id}
                          type="button"
                          onClick={() => setSelectedLora(lora)}
                          disabled={isGenerating}
                          className={`relative aspect-square rounded-md overflow-hidden border-2 transition-all ${
                            selectedLora?.id === lora.id
                              ? 'border-primary ring-2 ring-primary/50'
                              : 'border-transparent hover:border-muted-foreground/50'
                          } ${isGenerating ? 'opacity-50' : ''}`}
                        >
                          {lora.thumbnail_url ? (
                            <img
                              src={lora.thumbnail_url}
                              alt={lora.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full bg-muted flex items-center justify-center">
                              <Sparkles className="w-4 h-4 text-muted-foreground" />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedLora && (
                    <p className="text-sm text-muted-foreground">
                      Selected: <span className="font-medium">{selectedLora.name}</span>
                    </p>
                  )}
                </div>
              )}

              {/* Name field */}
              <div className="space-y-2">
                <Label htmlFor="name">Name (optional)</Label>
                <Input
                  id="name"
                  placeholder="e.g., Model Name - Blue Dress"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isGenerating}
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank to auto-generate a name
                </p>
              </div>

              {/* Cost estimate */}
              <div className="p-3 bg-muted rounded-lg text-sm text-muted-foreground">
                Estimated cost: ~${identitySource === 'lora' ? '0.05' : '0.02'} per diagram
              </div>

              <Button type="submit" className="w-full" disabled={isGenerating || !canSubmit}>
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {isUploading ? 'Uploading...' : 'Generating...'}
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Generate Character Diagram
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Diagrams List */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Your Character Diagrams</CardTitle>
                <CardDescription>
                  Reference sheets ready for face swap
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setUploadModalOpen(true)}
              >
                <Plus className="w-4 h-4 mr-1" />
                Upload
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoadingDiagrams ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : diagrams.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>No character diagrams yet</p>
                <p className="text-sm">Generate your first diagram to get started</p>
              </div>
            ) : (
              <div className="space-y-3">
                {diagrams.map((diagram) => (
                  <div key={diagram.id} className="border rounded-lg overflow-hidden">
                    {diagram.status === 'ready' && diagram.file_url && (
                      <img
                        src={diagram.file_url}
                        alt={diagram.name}
                        className="w-full h-32 object-cover"
                      />
                    )}
                    <div className="p-3">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{diagram.name}</span>
                            {getStatusBadge(diagram.status)}
                          </div>
                          <div className="flex items-center gap-2">
                            {getSourceBadge(diagram)}
                          </div>
                          {diagram.status === 'failed' && diagram.error_message && (
                            <p className="text-xs text-destructive">{diagram.error_message}</p>
                          )}
                        </div>
                        <div className="flex gap-1">
                          {diagram.status === 'ready' && diagram.file_url && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDownload(diagram.file_url!, diagram.name)}
                                title="Download"
                              >
                                <Download className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => window.location.href = '/swap'}
                                title="Use in Swapper"
                              >
                                <ArrowRight className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openRenameModal(diagram)}
                                title="Edit"
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                          {(diagram.status === 'ready' || diagram.status === 'failed') && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(diagram.id)}
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Upload Modal */}
      <Dialog open={uploadModalOpen} onOpenChange={setUploadModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Character Diagram</DialogTitle>
            <DialogDescription>
              Upload an existing character diagram image directly
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUploadSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="upload-name">Name *</Label>
              <Input
                id="upload-name"
                placeholder="e.g., Model Name - Blue Dress"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                disabled={isUploadingManual}
              />
            </div>

            <div className="space-y-2">
              <Label>Image File *</Label>
              {!uploadFile ? (
                <div
                  {...getUploadRootProps()}
                  className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                    isUploadDragActive
                      ? 'border-primary bg-primary/5'
                      : 'border-muted-foreground/25 hover:border-primary/50'
                  } ${isUploadingManual ? 'pointer-events-none opacity-50' : ''}`}
                >
                  <input {...getUploadInputProps()} />
                  <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Drag & drop or click to select
                  </p>
                </div>
              ) : (
                <div className="relative">
                  <img
                    src={uploadPreview!}
                    alt="Preview"
                    className="w-full max-h-48 object-contain rounded-lg border"
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="absolute top-2 right-2"
                    onClick={clearUploadFile}
                    disabled={isUploadingManual}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={resetUploadModal} disabled={isUploadingManual}>
                Cancel
              </Button>
              <Button type="submit" disabled={isUploadingManual || !uploadFile || !uploadName.trim()}>
                {isUploadingManual ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Upload
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rename Modal */}
      <Dialog open={renameModalOpen} onOpenChange={setRenameModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename Character Diagram</DialogTitle>
            <DialogDescription>Enter a new name for this diagram</DialogDescription>
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
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRenameModalOpen(false)} disabled={isRenaming}>
                Cancel
              </Button>
              <Button type="submit" disabled={isRenaming || !renameName.trim()}>
                {isRenaming ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Save
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
