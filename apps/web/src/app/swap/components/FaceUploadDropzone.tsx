'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, X, User, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface FaceUploadDropzoneProps {
  onUpload: (url: string) => void;
  uploadedUrl: string | null;
  onClear: () => void;
  disabled?: boolean;
}

export function FaceUploadDropzone({
  onUpload,
  uploadedUrl,
  onClear,
  disabled = false,
}: FaceUploadDropzoneProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;

      const file = acceptedFiles[0];
      setIsUploading(true);
      setError(null);

      try {
        // Upload to our API which will store in Supabase
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
        onUpload(data.url);
      } catch (err) {
        setError('Failed to upload image. Please try again.');
        console.error('Upload error:', err);
      } finally {
        setIsUploading(false);
      }
    },
    [onUpload]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.webp'],
    },
    maxFiles: 1,
    disabled: disabled || isUploading,
  });

  if (uploadedUrl) {
    return (
      <div className="relative">
        <div className="aspect-square rounded-lg overflow-hidden border-2 border-primary">
          <img
            src={uploadedUrl}
            alt="Uploaded face"
            className="w-full h-full object-cover"
          />
        </div>
        <Button
          variant="destructive"
          size="icon"
          className="absolute -top-2 -right-2 w-6 h-6 rounded-full"
          onClick={onClear}
        >
          <X className="w-3 h-3" />
        </Button>
      </div>
    );
  }

  return (
    <div
      {...getRootProps()}
      className={`
        aspect-square rounded-lg border-2 border-dashed
        flex flex-col items-center justify-center gap-2 cursor-pointer
        transition-colors
        ${isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      <input {...getInputProps()} />
      {isUploading ? (
        <>
          <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
          <p className="text-xs text-muted-foreground">Uploading...</p>
        </>
      ) : isDragActive ? (
        <>
          <Upload className="w-8 h-8 text-primary" />
          <p className="text-xs text-primary">Drop to upload</p>
        </>
      ) : (
        <>
          <User className="w-8 h-8 text-muted-foreground" />
          <p className="text-xs text-muted-foreground text-center px-2">
            Drop face image or click to upload
          </p>
        </>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
