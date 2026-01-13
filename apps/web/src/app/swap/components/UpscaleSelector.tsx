'use client';

import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type UpscaleMethod = 'real-esrgan' | 'clarity' | 'creative' | 'none';
export type UpscaleResolution = '2k' | '4k';

interface UpscaleSelectorProps {
  method: UpscaleMethod;
  resolution: UpscaleResolution;
  onMethodChange: (method: UpscaleMethod) => void;
  onResolutionChange: (resolution: UpscaleResolution) => void;
}

const UPSCALE_METHODS = [
  {
    id: 'none' as const,
    name: 'None',
    description: 'No upscaling',
    cost: 0,
  },
  {
    id: 'real-esrgan' as const,
    name: 'Real-ESRGAN',
    description: 'Fast, good quality',
    cost: 5,
  },
  {
    id: 'clarity' as const,
    name: 'Clarity',
    description: 'Topaz-style quality',
    cost: 15,
  },
  {
    id: 'creative' as const,
    name: 'Creative',
    description: 'AI-enhanced details',
    cost: 20,
  },
];

export function UpscaleSelector({
  method,
  resolution,
  onMethodChange,
  onResolutionChange,
}: UpscaleSelectorProps) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-sm">Upscaling Method</Label>
        <div className="grid grid-cols-2 gap-2 mt-1.5">
          {UPSCALE_METHODS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onMethodChange(m.id)}
              className={`p-2 rounded-lg border text-left transition-all ${
                method === m.id
                  ? 'border-primary bg-primary/5'
                  : 'border-muted hover:border-muted-foreground/50'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{m.name}</span>
                {m.cost > 0 && (
                  <span className="text-xs text-muted-foreground">
                    +${(m.cost / 100).toFixed(2)}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{m.description}</p>
            </button>
          ))}
        </div>
      </div>

      {method !== 'none' && (
        <div>
          <Label className="text-sm">Resolution</Label>
          <Select value={resolution} onValueChange={(v) => onResolutionChange(v as UpscaleResolution)}>
            <SelectTrigger className="mt-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2k">
                <div className="flex items-center gap-2">
                  <span>2K (1920x1080)</span>
                  <Badge variant="outline" className="text-xs">Standard</Badge>
                </div>
              </SelectItem>
              <SelectItem value="4k">
                <div className="flex items-center gap-2">
                  <span>4K (3840x2160)</span>
                  <Badge variant="secondary" className="text-xs">Ultra</Badge>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

// Helper to get upscale cost in cents
export function getUpscaleCost(method: UpscaleMethod): number {
  return UPSCALE_METHODS.find((m) => m.id === method)?.cost || 0;
}
