'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Trash2, Star, GripVertical, ImageIcon, Loader2, Video, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { processFilesWithZipSupport } from '@/lib/zip-utils';
import { useToast } from '@/components/ui/use-toast';

export interface UploadedImage {
  file: File;
  preview: string;
  type: string;
}

export interface MultiImageUploaderProps {
  images: UploadedImage[];
  onChange: (images: UploadedImage[]) => void;
  primaryIndex: number;
  onPrimaryChange: (index: number) => void;
  disabled?: boolean;
  maxImages?: number;
  minImages?: number;
  imageTypes?: string[];
  showTypeSelector?: boolean;
  className?: string;
  enableVideo?: boolean;
  enableGoogleDrive?: boolean;
}

const defaultImageTypes = ['front', 'profile', '3/4 angle', 'full_body', 'expression', 'reference'];

export function MultiImageUploader({
  images,
  onChange,
  primaryIndex,
  onPrimaryChange,
  disabled = false,
  maxImages = 50,
  minImages = 1,
  imageTypes = defaultImageTypes,
  showTypeSelector = true,
  className = '',
  enableVideo = false,
  enableGoogleDrive = false,
}: MultiImageUploaderProps) {
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isProcessingVideo, setIsProcessingVideo] = useState(false);
  const [googleDriveUrl, setGoogleDriveUrl] = useState('');
  const [isImportingDrive, setIsImportingDrive] = useState(false);

  const addImages = useCallback((newFiles: File[]) => {
    const remainingSlots = maxImages - images.length;
    const filesToAdd = newFiles.slice(0, remainingSlots);

    const newImages: UploadedImage[] = filesToAdd.map((file, index) => ({
      file,
      preview: URL.createObjectURL(file),
      type: images.length === 0 && index === 0 ? 'front' : 'reference',
    }));

    if (newImages.length > 0) {
      const updatedImages = [...images, ...newImages];
      onChange(updatedImages);

      // If this is the first image, set it as primary
      if (images.length === 0) {
        onPrimaryChange(0);
      }
    }
  }, [images, onChange, onPrimaryChange, maxImages]);

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
    toast({ title: 'Importing', description: 'Downloading files from Google Drive...' });

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/files/import-gdrive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderUrl: googleDriveUrl.trim(),
          maxFramesPerVideo: 50,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to import from Google Drive');
      }

      const data = await response.json();
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsImportingDrive(false);
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
    if (index === primaryIndex) {
      onPrimaryChange(0);
    } else if (index < primaryIndex) {
      onPrimaryChange(primaryIndex - 1);
    }
  };

  const setImageType = (index: number, type: string) => {
    const newImages = [...images];
    newImages[index] = { ...newImages[index], type };
    onChange(newImages);
  };

  const setPrimary = (index: number) => {
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

  const isAnyProcessing = isProcessing || isProcessingVideo || isImportingDrive;

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Drop zone */}
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
                Drag & drop {enableVideo ? 'images, videos, or ZIP' : 'images or ZIP'}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {enableVideo ? 'Images, Videos (frames auto-extracted), or ZIP' : 'PNG, JPG, WebP, or ZIP'}
            </p>
          </>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          {images.length} image{images.length !== 1 ? 's' : ''} ({minImages} min)
        </p>
      </div>

      {/* Google Drive Import */}
      {enableGoogleDrive && (
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
      )}

      {/* Image grid - scrollable */}
      {images.length > 0 && (
        <div className="max-h-64 overflow-y-auto rounded-lg border bg-muted/20 p-2">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {images.map((image, index) => (
            <div
              key={image.preview}
              className={`relative group rounded-lg overflow-hidden border-2 transition-all ${
                index === primaryIndex
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
                />
              </div>

              {/* Primary badge */}
              {index === primaryIndex && (
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
                {index !== primaryIndex && (
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
          </div>
        </div>
      )}

      {/* Empty state */}
      {images.length === 0 && (
        <div className="text-center py-4 text-muted-foreground text-sm">
          <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No images uploaded yet</p>
        </div>
      )}
    </div>
  );
}

export default MultiImageUploader;
