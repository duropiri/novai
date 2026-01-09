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
