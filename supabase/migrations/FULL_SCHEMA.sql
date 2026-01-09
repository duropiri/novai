-- ============================================
-- NOVAI FULL DATABASE SCHEMA
-- ============================================
-- Run this entire file in Supabase SQL Editor
-- This combines all migrations into one file
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- LORA MODELS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS lora_models (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  trigger_word VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',

  -- Training inputs
  training_images_url TEXT,
  training_steps INTEGER DEFAULT 1000,

  -- Training outputs
  weights_url TEXT,
  config_url TEXT,
  thumbnail_url TEXT,

  -- Metadata
  cost_cents INTEGER,
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  -- Constraints
  CONSTRAINT valid_status CHECK (status IN ('pending', 'training', 'ready', 'failed'))
);

-- ============================================
-- CHARACTER DIAGRAMS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS character_diagrams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,

  -- Source and generated images
  source_image_url TEXT,
  file_url TEXT,

  -- Status
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  error_message TEXT,
  cost_cents INTEGER,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT valid_diagram_status CHECK (status IN ('pending', 'processing', 'ready', 'failed'))
);

-- ============================================
-- JOBS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Job type and reference
  type VARCHAR(50) NOT NULL,
  reference_id UUID NOT NULL,

  -- Status tracking
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  progress INTEGER DEFAULT 0,

  -- External API tracking
  external_request_id TEXT,
  external_status TEXT,

  -- Payload data
  input_payload JSONB,
  output_payload JSONB,
  error_message TEXT,

  -- Cost tracking
  cost_cents INTEGER DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Constraints
  CONSTRAINT valid_job_type CHECK (type IN ('lora_training', 'character_diagram', 'face_swap', 'variant')),
  CONSTRAINT valid_job_status CHECK (status IN ('pending', 'queued', 'processing', 'completed', 'failed')),
  CONSTRAINT valid_progress CHECK (progress >= 0 AND progress <= 100)
);

-- ============================================
-- COST TRACKING TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS cost_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  job_type VARCHAR(50) NOT NULL,
  amount_cents INTEGER NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- SETTINGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key VARCHAR(100) NOT NULL UNIQUE,
  value TEXT,
  is_secret BOOLEAN DEFAULT false,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default settings (API keys start empty)
INSERT INTO settings (key, value, is_secret, description) VALUES
  ('GOOGLE_GEMINI_API_KEY', '', true, 'Google Gemini API key for character diagram generation'),
  ('FAL_API_KEY', '', true, 'fal.ai API key for LoRA training and face swap video generation'),
  ('DAILY_COST_LIMIT_CENTS', '5000', false, 'Daily spending limit in cents (default $50)'),
  ('LORA_TRAINING_COST_CENTS', '200', false, 'Cost per LoRA training job in cents (default $2)'),
  ('CHARACTER_DIAGRAM_COST_CENTS', '2', false, 'Cost per character diagram in cents (default $0.02)'),
  ('FACE_SWAP_COST_PER_SECOND_CENTS', '2', false, 'Cost per second of video for face swap in cents')
ON CONFLICT (key) DO NOTHING;

-- ============================================
-- COLLECTIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('video', 'audio')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- VIDEOS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'source' CHECK (type IN ('source', 'face_swapped', 'variant')),
  collection_id UUID REFERENCES collections(id) ON DELETE SET NULL,
  parent_video_id UUID REFERENCES videos(id) ON DELETE SET NULL,
  character_diagram_id UUID REFERENCES character_diagrams(id) ON DELETE SET NULL,
  file_url TEXT NOT NULL,
  thumbnail_url TEXT,
  duration_seconds DECIMAL(10, 2),
  width INTEGER,
  height INTEGER,
  file_size_bytes BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- AUDIO FILES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS audio_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  collection_id UUID REFERENCES collections(id) ON DELETE SET NULL,
  file_url TEXT NOT NULL,
  duration_seconds DECIMAL(10, 2),
  file_size_bytes BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- HOOKS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS hooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  text TEXT NOT NULL,
  category VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lora_models_status ON lora_models(status);
CREATE INDEX IF NOT EXISTS idx_character_diagrams_status ON character_diagrams(status);
CREATE INDEX IF NOT EXISTS idx_cost_records_job ON cost_records(job_id);
CREATE INDEX IF NOT EXISTS idx_cost_records_created ON cost_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);
CREATE INDEX IF NOT EXISTS idx_collections_type ON collections(type);
CREATE INDEX IF NOT EXISTS idx_videos_collection ON videos(collection_id);
CREATE INDEX IF NOT EXISTS idx_videos_type ON videos(type);
CREATE INDEX IF NOT EXISTS idx_videos_parent ON videos(parent_video_id);
CREATE INDEX IF NOT EXISTS idx_audio_collection ON audio_files(collection_id);

