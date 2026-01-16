'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { ANGLE_DISPLAY_NAMES } from '@/lib/api';
import { Check, Circle, Target } from 'lucide-react';

interface AngleGridProps {
  targetAngles: string[];
  capturedAngles: Record<string, { url: string; quality: number }>;
  currentAngle?: string;
  onAngleSelect?: (angle: string) => void;
  className?: string;
}

export function AngleGrid({
  targetAngles,
  capturedAngles,
  currentAngle,
  onAngleSelect,
  className,
}: AngleGridProps) {
  const capturedCount = Object.keys(capturedAngles).length;
  const totalAngles = targetAngles.length;
  const progress = totalAngles > 0 ? (capturedCount / totalAngles) * 100 : 0;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Captured Angles</CardTitle>
          <span className="text-sm text-muted-foreground">
            {capturedCount} / {totalAngles}
          </span>
        </div>
        {/* Progress bar */}
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-4 gap-2">
          {targetAngles.map((angle) => {
            const isCaptured = angle in capturedAngles;
            const isCurrent = angle === currentAngle;
            const capture = capturedAngles[angle];

            return (
              <button
                key={angle}
                onClick={() => onAngleSelect?.(angle)}
                className={cn(
                  'relative aspect-square rounded-lg border-2 transition-all duration-200',
                  'flex flex-col items-center justify-center p-1',
                  'hover:bg-muted/50',
                  isCaptured && 'border-green-500 bg-green-50 dark:bg-green-950',
                  isCurrent && !isCaptured && 'border-blue-500 bg-blue-50 dark:bg-blue-950',
                  !isCaptured && !isCurrent && 'border-muted-foreground/30'
                )}
              >
                {/* Thumbnail or icon */}
                {isCaptured && capture?.url ? (
                  <img
                    src={capture.url}
                    alt={angle}
                    className="w-full h-full object-cover rounded-md"
                  />
                ) : (
                  <div className="flex flex-col items-center">
                    {isCaptured ? (
                      <Check className="w-5 h-5 text-green-500" />
                    ) : isCurrent ? (
                      <Target className="w-5 h-5 text-blue-500 animate-pulse" />
                    ) : (
                      <Circle className="w-5 h-5 text-muted-foreground/50" />
                    )}
                  </div>
                )}

                {/* Angle label */}
                <span
                  className={cn(
                    'absolute bottom-0 left-0 right-0 text-[10px] text-center py-0.5',
                    'bg-black/50 text-white rounded-b-md truncate px-1',
                    isCaptured && 'bg-green-600/80',
                    isCurrent && !isCaptured && 'bg-blue-600/80'
                  )}
                >
                  {ANGLE_DISPLAY_NAMES[angle] || angle}
                </span>

                {/* Quality indicator for captured angles */}
                {isCaptured && capture?.quality && (
                  <span
                    className={cn(
                      'absolute top-0.5 right-0.5 text-[8px] px-1 rounded',
                      'bg-white/90 text-gray-700 font-medium'
                    )}
                  >
                    {Math.round(capture.quality * 100)}%
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
