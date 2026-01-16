'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Trash2, Star, ImageIcon, Loader2, Video, FolderOpen, CheckCircle, Images, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { processFilesWithZipSupport } from '@/lib/zip-utils';
import { useToast } from '@/components/ui/use-toast';

export interface UploadedImage {
  file: File;
  preview: string;
  type: string;
}

export interface GoogleDriveZipResult {
  zipUrl: string;
  count: number;
}

export interface MultiImageUploaderProps {
  images: UploadedImage[];
  onChange: (images: UploadedImage[] | ((prev: UploadedImage[]) => UploadedImage[])) => void;
  primaryIndex?: number;
  onPrimaryChange?: (index: number) => void;
  disabled?: boolean;
  maxImages?: number;
  minImages?: number;
  imageTypes?: string[];
  showTypeSelector?: boolean;
  showPrimary?: boolean;
  className?: string;
  enableVideo?: boolean;
  enableGoogleDrive?: boolean;
  // Google Drive ZIP mode - returns ZIP URL instead of downloading files
  googleDriveZipMode?: boolean;
  googleDriveZipResult?: GoogleDriveZipResult | null;
  onGoogleDriveZip?: (result: GoogleDriveZipResult | null) => void;
  // Gallery mode for large image sets
  previewLimit?: number;
  showGallery?: boolean;
  // Custom labels
  dropzoneLabel?: string;
  dropzoneSublabel?: string;
  emptyStateLabel?: string;
}

const defaultImageTypes = ['front', 'profile', '3/4 angle', 'full_body', 'expression', 'reference'];

