'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, X, User, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { processFilesWithZipSupport } from '@/lib/zip-utils';

interface FaceUploadDropzoneProps {
  onUpload: (urls: string[]) => void;
  uploadedUrls: string[];
  onClear: () => void;
  onRemove?: (index: number) => void;
  disabled?: boolean;
  maxImages?: number;
}

export function FaceUploadDropzone({
  onUpload,
  uploadedUrls,
  onClear,
  onRemove,
  disabled = false,
  maxImages = 10,
}: FaceUploadDropzoneProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;

      setIsUploading(true);
      setError(null);

      try {
        // Process files, extracting images from any ZIP files
        const imageFiles = await processFilesWithZipSupport(acceptedFiles);

        if (imageFiles.length === 0) {
          setError('No valid images found');
          return;
        }

        // Upload all files in parallel
        const uploadPromises = imageFiles.map(async (file) => {
          const formData = new FormData();
          formData.append('file', file);

          const response = await fetch('/api/upload/face', {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            throw new Error('Upload failed');
          }

          const data = await response.json();
          return data.url;
        });

        const newUrls = await Promise.all(uploadPromises);
        onUpload([...uploadedUrls, ...newUrls].slice(0, maxImages));
      } catch (err) {
        setError('Failed to upload image(s). Please try again.');
        console.error('Upload error:', err);
      } finally {
        setIsUploading(false);
      }
    },
    [onUpload, uploadedUrls, maxImages]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.webp'],
      'application/zip': ['.zip'],
      'application/x-zip-compressed': ['.zip'],
    },
    multiple: true,
    disabled: disabled || isUploading || uploadedUrls.length >= maxImages,
  });

  const handleRemove = (index: number) => {
    if (onRemove) {
      onRemove(index);
    } else {
      const newUrls = uploadedUrls.filter((_, i) => i !== index);
      onUpload(newUrls);
    }
  };

  // Show grid of uploaded images + dropzone to add more
  return (
    <div className="space-y-2">
      {/* Uploaded images grid - scrollable */}
      {uploadedUrls.length > 0 && (
        <div className="max-h-36 overflow-y-auto rounded-lg border bg-muted/20 p-2">
          <div className="grid grid-cols-3 gap-2">
            {uploadedUrls.map((url, index) => (
              <div key={index} className="relative group">
                <div className="aspect-square rounded-lg overflow-hidden border-2 border-primary">
                  <img
                    src={url}
                    alt={`Face ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                </div>
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute -top-1 -right-1 w-5 h-5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => handleRemove(index)}
                >
                  <X className="w-3 h-3" />
                </Button>
                {index === 0 && (
                  <Badge className="absolute bottom-1 left-1 text-[10px] px-1" variant="secondary">
                    Primary
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Clear all button */}
      {uploadedUrls.length > 1 && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs"
          onClick={onClear}
        >
          Clear all
        </Button>
      )}

      {/* Dropzone - show if we can still add more */}
      {uploadedUrls.length < maxImages && (
        <div
          {...getRootProps()}
          className={`
            ${uploadedUrls.length > 0 ? 'aspect-video' : 'aspect-square'} rounded-lg border-2 border-dashed
            flex flex-col items-center justify-center gap-2 cursor-pointer
            transition-colors
            ${isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          `}
        >
          <input {...getInputProps()} />
          {isUploading ? (
            <>
              <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
              <p className="text-xs text-muted-foreground">Uploading...</p>
            </>
          ) : isDragActive ? (
            <>
              <Upload className="w-6 h-6 text-primary" />
              <p className="text-xs text-primary">Drop to upload</p>
            </>
          ) : (
            <>
              <User className="w-6 h-6 text-muted-foreground" />
              <p className="text-xs text-muted-foreground text-center px-2">
                {uploadedUrls.length === 0
                  ? 'Drop face images or click to upload'
                  : 'Add more reference images'}
              </p>
              {uploadedUrls.length === 0 && (
                <p className="text-xs text-muted-foreground/60">
                  Multiple images improve accuracy
                </p>
              )}
            </>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
