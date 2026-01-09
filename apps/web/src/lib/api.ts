const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// Custom API error with additional context
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public endpoint: string,
    public details?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Parse error response and extract meaningful message
async function parseErrorResponse(response: Response): Promise<string> {
  try {
    const text = await response.text();
    try {
      const json = JSON.parse(text);
      return json.message || json.error || text;
    } catch {
      return text || `HTTP error ${response.status}`;
    }
  } catch {
    return `HTTP error ${response.status}`;
  }
}

// User-friendly error messages by status code
function getErrorMessage(statusCode: number, details: string): string {
  switch (statusCode) {
    case 400:
      return details || 'Invalid request. Please check your input.';
    case 401:
      return 'Authentication required. Please log in.';
    case 403:
      return 'You do not have permission to perform this action.';
    case 404:
      return details || 'The requested resource was not found.';
    case 409:
      return details || 'A conflict occurred with the current state.';
    case 413:
      return 'The file is too large. Please use a smaller file.';
    case 429:
      return 'Too many requests. Please wait a moment and try again.';
    case 500:
      return 'Server error. Please try again later.';
    case 502:
    case 503:
    case 504:
      return 'Service temporarily unavailable. Please try again later.';
    default:
      return details || `An error occurred (${statusCode})`;
  }
}

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const details = await parseErrorResponse(response);
      const message = getErrorMessage(response.status, details);
      throw new ApiError(message, response.status, endpoint, details);
    }

    return response.json();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    // Handle network errors
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      throw new ApiError(
        'Unable to connect to the server. Please check your connection.',
        0,
        endpoint,
        'Network error'
      );
    }
    throw error;
  }
}

