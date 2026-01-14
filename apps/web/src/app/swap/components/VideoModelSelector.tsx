'use client';

import { Badge } from '@/components/ui/badge';

export type VideoModel = 'kling' | 'kling-2.5' | 'kling-2.6' | 'luma' | 'sora2pro' | 'wan';

interface VideoModelSelectorProps {
  selected: VideoModel;
  onSelect: (model: VideoModel) => void;
}

const VIDEO_MODELS = [
  {
    id: 'kling' as const,
    name: 'Kling 1.6',
    description: 'Best motion control, reliable',
    cost: 8, // cents - direct API pricing
    badge: 'Recommended',
    badgeVariant: 'default' as const,
  },
  {
    id: 'kling-2.5' as const,
    name: 'Kling 2.5',
    description: 'Higher quality, cinematic',
    cost: 12, // cents
    badge: 'New',
    badgeVariant: 'outline' as const,
  },
  {
    id: 'kling-2.6' as const,
    name: 'Kling 2.6',
    description: 'Generates video WITH audio!',
    cost: 20, // cents
    badge: 'Audio',
    badgeVariant: 'secondary' as const,
  },
  {
    id: 'sora2pro' as const,
    name: 'Sora 2 Pro',
    description: 'Highest quality OpenAI',
    cost: 100, // cents
    badge: 'Premium',
    badgeVariant: 'secondary' as const,
  },
  {
    id: 'wan' as const,
    name: 'WAN',
    description: 'Quick previews',
    cost: 5, // cents
    badge: 'Fast',
    badgeVariant: 'outline' as const,
  },
  {
    id: 'luma' as const,
    name: 'Luma',
    description: 'Premium cinematic',
    cost: 100, // cents
    badge: 'Premium',
    badgeVariant: 'secondary' as const,
  },
];

export function VideoModelSelector({ selected, onSelect }: VideoModelSelectorProps) {
  return (
    <div className="grid grid-cols-3 gap-2">
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
          <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
            {model.description}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            ${(model.cost / 100).toFixed(2)}/5s
          </div>
          <Badge
            variant={model.badgeVariant}
            className={`mt-1.5 text-xs ${
              model.badgeVariant === 'default'
                ? 'bg-green-500/10 text-green-600 border-green-500/20'
                : model.badge === 'Audio'
                ? 'bg-purple-500/10 text-purple-600 border-purple-500/20'
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
  return VIDEO_MODELS.find((m) => m.id === model)?.cost || 8;
}
