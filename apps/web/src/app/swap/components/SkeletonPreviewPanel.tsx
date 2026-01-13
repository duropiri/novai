'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SkeletonPreviewPanelProps {
  skeletonUrls: string[];
  progress: number;
  stage: string;
}

export function SkeletonPreviewPanel({
  skeletonUrls,
  progress,
  stage,
}: SkeletonPreviewPanelProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  const handlePrev = () => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : skeletonUrls.length - 1));
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev < skeletonUrls.length - 1 ? prev + 1 : 0));
  };

  // Parse stage for display
  const getStageLabel = (stage: string): string => {
    const stageLower = stage.toLowerCase();
    if (stageLower.includes('extract')) return 'Extracting Frames';
    if (stageLower.includes('pose') || stageLower.includes('analyz')) return 'Analyzing Poses';
    if (stageLower.includes('regenerat')) return 'Regenerating with Identity';
    if (stageLower.includes('interpolat')) return 'Interpolating Frames';
    if (stageLower.includes('video') || stageLower.includes('generat')) return 'Generating Video';
    if (stageLower.includes('upscal')) return 'Upscaling';
    if (stageLower.includes('final')) return 'Finalizing';
    return stage;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Processing
          </CardTitle>
          <Badge variant="outline">{progress}%</Badge>
        </div>
        <div className="text-sm text-muted-foreground">{getStageLabel(stage)}</div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress value={progress} className="h-2" />

        {skeletonUrls.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Motion Skeleton Preview</span>
              <span className="text-xs text-muted-foreground">
                {currentIndex + 1} / {skeletonUrls.length}
              </span>
            </div>
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
              <img
                src={skeletonUrls[currentIndex]}
                alt={`Skeleton frame ${currentIndex + 1}`}
                className="w-full h-full object-contain"
              />
              {skeletonUrls.length > 1 && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute left-1 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white"
                    onClick={handlePrev}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white"
                    onClick={handleNext}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </>
              )}
            </div>
            <div className="flex justify-center gap-1">
              {skeletonUrls.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setCurrentIndex(idx)}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    idx === currentIndex ? 'bg-primary' : 'bg-muted-foreground/30'
                  }`}
                />
              ))}
            </div>
          </div>
        )}

        {skeletonUrls.length === 0 && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            <span className="text-sm">Waiting for skeleton data...</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
