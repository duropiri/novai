export const QUEUES = {
  LORA_TRAINING: 'lora-training',
  CHARACTER_DIAGRAM: 'character-diagram',
  FACE_SWAP: 'face-swap',
  IMAGE_GENERATION: 'image-generation',
  VARIANT: 'variant',
  REFERENCE_KIT: 'reference-kit',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
