'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { ANGLE_DISPLAY_NAMES, ScanCapture } from '@/lib/api';
import { Trash2, ZoomIn, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface CaptureGalleryProps {
  captures: ScanCapture[];
  onToggleSelection?: (captureId: string, isSelected: boolean) => void;
  onDelete?: (captureId: string) => void;
  className?: string;
}

export function CaptureGallery({
  captures,
  onToggleSelection,
  onDelete,
  className,
}: CaptureGalleryProps) {
  const [previewCapture, setPreviewCapture] = useState<ScanCapture | null>(null);

  const selectedCount = captures.filter((c) => c.is_selected).length;

  if (captures.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-base">Captures</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">
            No captures yet. Connect your phone and start scanning.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className={className}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Captures</CardTitle>
            <span className="text-sm text-muted-foreground">
              {selectedCount} / {captures.length} selected
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
            {captures.map((capture) => (
              <div
                key={capture.id}
                className={cn(
                  'group relative aspect-square rounded-lg overflow-hidden border-2',
                  'transition-all duration-200',
                  capture.is_selected
                    ? 'border-primary ring-2 ring-primary/20'
                    : 'border-transparent'
                )}
              >
                {/* Image */}
                <img
                  src={capture.image_url}
                  alt={capture.detected_angle || 'Capture'}
                  className="w-full h-full object-cover"
                />

                {/* Hover overlay */}
                <div
                  className={cn(
                    'absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100',
                    'transition-opacity flex items-center justify-center gap-1'
                  )}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-white hover:bg-white/20"
                    onClick={() => setPreviewCapture(capture)}
                  >
                    <ZoomIn className="w-4 h-4" />
                  </Button>
                  {onDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-red-400 hover:bg-red-500/20"
                      onClick={() => onDelete(capture.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>

                {/* Selection checkbox */}
                {onToggleSelection && (
                  <div className="absolute top-1 left-1">
                    <Checkbox
                      checked={capture.is_selected}
                      onCheckedChange={(checked) =>
                        onToggleSelection(capture.id, checked as boolean)
                      }
                      className="bg-white/80 data-[state=checked]:bg-primary"
                    />
                  </div>
                )}

                {/* Angle label */}
                {capture.detected_angle && (
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] py-0.5 text-center truncate px-1">
                    {ANGLE_DISPLAY_NAMES[capture.detected_angle] || capture.detected_angle}
                  </div>
                )}

                {/* Auto-capture indicator */}
                {capture.is_auto_captured && (
                  <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-blue-500" title="Auto-captured" />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Preview dialog */}
      <Dialog open={!!previewCapture} onOpenChange={() => setPreviewCapture(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {previewCapture?.detected_angle
                ? ANGLE_DISPLAY_NAMES[previewCapture.detected_angle] || previewCapture.detected_angle
                : 'Capture Preview'}
            </DialogTitle>
          </DialogHeader>
          {previewCapture && (
            <div className="space-y-4">
              <img
                src={previewCapture.image_url}
                alt={previewCapture.detected_angle || 'Capture'}
                className="w-full rounded-lg"
              />
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Captured:</span>{' '}
                  {new Date(previewCapture.captured_at).toLocaleString()}
                </div>
                {previewCapture.quality_score && (
                  <div>
                    <span className="text-muted-foreground">Quality:</span>{' '}
                    {Math.round(previewCapture.quality_score * 100)}%
                  </div>
                )}
                {previewCapture.euler_angles && (
                  <>
                    <div>
                      <span className="text-muted-foreground">Yaw:</span>{' '}
                      {previewCapture.euler_angles.yaw.toFixed(1)}°
                    </div>
                    <div>
                      <span className="text-muted-foreground">Pitch:</span>{' '}
                      {previewCapture.euler_angles.pitch.toFixed(1)}°
                    </div>
                  </>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setPreviewCapture(null)}>
                  Close
                </Button>
                {onDelete && (
                  <Button
                    variant="destructive"
                    onClick={() => {
                      onDelete(previewCapture.id);
                      setPreviewCapture(null);
                    }}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
