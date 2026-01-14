'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, X, Video, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { filesApi, videosApi, type Video as VideoType } from '@/lib/api';
import { extractVideoMetadata, formatDuration } from '@/lib/video-utils';

interface VideoUploadDropzoneProps {
  onUpload: (video: VideoType) => void;
  uploadedVideo: VideoType | null;
  onClear: () => void;
  disabled?: boolean;
}

export function VideoUploadDropzone({
  onUpload,
  uploadedVideo,
  onClear,
  disabled = false,
}: VideoUploadDropzoneProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;

      const file = acceptedFiles[0];
      setIsUploading(true);
      setError(null);
      setUploadProgress('Extracting video metadata...');

      try {
        // Extract video metadata
        let metadata: { duration: number; width: number; height: number; thumbnailBlob: Blob | null } | null = null;
        try {
          metadata = await extractVideoMetadata(file);
        } catch (metadataError) {
          console.warn('Failed to extract video metadata:', metadataError);
        }

        setUploadProgress('Uploading video...');

        // Upload video file
        const uploaded = await filesApi.uploadFile(file, 'source-videos');

        // Upload thumbnail if available
        let thumbnailUrl: string | undefined;
        if (metadata?.thumbnailBlob) {
          setUploadProgress('Uploading thumbnail...');
          try {
            const thumbnailFile = new File(
              [metadata.thumbnailBlob],
              `${file.name.replace(/\.[^/.]+$/, '')}_thumb.jpg`,
              { type: 'image/jpeg' }
            );
            const thumbnailUploaded = await filesApi.uploadFile(thumbnailFile, 'source-videos');
            thumbnailUrl = thumbnailUploaded.url;
          } catch (thumbError) {
            console.warn('Failed to upload thumbnail:', thumbError);
          }
        }

        setUploadProgress('Creating video record...');

        // Create video record (uncategorized - for training purposes)
        const video = await videosApi.create({
          name: file.name.replace(/\.[^/.]+$/, ''),
          fileUrl: uploaded.url,
          fileSizeBytes: file.size,
          durationSeconds: metadata?.duration,
          width: metadata?.width,
          height: metadata?.height,
          thumbnailUrl,
        });

        onUpload(video);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to upload video';
        setError(message);
        console.error('Upload error:', err);
      } finally {
        setIsUploading(false);
        setUploadProgress('');
      }
    },
    [onUpload]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'video/*': ['.mp4', '.mov', '.avi', '.webm', '.mkv'],
    },
    maxFiles: 1,
    disabled: disabled || isUploading,
  });

  if (uploadedVideo) {
    return (
      <div className="relative">
        <div className="aspect-video rounded-lg overflow-hidden border-2 border-primary bg-muted">
          {uploadedVideo.thumbnail_url ? (
            <img
              src={uploadedVideo.thumbnail_url}
              alt={uploadedVideo.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Video className="w-12 h-12 text-muted-foreground" />
            </div>
          )}
        </div>
        <div className="mt-2">
          <p className="text-sm font-medium truncate">{uploadedVideo.name}</p>
          <p className="text-xs text-muted-foreground">
            {formatDuration(uploadedVideo.duration_seconds)}
          </p>
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
        aspect-video rounded-lg border-2 border-dashed
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
          <p className="text-xs text-muted-foreground text-center px-2">
            {uploadProgress || 'Uploading...'}
          </p>
        </>
      ) : isDragActive ? (
        <>
          <Upload className="w-8 h-8 text-primary" />
          <p className="text-xs text-primary">Drop to upload</p>
        </>
      ) : (
        <>
          <Video className="w-8 h-8 text-muted-foreground" />
          <p className="text-xs text-muted-foreground text-center px-2">
            Drop training video or click to upload
          </p>
          <p className="text-xs text-muted-foreground/70 text-center px-2">
            MP4, MOV, WebM supported
          </p>
        </>
      )}
      {error && <p className="text-xs text-destructive text-center px-2">{error}</p>}
    </div>
  );
}
