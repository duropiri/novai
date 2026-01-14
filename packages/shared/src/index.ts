// Shared types for NOVAI

export type JobStatus = 'pending' | 'queued' | 'processing' | 'completed' | 'failed';

export type JobType = 'lora_training' | 'character_diagram' | 'face_swap' | 'variant';

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  referenceId: string;
  externalRequestId?: string;
  inputPayload?: Record<string, unknown>;
  outputPayload?: Record<string, unknown>;
  errorMessage?: string;
  costCents?: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface LoraModel {
  id: string;
  name: string;
  triggerWord: string;
  status: 'pending' | 'training' | 'ready' | 'failed';
  trainingImagesUrl?: string;
  weightsUrl?: string;
  configUrl?: string;
  costCents?: number;
  createdAt: string;
}

export interface CharacterDiagram {
  id: string;
  name: string;
  sourceImageUrl: string;
  fullBodyUrl?: string;
  faceCloseupUrl?: string;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  createdAt: string;
}

export interface Video {
  id: string;
  name: string;
  type: 'source' | 'face_swapped' | 'variant';
  parentVideoId?: string;
  fileUrl: string;
  durationSeconds?: number;
  createdAt: string;
}

// API Response types
export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// Video Generation Strategy Types
export type VideoStrategy = 'face_swap' | 'lora_generate' | 'video_lora' | 'hybrid';

export type VideoModel = 'kling' | 'kling-2.5' | 'kling-2.6' | 'luma' | 'sora2pro' | 'wan';

export type UpscaleMethod = 'real-esrgan' | 'clarity' | 'creative' | 'none';

export interface VideoGenerationOptions {
  strategy: VideoStrategy;
  videoId: string;
  // Identity source (at least one required)
  uploadedFaceUrl?: string;
  characterDiagramId?: string;
  referenceKitId?: string;
  // Optional LoRA (required for lora_generate, optional for video_lora)
  loraId?: string;
  // Video generation model (used by lora_generate, video_lora, hybrid)
  videoModel: VideoModel;
  // Processing options
  keepOriginalOutfit: boolean;
  upscaleMethod: UpscaleMethod;
  upscaleResolution?: '2k' | '4k';
  // Strategy-specific options
  keyFrameCount?: number; // For video_lora: how many frames to train on (default: 10)
  refinementStrength?: number; // For hybrid: how much to refine (0-1, default: 0.5)
}

export interface VideoStrategyInfo {
  id: VideoStrategy;
  name: string;
  description: string;
  estimatedTimeMinutes: { min: number; max: number };
  estimatedCostCents: { min: number; max: number };
  quality: 'good' | 'high' | 'best';
  speed: 'fast' | 'medium' | 'slow';
  requiresLora: boolean;
}

export const VIDEO_STRATEGIES: VideoStrategyInfo[] = [
  {
    id: 'face_swap',
    name: 'Direct Face Swap',
    description: 'Fastest option. Swaps face frame-by-frame while preserving original motion.',
    estimatedTimeMinutes: { min: 2, max: 3 },
    estimatedCostCents: { min: 40, max: 60 },
    quality: 'good',
    speed: 'fast',
    requiresLora: false,
  },
  {
    id: 'lora_generate',
    name: 'LoRA Generation',
    description: 'High quality video generation using trained LoRA model with motion transfer.',
    estimatedTimeMinutes: { min: 5, max: 10 },
    estimatedCostCents: { min: 35, max: 50 },
    quality: 'high',
    speed: 'medium',
    requiresLora: true,
  },
  {
    id: 'video_lora',
    name: 'Video-Trained LoRA',
    description: 'Best quality. Trains a LoRA on video frames for maximum identity preservation.',
    estimatedTimeMinutes: { min: 15, max: 20 },
    estimatedCostCents: { min: 180, max: 250 },
    quality: 'best',
    speed: 'slow',
    requiresLora: false,
  },
  {
    id: 'hybrid',
    name: 'Hybrid (Generate + Refine)',
    description: 'High quality generation followed by face swap refinement for better identity.',
    estimatedTimeMinutes: { min: 8, max: 15 },
    estimatedCostCents: { min: 80, max: 120 },
    quality: 'high',
    speed: 'medium',
    requiresLora: true,
  },
];
