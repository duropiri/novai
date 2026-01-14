-- Migration: Add WAN 2.2 Image Trainer columns to lora_models
-- The high_noise_lora is the PRIMARY LoRA for inference
-- diffusers_lora and config are stored as reference links only

-- Add lora_url column (HIGH NOISE LoRA - primary for inference)
ALTER TABLE lora_models ADD COLUMN IF NOT EXISTS lora_url TEXT;

-- Add diffusers_lora_url column (reference link only)
ALTER TABLE lora_models ADD COLUMN IF NOT EXISTS diffusers_lora_url TEXT;

-- Add config_url column (reference link only)
ALTER TABLE lora_models ADD COLUMN IF NOT EXISTS config_url TEXT;

-- Add trainer column to track which trainer was used
ALTER TABLE lora_models ADD COLUMN IF NOT EXISTS trainer VARCHAR(50) DEFAULT 'flux-fast';

-- Add learning_rate column for WAN 2.2 training
ALTER TABLE lora_models ADD COLUMN IF NOT EXISTS learning_rate FLOAT DEFAULT 0.0007;

-- Add is_style column to distinguish style vs character training
ALTER TABLE lora_models ADD COLUMN IF NOT EXISTS is_style BOOLEAN DEFAULT FALSE;

-- Add progress column for real-time training progress
ALTER TABLE lora_models ADD COLUMN IF NOT EXISTS progress INTEGER;

-- Add status_message column for detailed status updates
ALTER TABLE lora_models ADD COLUMN IF NOT EXISTS status_message TEXT;

-- Migrate existing data: copy weights_url to lora_url for existing models
-- This ensures backward compatibility
UPDATE lora_models
SET lora_url = weights_url
WHERE lora_url IS NULL AND weights_url IS NOT NULL;

-- Add comment explaining the column usage
COMMENT ON COLUMN lora_models.lora_url IS 'Primary LoRA file for inference (high_noise_lora from WAN 2.2 trainer)';
COMMENT ON COLUMN lora_models.weights_url IS 'DEPRECATED: Use lora_url instead. Kept for backward compatibility.';
COMMENT ON COLUMN lora_models.diffusers_lora_url IS 'Reference link to diffusers-format LoRA (not used for inference)';
COMMENT ON COLUMN lora_models.trainer IS 'Training method: flux-fast (legacy), wan-22 (new), manual (uploaded), imported (from URL)';
