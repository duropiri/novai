'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Video, VideoOff, Wifi, WifiOff } from 'lucide-react';

interface LivePreviewProps {
  frameData: ArrayBuffer | null;
  isConnected: boolean;
  phoneConnected: boolean;
  currentAngle?: string;
  className?: string;
}

export function LivePreview({
  frameData,
  isConnected,
  phoneConnected,
  currentAngle,
  className,
}: LivePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [lastFrameTime, setLastFrameTime] = useState<number>(0);
  const [fps, setFps] = useState<number>(0);
  const frameCountRef = useRef(0);
  const fpsIntervalRef = useRef<NodeJS.Timeout>();

  // Draw frame to canvas
  useEffect(() => {
    if (!frameData || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Create blob from ArrayBuffer and load as image
    const blob = new Blob([frameData], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      // Set canvas size to match image
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      // Update frame count for FPS calculation
      frameCountRef.current++;
      setLastFrameTime(Date.now());
    };

    img.src = url;
  }, [frameData]);

  // Calculate FPS
  useEffect(() => {
    fpsIntervalRef.current = setInterval(() => {
      setFps(frameCountRef.current);
      frameCountRef.current = 0;
    }, 1000);

    return () => {
      if (fpsIntervalRef.current) {
        clearInterval(fpsIntervalRef.current);
      }
    };
  }, []);

  // Check if stream is stale (no frame in last 2 seconds)
  const isStale = lastFrameTime > 0 && Date.now() - lastFrameTime > 2000;

  return (
    <Card className={cn('relative overflow-hidden', className)}>
      <CardContent className="p-0">
        {/* Status badges */}
        <div className="absolute top-2 left-2 z-10 flex gap-2">
          <Badge
            variant={isConnected ? 'default' : 'destructive'}
            className="flex items-center gap-1"
          >
            {isConnected ? (
              <Wifi className="w-3 h-3" />
            ) : (
              <WifiOff className="w-3 h-3" />
            )}
            {isConnected ? 'Connected' : 'Disconnected'}
          </Badge>

          {phoneConnected && (
            <Badge variant="secondary" className="flex items-center gap-1">
              <Video className="w-3 h-3" />
              Phone
            </Badge>
          )}

          {fps > 0 && (
            <Badge variant="outline" className="text-xs">
              {fps} FPS
            </Badge>
          )}
        </div>

        {/* Current angle indicator */}
        {currentAngle && (
          <div className="absolute top-2 right-2 z-10">
            <Badge variant="secondary" className="text-sm font-medium">
              {currentAngle}
            </Badge>
          </div>
        )}

        {/* Canvas for video preview */}
        <div className="relative aspect-[4/3] bg-muted flex items-center justify-center">
          <canvas
            ref={canvasRef}
            className={cn(
              'max-w-full max-h-full object-contain',
              isStale && 'opacity-50'
            )}
          />

          {/* Placeholder when no stream */}
          {!frameData && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
              {phoneConnected ? (
                <>
                  <Video className="w-12 h-12 mb-2 animate-pulse" />
                  <p className="text-sm">Waiting for video stream...</p>
                </>
              ) : (
                <>
                  <VideoOff className="w-12 h-12 mb-2" />
                  <p className="text-sm">Connect your phone to start</p>
                </>
              )}
            </div>
          )}

          {/* Stale stream indicator */}
          {isStale && frameData && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <p className="text-white text-sm">Stream paused</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