export function MultiImageUploader({
  images,
  onChange,
  primaryIndex = 0,
  onPrimaryChange,
  disabled = false,
  maxImages = 50,
  minImages = 1,
  imageTypes = defaultImageTypes,
  showTypeSelector = false,
  showPrimary = true,
  className = '',
  enableVideo = false,
  enableGoogleDrive = false,
  googleDriveZipMode = false,
  googleDriveZipResult = null,
  onGoogleDriveZip,
  previewLimit = 0,
  showGallery = false,
  dropzoneLabel,
  dropzoneSublabel,
  emptyStateLabel,
}: MultiImageUploaderProps) {
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isProcessingVideo, setIsProcessingVideo] = useState(false);
  const [googleDriveUrl, setGoogleDriveUrl] = useState('');
  const [isImportingDrive, setIsImportingDrive] = useState(false);

  // Gallery state
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);

  // Determine effective preview limit
  const effectivePreviewLimit = previewLimit > 0 ? previewLimit : images.length;
  const hasMoreImages = images.length > effectivePreviewLimit;

  const addImages = useCallback((newFiles: File[]) => {
    // Use functional update to avoid stale closure issues when processing videos/batches
    onChange((prevImages: UploadedImage[]) => {
      const remainingSlots = maxImages - prevImages.length;
      const filesToAdd = newFiles.slice(0, remainingSlots);

      const newImages: UploadedImage[] = filesToAdd.map((file, index) => ({
        file,
        preview: URL.createObjectURL(file),
        type: prevImages.length === 0 && index === 0 ? 'front' : 'reference',
      }));

      if (newImages.length > 0) {
        // If this is the first image, set it as primary
        if (prevImages.length === 0 && onPrimaryChange) {
          onPrimaryChange(0);
        }
        return [...prevImages, ...newImages];
      }
      return prevImages;
    });
  }, [onChange, onPrimaryChange, maxImages]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    // Separate videos from other files
    const videoFiles = enableVideo ? acceptedFiles.filter(f =>
      f.type.startsWith('video/') || ['.mp4', '.mov', '.avi', '.webm'].some(ext => f.name.toLowerCase().endsWith(ext))
    ) : [];
    const otherFiles = acceptedFiles.filter(f =>
      !f.type.startsWith('video/') && !['.mp4', '.mov', '.avi', '.webm'].some(ext => f.name.toLowerCase().endsWith(ext))
    );

    // Process non-video files (images and ZIPs)
    if (otherFiles.length > 0) {
      setIsProcessing(true);
      try {
        const processedFiles = await processFilesWithZipSupport(otherFiles);
        addImages(processedFiles);
      } finally {
        setIsProcessing(false);
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

          addImages(frameFiles);
          toast({ title: 'Frames Extracted', description: `Extracted ${frameFiles.length} frames from ${video.name}` });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to process video';
          toast({ title: 'Error', description: message, variant: 'destructive' });
        }
      }
      setIsProcessingVideo(false);
    }
  }, [enableVideo, addImages, toast]);

  // Import from Google Drive folder
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
          createZip: googleDriveZipMode,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to import from Google Drive');
      }

      const data = await response.json();

      if (googleDriveZipMode && onGoogleDriveZip) {
        // ZIP mode - return ZIP URL instead of downloading files
        const zipUrl = data.zipUrl;
        const count = data.count || 0;

        if (!zipUrl) {
          throw new Error('No images found in Google Drive folder');
        }

        onGoogleDriveZip({ zipUrl, count });
        // Clear local images when using ZIP mode
        onChange([]);
        setGoogleDriveUrl('');
        toast({ title: 'Import Complete', description: `Ready to use ${count} images from Google Drive` });
      } else {
        // Normal mode - download files locally
        const imageUrls: string[] = data.images || [];

        // Convert URLs to File objects
        const importedFiles: File[] = [];
        for (let i = 0; i < imageUrls.length; i++) {
          const imageResponse = await fetch(imageUrls[i]);
          const blob = await imageResponse.blob();
          const ext = imageUrls[i].split('.').pop()?.split('?')[0] || 'png';
          const file = new File([blob], `gdrive_import_${i.toString().padStart(4, '0')}.${ext}`, { type: blob.type || 'image/png' });
          importedFiles.push(file);
        }

        addImages(importedFiles);
        setGoogleDriveUrl('');
        toast({ title: 'Import Complete', description: `Imported ${importedFiles.length} images from Google Drive` });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsImportingDrive(false);
    }
  };

  // Clear Google Drive ZIP import
  const clearGoogleDriveZip = () => {
    if (onGoogleDriveZip) {
      onGoogleDriveZip(null);
    }
  };

  const acceptTypes: Record<string, string[]> = {
    'image/*': ['.png', '.jpg', '.jpeg', '.webp'],
    'application/zip': ['.zip'],
    'application/x-zip-compressed': ['.zip'],
  };
  if (enableVideo) {
    acceptTypes['video/*'] = ['.mp4', '.mov', '.avi', '.webm'];
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: acceptTypes,
    multiple: true,
    disabled: disabled || isProcessing || isProcessingVideo || images.length >= maxImages,
  });

  const removeImage = (index: number) => {
    // Clean up URL object
    URL.revokeObjectURL(images[index].preview);

    const newImages = images.filter((_, i) => i !== index);
    onChange(newImages);

    // Adjust primary index if needed
    if (onPrimaryChange) {
      if (index === primaryIndex) {
        onPrimaryChange(0);
      } else if (index < primaryIndex) {
        onPrimaryChange(primaryIndex - 1);
      }
    }
  };

  const setImageType = (index: number, type: string) => {
    const newImages = [...images];
    newImages[index] = { ...newImages[index], type };
    onChange(newImages);
  };

  const setPrimary = (index: number) => {
    if (!onPrimaryChange) return;

    onPrimaryChange(index);
    // Also set the type to 'front' for the new primary
    const newImages = [...images];
    newImages[index] = { ...newImages[index], type: 'front' };
    // Set old primary to 'reference' if it was 'front'
    if (newImages[primaryIndex]?.type === 'front') {
      newImages[primaryIndex] = { ...newImages[primaryIndex], type: 'reference' };
    }
    onChange(newImages);
  };

  // Gallery navigation
  const openGallery = (index: number) => {
    setGalleryIndex(index);
    setGalleryOpen(true);
  };

  const nextImage = () => {
    setGalleryIndex((prev) => (prev + 1) % images.length);
  };

  const prevImage = () => {
    setGalleryIndex((prev) => (prev - 1 + images.length) % images.length);
  };

  const isAnyProcessing = isProcessing || isProcessingVideo || isImportingDrive;

  // Get images to display in preview
  const previewImages = hasMoreImages ? images.slice(0, effectivePreviewLimit) : images;

  // Default labels
  const defaultDropzoneLabel = enableVideo ? 'Drag & drop images, videos, or ZIP' : 'Drag & drop images or ZIP';
  const defaultDropzoneSublabel = enableVideo ? 'Images, Videos (frames auto-extracted), or ZIP' : 'PNG, JPG, WebP, or ZIP';
  const defaultEmptyStateLabel = 'No images uploaded yet';

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Google Drive ZIP Mode Success State */}
      {googleDriveZipMode && googleDriveZipResult && (
        <div className="border-2 border-primary/50 bg-primary/5 rounded-lg p-6 text-center">
          <CheckCircle className="w-8 h-8 mx-auto mb-2 text-primary" />
          <p className="font-medium">{googleDriveZipResult.count} images from Google Drive</p>
          <p className="text-sm text-muted-foreground mt-1">
            Ready to use
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-3"
            onClick={clearGoogleDriveZip}
            disabled={disabled}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Clear and upload different images
          </Button>
        </div>
      )}

      {/* Drop zone - hide when Google Drive ZIP is active */}
      {!(googleDriveZipMode && googleDriveZipResult) && (
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
            isDragActive
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-primary/50'
          } ${disabled || isAnyProcessing || images.length >= maxImages ? 'pointer-events-none opacity-50' : ''}`}
        >
          <input {...getInputProps()} />
          {isProcessing ? (
            <>
              <Loader2 className="w-6 h-6 mx-auto mb-2 text-muted-foreground animate-spin" />
              <p className="text-sm text-muted-foreground">Extracting images...</p>
            </>
          ) : isProcessingVideo ? (
            <>
              <Loader2 className="w-6 h-6 mx-auto mb-2 text-muted-foreground animate-spin" />
              <p className="text-sm text-muted-foreground">Extracting frames from video...</p>
            </>
          ) : (
            <>
              <div className="flex items-center justify-center gap-2 mb-2">
                <Upload className="w-6 h-6 text-muted-foreground" />
                {enableVideo && <Video className="w-5 h-5 text-muted-foreground" />}
              </div>
              {isDragActive ? (
                <p className="text-sm">Drop files here...</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {dropzoneLabel || defaultDropzoneLabel}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {dropzoneSublabel || defaultDropzoneSublabel}
              </p>
            </>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            {images.length} image{images.length !== 1 ? 's' : ''} ({minImages} min)
          </p>
        </div>
      )}

      {/* Google Drive Import */}
      {enableGoogleDrive && !(googleDriveZipMode && googleDriveZipResult) && (
        <>
          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
              <Input
                placeholder="Google Drive folder URL..."
                value={googleDriveUrl}
                onChange={(e) => setGoogleDriveUrl(e.target.value)}
                disabled={disabled || isAnyProcessing}
                className="flex-1"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleGoogleDriveImport}
              disabled={disabled || isAnyProcessing || !googleDriveUrl.trim()}
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

      {/* Image grid - scrollable */}
      {images.length > 0 && (
        <div className="space-y-2">
          {/* Header with view all button */}
          {showGallery && hasMoreImages && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {images.length} images
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => openGallery(0)}
                className="text-xs"
              >
                <Images className="w-3 h-3 mr-1" />
                View All
              </Button>
            </div>
          )}

          <div className="max-h-64 overflow-y-auto rounded-lg border bg-muted/20 p-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {previewImages.map((image, index) => (
                <div
                  key={image.preview}
                  className={`relative group rounded-lg overflow-hidden border-2 transition-all ${
                    showPrimary && index === primaryIndex
                      ? 'border-primary ring-2 ring-primary/30'
                      : 'border-transparent hover:border-muted-foreground/50'
                  }`}
                >
                  {/* Image */}
                  <div className="aspect-square">
                    <img
                      src={image.preview}
                      alt={`Upload ${index + 1}`}
                      className="w-full h-full object-cover"
                      onClick={showGallery ? () => openGallery(index) : undefined}
                    />
                  </div>

                  {/* Primary badge */}
                  {showPrimary && index === primaryIndex && (
                    <Badge
                      className="absolute top-1 left-1 text-xs py-0"
                      variant="default"
                    >
                      <Star className="w-3 h-3 mr-0.5 fill-current" />
                      Primary
                    </Badge>
                  )}

                  {/* Overlay controls */}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                    {showPrimary && index !== primaryIndex && onPrimaryChange && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setPrimary(index)}
                        disabled={disabled}
                        className="text-xs"
                      >
                        <Star className="w-3 h-3 mr-1" />
                        Set Primary
                      </Button>
                    )}
                    {images.length > minImages && (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => removeImage(index)}
                        disabled={disabled}
                        className="text-xs"
                      >
                        <Trash2 className="w-3 h-3 mr-1" />
                        Remove
                      </Button>
                    )}
                  </div>

                  {/* Type selector */}
                  {showTypeSelector && (
                    <div className="absolute bottom-0 left-0 right-0 bg-black/70 p-1">
                      <Select
                        value={image.type}
                        onValueChange={(value) => setImageType(index, value)}
                        disabled={disabled}
                      >
                        <SelectTrigger className="h-6 text-xs bg-transparent border-0 text-white">
                          <SelectValue placeholder="Type" />
                        </SelectTrigger>
                        <SelectContent>
                          {imageTypes.map((type) => (
                            <SelectItem key={type} value={type} className="text-xs">
                              {type.replace('_', ' ')}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              ))}

              {/* Show "+X more" indicator */}
              {hasMoreImages && showGallery && (
                <button
                  type="button"
                  onClick={() => openGallery(effectivePreviewLimit)}
                  className="aspect-square bg-muted rounded-lg flex flex-col items-center justify-center text-muted-foreground hover:bg-muted/80 transition-colors border-2 border-transparent"
                >
                  <Images className="w-5 h-5 mb-1" />
                  <span className="text-xs font-medium">+{images.length - effectivePreviewLimit} more</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {images.length === 0 && !(googleDriveZipMode && googleDriveZipResult) && (
        <div className="text-center py-4 text-muted-foreground text-sm">
          <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>{emptyStateLabel || defaultEmptyStateLabel}</p>
        </div>
      )}

      {/* Gallery Modal */}
      {showGallery && (
        <Dialog open={galleryOpen} onOpenChange={setGalleryOpen}>
          <DialogContent className="max-w-4xl h-[80vh] p-0 gap-0">
            <DialogHeader className="p-4 pb-2">
              <DialogTitle className="flex items-center justify-between">
                <span>Images</span>
                <span className="text-sm font-normal text-muted-foreground">
                  {galleryIndex + 1} of {images.length}
                </span>
              </DialogTitle>
            </DialogHeader>
            <div className="flex-1 flex items-center justify-center bg-muted/30 relative overflow-hidden">
              {images.length > 0 && images[galleryIndex] && (
                <>
                  <img
                    src={images[galleryIndex].preview}
                    alt={images[galleryIndex].file?.name || `Image ${galleryIndex + 1}`}
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
                  {images[galleryIndex]?.file?.name || `Image ${galleryIndex + 1}`}
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    removeImage(galleryIndex);
                    if (galleryIndex >= images.length - 1 && galleryIndex > 0) {
                      setGalleryIndex(galleryIndex - 1);
                    }
                    if (images.length <= 1) {
                      setGalleryOpen(false);
                    }
                  }}
                  disabled={images.length <= minImages}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Remove
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

export default MultiImageUploader;
