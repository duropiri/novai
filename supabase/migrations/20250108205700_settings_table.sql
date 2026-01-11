-- NOVAI Settings Table
-- Run this in your Supabase SQL Editor after 00001_initial_schema.sql

-- ============================================
-- SETTINGS TABLE
-- ============================================
-- Stores application settings including API keys
-- Keys are stored encrypted in production (Supabase handles this)

CREATE TABLE IF NOT EXISTS settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key VARCHAR(100) NOT NULL UNIQUE,
  value TEXT,
  is_secret BOOLEAN DEFAULT false,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add updated_at trigger
DROP TRIGGER IF EXISTS update_settings_updated_at ON settings;
CREATE TRIGGER update_settings_updated_at
  BEFORE UPDATE ON settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Insert default settings (API keys start empty)
INSERT INTO settings (key, value, is_secret, description) VALUES
  ('GOOGLE_GEMINI_API_KEY', '', true, 'Google Gemini API key for character diagram generation'),
  ('FAL_API_KEY', '', true, 'fal.ai API key for LoRA training and face swap video generation'),
  ('DAILY_COST_LIMIT_CENTS', '5000', false, 'Daily spending limit in cents (default $50)'),
  ('LORA_TRAINING_COST_CENTS', '200', false, 'Cost per LoRA training job in cents (default $2)'),
  ('CHARACTER_DIAGRAM_COST_CENTS', '2', false, 'Cost per character diagram in cents (default $0.02)'),
  ('FACE_SWAP_COST_PER_SECOND_CENTS', '2', false, 'Cost per second of video for face swap in cents')
ON CONFLICT (key) DO NOTHING;

-- Create index for fast key lookup
CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);
