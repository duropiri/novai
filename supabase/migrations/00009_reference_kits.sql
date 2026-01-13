-- Reference Kits table for identity-preserving image generation
-- Alternative to LoRA training using multi-reference approach

CREATE TABLE IF NOT EXISTS reference_kits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,

  -- Source image
  source_image_url TEXT NOT NULL,

  -- Core references (required for kit to be "ready")
  anchor_face_url TEXT,           -- Clean, neutral, front-facing passport-style
  profile_url TEXT,               -- 3/4 profile view

  -- Extended references (optional)
  half_body_url TEXT,             -- Waist up with body proportions
  full_body_url TEXT,             -- Head to toe standing portrait

  -- Expression variants (JSONB for flexibility)
  -- Format: {"smile": "url", "serious": "url", "surprised": "url", "angry": "url"}
  expressions JSONB DEFAULT '{}',

  -- Status tracking
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'ready', 'failed')),

  -- Per-reference progress tracking
  -- Format: {"anchor": "done", "profile": "generating", "half_body": "pending", ...}
  generation_progress JSONB DEFAULT '{}',

  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_reference_kits_created_at ON reference_kits(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reference_kits_status ON reference_kits(status);

-- Trigger to update updated_at on changes
CREATE OR REPLACE FUNCTION update_reference_kits_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_reference_kits_updated_at ON reference_kits;
CREATE TRIGGER trigger_reference_kits_updated_at
  BEFORE UPDATE ON reference_kits
  FOR EACH ROW
  EXECUTE FUNCTION update_reference_kits_updated_at();
