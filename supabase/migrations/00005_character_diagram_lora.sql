-- Add source_lora_id to character_diagrams for LoRA-based generation
ALTER TABLE character_diagrams
ADD COLUMN IF NOT EXISTS source_lora_id UUID REFERENCES lora_models(id) ON DELETE SET NULL;

-- Add generation settings for LoRA-based diagrams
ALTER TABLE character_diagrams
ADD COLUMN IF NOT EXISTS outfit_description TEXT,
ADD COLUMN IF NOT EXISTS background_description TEXT,
ADD COLUMN IF NOT EXISTS pose TEXT;

-- Add index for lora lookups
CREATE INDEX IF NOT EXISTS idx_character_diagrams_lora ON character_diagrams(source_lora_id);
