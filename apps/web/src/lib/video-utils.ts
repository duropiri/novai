/**
 * Video metadata extraction utilities
 * Uses HTML5 video element and canvas to extract duration, dimensions, and thumbnails
 */

export interface VideoMetadata {
  duration: number; // seconds
  width: number;
  height: number;
  thumbnailBlob: Blob | null;
}

/**
 * Extract metadata from a video file
 * Creates a temporary video element to read duration and dimensions,
 * then captures a frame for the thumbnail
 */
export function extractVideoMetadata(file: File): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto'; // Need 'auto' to actually load video data for seeking
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';

    const objectUrl = URL.createObjectURL(file);
    let timeoutId: ReturnType<typeof setTimeout>;
    let resolved = false;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      URL.revokeObjectURL(objectUrl);
      video.src = '';
      video.load();
    };

    const resolveWith = (metadata: VideoMetadata) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(metadata);
    };

    const rejectWith = (error: Error) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(error);
    };

    video.onloadedmetadata = () => {
      // Check if we have valid video dimensions
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        // Wait a bit for dimensions to be available
        setTimeout(() => {
          if (video.videoWidth === 0 || video.videoHeight === 0) {
            // Return with just duration if we can't get dimensions
            resolveWith({
              duration: video.duration || 0,
              width: 0,
              height: 0,
              thumbnailBlob: null,
            });
          } else {
            // Seek to capture thumbnail
            video.currentTime = Math.min(1, video.duration / 4);
          }
        }, 100);
      } else {
        // Seek to capture thumbnail (1 second in, or 1/4 through for short videos)
        video.currentTime = Math.min(1, video.duration / 4);
      }
    };

    video.onloadeddata = () => {
      // Video data is loaded, try seeking if we haven't already
      if (video.currentTime === 0 && video.duration > 0) {
        video.currentTime = Math.min(1, video.duration / 4);
      }
    };

    video.onseeked = () => {
      // Capture the thumbnail
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (!ctx || video.videoWidth === 0) {
          resolveWith({
            duration: video.duration || 0,
            width: video.videoWidth || 0,
            height: video.videoHeight || 0,
            thumbnailBlob: null,
          });
          return;
        }

        // Set canvas size to video dimensions (max 480px for thumbnail)
        const maxSize = 480;
        let width = video.videoWidth;
        let height = video.videoHeight;

        if (width > maxSize || height > maxSize) {
          if (width > height) {
            height = Math.round((height / width) * maxSize);
            width = maxSize;
          } else {
            width = Math.round((width / height) * maxSize);
            height = maxSize;
          }
        }

        canvas.width = width;
        canvas.height = height;

        // Draw the video frame
        ctx.drawImage(video, 0, 0, width, height);

        // Convert to blob
        canvas.toBlob(
          (blob) => {
            resolveWith({
              duration: video.duration || 0,
              width: video.videoWidth || 0,
              height: video.videoHeight || 0,
              thumbnailBlob: blob,
            });
          },
          'image/jpeg',
          0.85
        );
      } catch (err) {
        // If thumbnail capture fails, still return the metadata we have
        resolveWith({
          duration: video.duration || 0,
          width: video.videoWidth || 0,
          height: video.videoHeight || 0,
          thumbnailBlob: null,
        });
      }
    };

    video.onerror = () => {
      rejectWith(new Error(`Failed to load video: ${video.error?.message || 'Unknown error'}`));
    };

    // Timeout after 15 seconds
    timeoutId = setTimeout(() => {
      // If we have some metadata, return what we have instead of failing
      if (video.duration > 0) {
        resolveWith({
          duration: video.duration,
          width: video.videoWidth || 0,
          height: video.videoHeight || 0,
          thumbnailBlob: null,
        });
      } else {
        rejectWith(new Error('Video metadata extraction timed out'));
      }
    }, 15000);

    video.src = objectUrl;
    video.load();
  });
}

/**
 * Format duration in seconds to MM:SS string
 */
export function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format file size in bytes to human readable string
 */
export function formatFileSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
