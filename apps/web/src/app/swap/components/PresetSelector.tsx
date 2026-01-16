'use client';

import { useState, useEffect } from 'react';
import { Settings2, Save, Trash2, Check, ChevronDown, Plus, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import type { VideoStrategy } from '@/lib/api';
import type { VideoModel, UpscaleMethod, UpscaleResolution } from './index';

// Preset settings interface
export interface SwapPresetSettings {
  strategy: VideoStrategy;
  videoModel: VideoModel;
  upscaleMethod: UpscaleMethod;
  upscaleResolution: UpscaleResolution;
  keyFrameCount: number;
  keepOriginalOutfit: boolean;
}

// Full preset with metadata
export interface SwapPreset {
  id: string;
  name: string;
  description?: string;
  settings: SwapPresetSettings;
  isDefault?: boolean;
  createdAt?: string;
}

// Default presets
export const DEFAULT_PRESETS: SwapPreset[] = [
  {
    id: 'max-quality',
    name: 'Max Quality',
    description: 'Best possible output quality with all enhancements',
    isDefault: true,
    settings: {
      strategy: 'hybrid',
      videoModel: 'kling-2.6',
      upscaleMethod: 'creative',
      upscaleResolution: '4k',
      keyFrameCount: 10,
      keepOriginalOutfit: true,
    },
  },
  {
    id: 'balanced',
    name: 'Balanced',
    description: 'Good quality at reasonable cost',
    isDefault: true,
    settings: {
      strategy: 'lora_generate',
      videoModel: 'kling-2.5',
      upscaleMethod: 'real-esrgan',
      upscaleResolution: '2k',
      keyFrameCount: 7,
      keepOriginalOutfit: true,
    },
  },
  {
    id: 'fast',
    name: 'Fast & Cheap',
    description: 'Quickest processing with minimal cost',
    isDefault: true,
    settings: {
      strategy: 'face_swap',
      videoModel: 'kling',
      upscaleMethod: 'none',
      upscaleResolution: '2k',
      keyFrameCount: 5,
      keepOriginalOutfit: true,
    },
  },
  {
    id: 'video-lora',
    name: 'Video-Trained LoRA',
    description: 'Maximum identity preservation via video training',
    isDefault: true,
    settings: {
      strategy: 'video_lora',
      videoModel: 'kling-2.6',
      upscaleMethod: 'clarity',
      upscaleResolution: '4k',
      keyFrameCount: 8,
      keepOriginalOutfit: true,
    },
  },
];

const PRESETS_STORAGE_KEY = 'swap-presets-custom';

// Load custom presets from localStorage
function loadCustomPresets(): SwapPreset[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(PRESETS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

// Save custom presets to localStorage
function saveCustomPresets(presets: SwapPreset[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
}

interface PresetSelectorProps {
  currentSettings: SwapPresetSettings;
  onApplyPreset: (settings: SwapPresetSettings) => void;
}

export function PresetSelector({ currentSettings, onApplyPreset }: PresetSelectorProps) {
  const [customPresets, setCustomPresets] = useState<SwapPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [newPresetDescription, setNewPresetDescription] = useState('');
  const [editingPreset, setEditingPreset] = useState<SwapPreset | null>(null);

  // Load custom presets on mount
  useEffect(() => {
    setCustomPresets(loadCustomPresets());
  }, []);

  const allPresets = [...DEFAULT_PRESETS, ...customPresets];

  // Check if current settings match any preset
  useEffect(() => {
    const matchingPreset = allPresets.find((preset) => {
      const s = preset.settings;
      return (
        s.strategy === currentSettings.strategy &&
        s.videoModel === currentSettings.videoModel &&
        s.upscaleMethod === currentSettings.upscaleMethod &&
        s.upscaleResolution === currentSettings.upscaleResolution &&
        s.keyFrameCount === currentSettings.keyFrameCount &&
        s.keepOriginalOutfit === currentSettings.keepOriginalOutfit
      );
    });
    setSelectedPresetId(matchingPreset?.id || null);
  }, [currentSettings, allPresets]);

  const handleApplyPreset = (preset: SwapPreset) => {
    onApplyPreset(preset.settings);
    setSelectedPresetId(preset.id);
  };

  const handleSavePreset = () => {
    if (!newPresetName.trim()) return;

    const newPreset: SwapPreset = {
      id: editingPreset?.id || `custom-${Date.now()}`,
      name: newPresetName.trim(),
      description: newPresetDescription.trim() || undefined,
      settings: { ...currentSettings },
      createdAt: new Date().toISOString(),
    };

    let updatedPresets: SwapPreset[];
    if (editingPreset) {
      // Update existing preset
      updatedPresets = customPresets.map((p) => (p.id === editingPreset.id ? newPreset : p));
    } else {
      // Add new preset
      updatedPresets = [...customPresets, newPreset];
    }

    setCustomPresets(updatedPresets);
    saveCustomPresets(updatedPresets);
    setSaveDialogOpen(false);
    setNewPresetName('');
    setNewPresetDescription('');
    setEditingPreset(null);
    setSelectedPresetId(newPreset.id);
  };

  const handleDeletePreset = (presetId: string) => {
    const updatedPresets = customPresets.filter((p) => p.id !== presetId);
    setCustomPresets(updatedPresets);
    saveCustomPresets(updatedPresets);
    if (selectedPresetId === presetId) {
      setSelectedPresetId(null);
    }
  };

  const handleEditPreset = (preset: SwapPreset) => {
    setEditingPreset(preset);
    setNewPresetName(preset.name);
    setNewPresetDescription(preset.description || '');
    setSaveDialogOpen(true);
  };

  const openSaveDialog = () => {
    setEditingPreset(null);
    setNewPresetName('');
    setNewPresetDescription('');
    setSaveDialogOpen(true);
  };

  const selectedPreset = allPresets.find((p) => p.id === selectedPresetId);

  return (
    <>
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-2">
              <Settings2 className="w-4 h-4" />
              {selectedPreset ? (
                <>
                  {selectedPreset.name}
                  {selectedPreset.isDefault && (
                    <Badge variant="secondary" className="text-xs ml-1">
                      Default
                    </Badge>
                  )}
                </>
              ) : (
                'Custom Settings'
              )}
              <ChevronDown className="w-4 h-4 ml-1" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            {/* Default Presets */}
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              Default Presets
            </div>
            {DEFAULT_PRESETS.map((preset) => (
              <DropdownMenuItem
                key={preset.id}
                onClick={() => handleApplyPreset(preset)}
                className="flex items-start gap-2 cursor-pointer"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{preset.name}</span>
                    {selectedPresetId === preset.id && (
                      <Check className="w-4 h-4 text-primary" />
                    )}
                  </div>
                  {preset.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {preset.description}
                    </p>
                  )}
                </div>
              </DropdownMenuItem>
            ))}

            {/* Custom Presets */}
            {customPresets.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  Custom Presets
                </div>
                {customPresets.map((preset) => (
                  <DropdownMenuItem
                    key={preset.id}
                    className="flex items-start gap-2 cursor-pointer group"
                    onClick={() => handleApplyPreset(preset)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{preset.name}</span>
                        {selectedPresetId === preset.id && (
                          <Check className="w-4 h-4 text-primary" />
                        )}
                      </div>
                      {preset.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {preset.description}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditPreset(preset);
                        }}
                      >
                        <Pencil className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeletePreset(preset.id);
                        }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </DropdownMenuItem>
                ))}
              </>
            )}

            {/* Save Current Settings */}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={openSaveDialog} className="cursor-pointer">
              <Plus className="w-4 h-4 mr-2" />
              Save Current as Preset
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Save Preset Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingPreset ? 'Edit Preset' : 'Save as Preset'}
            </DialogTitle>
            <DialogDescription>
              {editingPreset
                ? 'Update the name and description for this preset.'
                : 'Save your current settings as a reusable preset.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="preset-name">Name</Label>
              <Input
                id="preset-name"
                placeholder="e.g., My Quality Settings"
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="preset-description">Description (optional)</Label>
              <Input
                id="preset-description"
                placeholder="e.g., Best settings for portrait videos"
                value={newPresetDescription}
                onChange={(e) => setNewPresetDescription(e.target.value)}
              />
            </div>

            {/* Preview current settings */}
            <div className="rounded-lg border p-3 bg-muted/50">
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Current Settings:
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Strategy:</span>{' '}
                  <span className="font-medium">{currentSettings.strategy}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Model:</span>{' '}
                  <span className="font-medium">{currentSettings.videoModel}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Upscale:</span>{' '}
                  <span className="font-medium">
                    {currentSettings.upscaleMethod === 'none'
                      ? 'None'
                      : `${currentSettings.upscaleMethod} (${currentSettings.upscaleResolution})`}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Key Frames:</span>{' '}
                  <span className="font-medium">{currentSettings.keyFrameCount}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Outfit:</span>{' '}
                  <span className="font-medium">
                    {currentSettings.keepOriginalOutfit ? 'Keep Original' : 'Replace'}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSavePreset} disabled={!newPresetName.trim()}>
              <Save className="w-4 h-4 mr-2" />
              {editingPreset ? 'Update Preset' : 'Save Preset'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default PresetSelector;
