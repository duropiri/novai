'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Trash2, Star, GripVertical, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

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
}

const defaultImageTypes = ['front', 'profile', '3/4 angle', 'full_body', 'expression', 'reference'];

export function MultiImageUploader({
  images,
  onChange,
  primaryIndex,
  onPrimaryChange,
  disabled = false,
  maxImages = 10,
  minImages = 1,
  imageTypes = defaultImageTypes,
  showTypeSelector = true,
  className = '',
}: MultiImageUploaderProps) {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const remainingSlots = maxImages - images.length;
    const filesToAdd = acceptedFiles.slice(0, remainingSlots);

    const newImages: UploadedImage[] = filesToAdd
      .filter((file) => file.type.startsWith('image/'))
      .map((file, index) => ({
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

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.webp'],
    },
    multiple: true,
    disabled: disabled || images.length >= maxImages,
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

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
          isDragActive
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-primary/50'
        } ${disabled || images.length >= maxImages ? 'pointer-events-none opacity-50' : ''}`}
      >
        <input {...getInputProps()} />
        <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
        {isDragActive ? (
          <p className="text-sm">Drop images here...</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Drag & drop images, or click to select
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          {images.length}/{maxImages} images ({minImages} min)
        </p>
      </div>

      {/* Image grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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
