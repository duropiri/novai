-- Add 'image_generation' to the allowed job types
-- This enables the image generation feature to create jobs

-- Drop the old constraint
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS valid_job_type;

-- Add new constraint with image_generation included
ALTER TABLE jobs ADD CONSTRAINT valid_job_type
CHECK (type IN ('lora_training', 'character_diagram', 'face_swap', 'variant', 'image_generation'));
