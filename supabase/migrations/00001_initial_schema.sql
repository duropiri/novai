-- NOVAI Database Schema
-- Run this in your Supabase SQL Editor

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
  source_image_url TEXT NOT NULL,
  full_body_url TEXT,
  face_closeup_url TEXT,

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
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lora_models_status ON lora_models(status);
CREATE INDEX IF NOT EXISTS idx_character_diagrams_status ON character_diagrams(status);
CREATE INDEX IF NOT EXISTS idx_cost_records_job ON cost_records(job_id);
CREATE INDEX IF NOT EXISTS idx_cost_records_created ON cost_records(created_at DESC);

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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

-- Get total cost for today
CREATE OR REPLACE FUNCTION get_today_cost_cents()
RETURNS INTEGER AS $$
BEGIN
  RETURN COALESCE(
    (SELECT SUM(amount_cents) FROM cost_records WHERE DATE(created_at) = CURRENT_DATE),
    0
  );
END;
$$ LANGUAGE plpgsql;

-- Check if daily cost limit exceeded
CREATE OR REPLACE FUNCTION check_cost_limit(limit_cents INTEGER)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN get_today_cost_cents() < limit_cents;
END;
$$ LANGUAGE plpgsql;