// LoRA API
export interface LoraModel {
  id: string;
  name: string;
  trigger_word: string;
  status: 'pending' | 'training' | 'ready' | 'failed';
  training_images_url: string | null;
  training_steps: number;
  weights_url: string | null;
  config_url: string | null;
  thumbnail_url: string | null;
  cost_cents: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface CreateLoraRequest {
  name: string;
  triggerWord: string;
  imagesZipUrl: string;
  steps?: number;
}

export interface UploadLoraRequest {
  file: File;
  name: string;
  triggerWord: string;
  thumbnail?: File;
}

export const loraApi = {
  list: (status?: string) =>
    fetchApi<LoraModel[]>(`/lora${status ? `?status=${status}` : ''}`),

  get: (id: string) => fetchApi<LoraModel>(`/lora/${id}`),

  create: (data: CreateLoraRequest) =>
    fetchApi<LoraModel>('/lora', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  upload: async (data: UploadLoraRequest): Promise<LoraModel> => {
    const formData = new FormData();
    formData.append('file', data.file);
    formData.append('name', data.name);
    formData.append('triggerWord', data.triggerWord);
    if (data.thumbnail) {
      formData.append('thumbnail', data.thumbnail);
    }

    const response = await fetch(`${API_BASE_URL}/lora/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || 'Failed to upload LoRA');
    }

    return response.json();
  },

  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/lora/${id}`, {
      method: 'DELETE',
    }),
};

// Files API
export interface FileMetadata {
  id: string;
  bucket: string;
  path: string;
  url: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

// Bucket name mapping (frontend uses these keys)
const BUCKET_MAP: Record<string, string> = {
  'training-images': 'TRAINING_IMAGES',
  'lora-weights': 'LORA_WEIGHTS',
  'character-images': 'CHARACTER_IMAGES',
  'source-videos': 'SOURCE_VIDEOS',
  'processed-videos': 'PROCESSED_VIDEOS',
  'variant-videos': 'VARIANT_VIDEOS',
  'audio': 'AUDIO',
};

export const filesApi = {
  uploadFile: async (file: File, bucket: string): Promise<FileMetadata> => {
    const bucketKey = BUCKET_MAP[bucket] || bucket;
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE_URL}/files/upload/${bucketKey}`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || 'Failed to upload file');
    }

    return response.json();
  },

  uploadFiles: async (files: File[], bucket: string): Promise<FileMetadata[]> => {
    const uploads = files.map((file) => filesApi.uploadFile(file, bucket));
    return Promise.all(uploads);
  },
};

// Character Diagrams API
export interface CharacterDiagram {
  id: string;
  name: string;
  source_image_url: string | null;
  file_url: string | null;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  error_message: string | null;
  cost_cents: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCharacterDiagramRequest {
  name?: string;
  sourceImageUrl: string;
}

export const characterApi = {
  list: (status?: string) =>
    fetchApi<CharacterDiagram[]>(`/characters${status ? `?status=${status}` : ''}`),

  get: (id: string) => fetchApi<CharacterDiagram>(`/characters/${id}`),

  create: (data: CreateCharacterDiagramRequest) =>
    fetchApi<CharacterDiagram>('/characters', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/characters/${id}`, {
      method: 'DELETE',
    }),
};

// Collections API
export interface Collection {
  id: string;
  name: string;
  type: 'video' | 'audio';
  itemCount: number;
  totalDurationSeconds: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCollectionRequest {
  name: string;
  type: 'video' | 'audio';
}

export const collectionsApi = {
  list: (type?: 'video' | 'audio') =>
    fetchApi<Collection[]>(`/collections${type ? `?type=${type}` : ''}`),

  get: (id: string) => fetchApi<Collection>(`/collections/${id}`),

  create: (data: CreateCollectionRequest) =>
    fetchApi<Collection>('/collections', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, name: string) =>
    fetchApi<Collection>(`/collections/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/collections/${id}`, {
      method: 'DELETE',
    }),

  getVideos: (collectionId: string) =>
    fetchApi<Video[]>(`/collections/${collectionId}/videos`),

  getAudioFiles: (collectionId: string) =>
    fetchApi<AudioFile[]>(`/collections/${collectionId}/audio`),
};

// Videos API
export interface Video {
  id: string;
  name: string;
  type: 'source' | 'face_swapped' | 'variant';
  collection_id: string | null;
  parent_video_id: string | null;
  character_diagram_id: string | null;
  file_url: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  file_size_bytes: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateVideoRequest {
  name: string;
  collectionId: string;
  fileUrl: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  fileSizeBytes?: number;
}

export const videosApi = {
  list: (options?: { type?: string; collectionId?: string }) => {
    const params = new URLSearchParams();
    if (options?.type) params.append('type', options.type);
    if (options?.collectionId) params.append('collectionId', options.collectionId);
    const query = params.toString();
    return fetchApi<Video[]>(`/videos${query ? `?${query}` : ''}`);
  },

  get: (id: string) => fetchApi<Video>(`/videos/${id}`),

  create: (data: CreateVideoRequest) =>
    fetchApi<Video>('/videos', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: { name?: string; collectionId?: string }) =>
    fetchApi<Video>(`/videos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/videos/${id}`, {
      method: 'DELETE',
    }),
};

// Audio Files API
export interface AudioFile {
  id: string;
  name: string;
  collection_id: string | null;
  file_url: string;
  duration_seconds: number | null;
  file_size_bytes: number | null;
  created_at: string;
}

export interface CreateAudioFileRequest {
  name: string;
  collectionId: string;
  fileUrl: string;
  durationSeconds?: number;
  fileSizeBytes?: number;
}

export const audioApi = {
  list: (collectionId?: string) => {
    const params = collectionId ? `?collectionId=${collectionId}` : '';
    return fetchApi<AudioFile[]>(`/audio${params}`);
  },

  get: (id: string) => fetchApi<AudioFile>(`/audio/${id}`),

  create: (data: CreateAudioFileRequest) =>
    fetchApi<AudioFile>('/audio', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: { name?: string; collectionId?: string }) =>
    fetchApi<AudioFile>(`/audio/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/audio/${id}`, {
      method: 'DELETE',
    }),
};

// Hooks API
export interface Hook {
  id: string;
  text: string;
  category: string | null;
  created_at: string;
}

export interface CreateHookRequest {
  text: string;
  category?: string;
}

export const hooksApi = {
  list: (category?: string) => {
    const params = category ? `?category=${category}` : '';
    return fetchApi<Hook[]>(`/hooks${params}`);
  },

  get: (id: string) => fetchApi<Hook>(`/hooks/${id}`),

  create: (data: CreateHookRequest) =>
    fetchApi<Hook>('/hooks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  createBulk: (hooks: CreateHookRequest[]) =>
    fetchApi<{ created: number; hooks: Hook[] }>('/hooks/bulk', {
      method: 'POST',
      body: JSON.stringify({ hooks }),
    }),

  update: (id: string, data: { text?: string; category?: string }) =>
    fetchApi<Hook>(`/hooks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/hooks/${id}`, {
      method: 'DELETE',
    }),

  getCategories: () => fetchApi<string[]>('/hooks/categories'),
};

// Jobs API
export interface Job {
  id: string;
  type: 'lora_training' | 'character_diagram' | 'face_swap' | 'variant';
  reference_id: string;
  status: 'pending' | 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  external_request_id: string | null;
  external_status: string | null;
  input_payload: Record<string, unknown> | null;
  output_payload: Record<string, unknown> | null;
  error_message: string | null;
  cost_cents: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export const jobsApi = {
  list: (type?: string, limit?: number) => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (limit) params.set('limit', limit.toString());
    const query = params.toString();
    return fetchApi<Job[]>(`/jobs${query ? `?${query}` : ''}`);
  },

  get: (id: string) => fetchApi<Job>(`/jobs/${id}`),
};

// Face Swap API
export interface FaceSwapResult {
  success: boolean;
  jobId: string;
  videoId: string;
  characterDiagramId: string;
  estimatedCostCents: number;
}

export interface CreateFaceSwapRequest {
  videoId: string;
  characterDiagramId: string;
}

export const swapApi = {
  create: (data: CreateFaceSwapRequest) =>
    fetchApi<FaceSwapResult>('/swap', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getResult: (jobId: string) => fetchApi<Video>(`/swap/results/${jobId}`),

  getHistory: () => fetchApi<Video[]>('/swap/history'),
};

// Variants API
export interface VariantBatchResult {
  batchId: string;
  totalVariants: number;
  estimatedProcessingMinutes: number;
}

export interface VariantBatchStatus {
  total: number;
  completed: number;
  failed: number;
  processing: number;
  pending: number;
}

export interface CreateVariantBatchRequest {
  videoCollectionIds: string[];
  audioCollectionIds?: string[];
  hookIds?: string[];
  hookDuration?: number;
  hookPosition?: 'top' | 'center' | 'bottom';
}

export interface VariantBatchInfo {
  batchId: string;
  createdAt: string;
  expiresAt: string;
  zipUrl?: string;
  totalVariants: number;
}

export interface VariantBatchZipResult {
  zipUrl: string;
  expiresAt: string;
}

export const variantsApi = {
  createBatch: (data: CreateVariantBatchRequest) =>
    fetchApi<VariantBatchResult>('/variants', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getBatchStatus: (batchId: string) =>
    fetchApi<VariantBatchStatus>(`/variants/batch/${batchId}/status`),

  getBatchResults: (batchId: string) =>
    fetchApi<Video[]>(`/variants/batch/${batchId}/results`),

  getBatchInfo: (batchId: string) =>
    fetchApi<VariantBatchInfo>(`/variants/batch/${batchId}/info`),

  createBatchZip: (batchId: string) =>
    fetchApi<VariantBatchZipResult>(`/variants/batch/${batchId}/zip`, {
      method: 'POST',
    }),
};

// Stats/Dashboard API
export interface DashboardStats {
  storage: {
    videos: { count: number; totalSizeBytes: number };
    audio: { count: number; totalSizeBytes: number };
    loraModels: { count: number };
    characterDiagrams: { count: number };
    hooks: { count: number };
    collections: { video: number; audio: number };
  };
  costs: {
    today: number;
    thisMonth: number;
    byType: Record<string, number>;
  };
  jobs: {
    active: number;
    completedToday: number;
    failedToday: number;
  };
}

export const statsApi = {
  getDashboardStats: () => fetchApi<DashboardStats>('/stats'),

  getActiveJobs: () => fetchApi<Job[]>('/stats/jobs/active'),

  getRecentJobs: (limit = 10) => fetchApi<Job[]>(`/stats/jobs/recent?limit=${limit}`),
};

// Settings API
export interface Setting {
  id: string;
  key: string;
  value: string | null;
  is_secret: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface SettingUpdate {
  key: string;
  value: string;
}

export interface ApiKeyTestResult {
  valid: boolean;
  message: string;
}

export const settingsApi = {
  getAll: () => fetchApi<Setting[]>('/settings'),

  get: (key: string) => fetchApi<Setting>(`/settings/${key}`),

  update: (key: string, value: string) =>
    fetchApi<Setting>(`/settings/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),

  updateMultiple: (settings: SettingUpdate[]) =>
    fetchApi<Setting[]>('/settings', {
      method: 'PUT',
      body: JSON.stringify({ settings }),
    }),

  testApiKey: (key: string) =>
    fetchApi<ApiKeyTestResult>(`/settings/${key}/test`, {
      method: 'POST',
    }),
};
