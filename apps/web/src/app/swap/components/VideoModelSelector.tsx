'use client';

import { Badge } from '@/components/ui/badge';

export type VideoModel = 'kling' | 'luma' | 'sora2pro' | 'wan';

interface VideoModelSelectorProps {
  selected: VideoModel;
  onSelect: (model: VideoModel) => void;
}

const VIDEO_MODELS = [
  {
    id: 'kling' as const,
    name: 'Kling v2.6',
    description: 'Best balance of quality and cost',
    cost: 40, // cents
    badge: 'Recommended',
    badgeVariant: 'default' as const,
  },
  {
    id: 'luma' as const,
    name: 'Luma',
    description: 'Premium cinematic quality',
    cost: 100, // cents
    badge: 'Premium',
    badgeVariant: 'secondary' as const,
  },
  {
    id: 'sora2pro' as const,
    name: 'Sora 2 Pro',
    description: 'Highest quality, best realism',
    cost: 100, // cents
    badge: 'Premium',
    badgeVariant: 'secondary' as const,
  },
  {
    id: 'wan' as const,
    name: 'WAN v2.2',
    description: 'Fastest generation',
    cost: 20, // cents
    badge: 'Fast',
    badgeVariant: 'outline' as const,
  },
];

export function VideoModelSelector({ selected, onSelect }: VideoModelSelectorProps) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {VIDEO_MODELS.map((model) => (
        <button
          key={model.id}
          type="button"
          onClick={() => onSelect(model.id)}
          className={`p-3 rounded-lg border-2 text-center transition-all ${
            selected === model.id
              ? 'border-primary bg-primary/5'
              : 'border-muted hover:border-muted-foreground/50'
          }`}
        >
          <div className="font-medium text-sm">{model.name}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            ${(model.cost / 100).toFixed(2)}
          </div>
          <Badge
            variant={model.badgeVariant}
            className={`mt-1.5 text-xs ${
              model.badgeVariant === 'default'
                ? 'bg-green-500/10 text-green-600 border-green-500/20'
                : ''
            }`}
          >
            {model.badge}
          </Badge>
        </button>
      ))}
    </div>
  );
}

// Helper to get model cost in cents
export function getVideoModelCost(model: VideoModel): number {
  return VIDEO_MODELS.find((m) => m.id === model)?.cost || 40;
}
