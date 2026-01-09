export const QUEUES = {
  LORA_TRAINING: 'lora-training',
  CHARACTER_DIAGRAM: 'character-diagram',
  FACE_SWAP: 'face-swap',
  VARIANT: 'variant',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
