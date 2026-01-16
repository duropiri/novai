'use client';

import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Trash2, Loader2, CheckCircle, XCircle, Clock, Download, ArrowRight, Plus, Pencil, Images, Shirt, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { characterApi, filesApi, type CharacterDiagram } from '@/lib/api';
import { MultiImageUploader, type UploadedImage } from '@/components/multi-image-uploader';

type ClothingOption = 'original' | 'minimal';

export default function CharacterDiagramPage() {
  const { toast } = useToast();

  // Form state
  const [clothingOption, setClothingOption] = useState<ClothingOption>('original');
  const [name, setName] = useState('');
  // Multi-image support
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [primaryImageIndex, setPrimaryImageIndex] = useState(0);
  // Legacy single file state for backward compatibility
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // Data state
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
    fetchDiagrams();
    const interval = setInterval(fetchDiagrams, 5000);
    return () => clearInterval(interval);
  }, [fetchDiagrams]);

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

  // Clear all images
  const clearImages = () => {
    images.forEach((img) => URL.revokeObjectURL(img.preview));
    setImages([]);
    setPrimaryImageIndex(0);
  };

  // Submit handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (images.length === 0) {
      toast({ title: 'Error', description: 'Please upload at least one image', variant: 'destructive' });
      return;
    }

    try {
      setIsGenerating(true);
      setIsUploading(true);

      toast({ title: 'Uploading', description: `Uploading ${images.length} image(s)...` });

      // Upload all images
      const uploadedUrls: string[] = [];
      const imageTypes: Record<number, string> = {};

      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const result = await filesApi.uploadFile(img.file, 'character-images');
        uploadedUrls.push(result.url);
        imageTypes[i] = img.type;
      }

      setIsUploading(false);

      toast({ title: 'Starting', description: 'Starting character diagram generation...' });
      await characterApi.create({
        name: name.trim() || undefined,
        imageUrls: uploadedUrls,
        primaryImageIndex,
        imageTypes,
        clothingOption,
      });

      toast({
        title: 'Success',
        description: `Character diagram generation started with ${images.length} reference image(s)!`,
      });

      setName('');
      setClothingOption('original');
      clearImages();
      fetchDiagrams();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create character diagram';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsGenerating(false);
      setIsUploading(false);
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
    if (diagram.source_image_url) {
      const imageCount = diagram.image_count || 1;
      return (
        <Badge variant="outline" className="text-xs">
          {imageCount > 1 ? (
            <><Images className="w-3 h-3 mr-1" />{imageCount} Photos</>
          ) : (
            'Photo'
          )}
        </Badge>
      );
    }
    return <Badge variant="outline" className="text-xs">Uploaded</Badge>;
  };

  const canSubmit = images.length > 0;

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
        <Card className="flex flex-col max-h-[800px]">
          <CardHeader className="flex-shrink-0">
            <CardTitle>Generate New Diagram</CardTitle>
            <CardDescription>
              Create a character reference sheet with full-body and face close-up views
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Photo Upload - Multi-image */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Source Images</Label>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Images className="w-3 h-3" />
                    <span>Multiple images improve identity consistency</span>
                  </div>
                </div>
                <MultiImageUploader
                  images={images}
                  onChange={setImages}
                  primaryIndex={primaryImageIndex}
                  onPrimaryChange={setPrimaryImageIndex}
                  disabled={isGenerating}
                  minImages={1}
                  imageTypes={['front', 'profile', '3/4 angle', 'full_body', 'expression', 'reference']}
                  enableVideo={true}
                  enableGoogleDrive={true}
                />
              </div>

              {/* Clothing Option */}
              <div className="space-y-3">
                <Label>Clothing Style</Label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setClothingOption('original')}
                    disabled={isGenerating}
                    className={`relative p-3 rounded-lg border-2 transition-all text-left ${
                      clothingOption === 'original'
                        ? 'border-primary bg-primary/5'
                        : 'border-muted hover:border-muted-foreground/50'
                    } ${isGenerating ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Shirt className="w-4 h-4" />
                      <span className="font-medium text-sm">Original Outfit</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Keep the exact clothing from the reference photo
                    </p>
                    {clothingOption === 'original' && (
                      <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setClothingOption('minimal')}
                    disabled={isGenerating}
                    className={`relative p-3 rounded-lg border-2 transition-all text-left ${
                      clothingOption === 'minimal'
                        ? 'border-primary bg-primary/5'
                        : 'border-muted hover:border-muted-foreground/50'
                    } ${isGenerating ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <User className="w-4 h-4" />
                      <span className="font-medium text-sm">Body Proportions</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Minimal athletic wear for accurate body reference
                    </p>
                    {clothingOption === 'minimal' && (
                      <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary" />
                    )}
                  </button>
                </div>
              </div>

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
                Estimated cost: ~$0.02 per diagram
              </div>

              <Button type="submit" className="w-full" disabled={isGenerating || !canSubmit}>
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {isUploading ? 'Uploading...' : 'Generating...'}
                  </>
                ) : (
                  'Generate Character Diagram'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Diagrams List */}
        <Card className="flex flex-col max-h-[800px]">
          <CardHeader className="flex-shrink-0">
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
          <CardContent className="flex-1 overflow-hidden">
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
              <div className="space-y-3 h-full overflow-y-auto pr-1">
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