-- ============================================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers to all tables with updated_at
DROP TRIGGER IF EXISTS update_lora_models_updated_at ON lora_models;
CREATE TRIGGER update_lora_models_updated_at
  BEFORE UPDATE ON lora_models
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_character_diagrams_updated_at ON character_diagrams;
CREATE TRIGGER update_character_diagrams_updated_at
  BEFORE UPDATE ON character_diagrams
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_settings_updated_at ON settings;
CREATE TRIGGER update_settings_updated_at
  BEFORE UPDATE ON settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_collections_updated_at ON collections;
CREATE TRIGGER update_collections_updated_at
  BEFORE UPDATE ON collections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_videos_updated_at ON videos;
CREATE TRIGGER update_videos_updated_at
  BEFORE UPDATE ON videos
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- VIEWS FOR DASHBOARD
-- ============================================
CREATE OR REPLACE VIEW daily_costs AS
SELECT
  DATE(created_at) as date,
  job_type,
  SUM(amount_cents) as total_cents,
  COUNT(*) as job_count
FROM cost_records
GROUP BY DATE(created_at), job_type
ORDER BY date DESC;

CREATE OR REPLACE VIEW monthly_costs AS
SELECT
  DATE_TRUNC('month', created_at) as month,
  job_type,
  SUM(amount_cents) as total_cents,
  COUNT(*) as job_count
FROM cost_records
GROUP BY DATE_TRUNC('month', created_at), job_type
ORDER BY month DESC;

-- ============================================
-- HELPER FUNCTIONS
-- ============================================
CREATE OR REPLACE FUNCTION get_today_cost_cents()
RETURNS INTEGER AS $$
BEGIN
  RETURN COALESCE(
    (SELECT SUM(amount_cents) FROM cost_records WHERE DATE(created_at) = CURRENT_DATE),
    0
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION check_cost_limit(limit_cents INTEGER)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN get_today_cost_cents() < limit_cents;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- STORAGE BUCKETS
-- ============================================
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('training-images', 'training-images', false),
  ('lora-weights', 'lora-weights', false),
  ('character-images', 'character-images', true),
  ('variant-videos', 'variant-videos', true),
  ('source-videos', 'source-videos', false),
  ('processed-videos', 'processed-videos', true),
  ('audio', 'audio', false)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- STORAGE POLICIES
-- ============================================

-- Training Images (private)
DROP POLICY IF EXISTS "Service role can manage training-images" ON storage.objects;
CREATE POLICY "Service role can manage training-images"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'training-images')
WITH CHECK (bucket_id = 'training-images');

-- LoRA Weights (private)
DROP POLICY IF EXISTS "Service role can manage lora-weights" ON storage.objects;
CREATE POLICY "Service role can manage lora-weights"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'lora-weights')
WITH CHECK (bucket_id = 'lora-weights');

-- Character Images (public read)
DROP POLICY IF EXISTS "Public can view character-images" ON storage.objects;
CREATE POLICY "Public can view character-images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'character-images');

DROP POLICY IF EXISTS "Service role can manage character-images" ON storage.objects;
CREATE POLICY "Service role can manage character-images"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'character-images')
WITH CHECK (bucket_id = 'character-images');

-- Source Videos (private)
DROP POLICY IF EXISTS "Service role can manage source-videos" ON storage.objects;
CREATE POLICY "Service role can manage source-videos"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'source-videos')
WITH CHECK (bucket_id = 'source-videos');

-- Processed Videos (public read)
DROP POLICY IF EXISTS "Anyone can read processed-videos" ON storage.objects;
CREATE POLICY "Anyone can read processed-videos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'processed-videos');

DROP POLICY IF EXISTS "Service role can manage processed-videos" ON storage.objects;
CREATE POLICY "Service role can manage processed-videos"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'processed-videos')
WITH CHECK (bucket_id = 'processed-videos');

-- Variant Videos (public read)
DROP POLICY IF EXISTS "Public can view variant-videos" ON storage.objects;
CREATE POLICY "Public can view variant-videos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'variant-videos');

DROP POLICY IF EXISTS "Service role can manage variant-videos" ON storage.objects;
CREATE POLICY "Service role can manage variant-videos"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'variant-videos')
WITH CHECK (bucket_id = 'variant-videos');

-- Audio (private)
DROP POLICY IF EXISTS "Service role can manage audio" ON storage.objects;
CREATE POLICY "Service role can manage audio"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'audio')
WITH CHECK (bucket_id = 'audio');
