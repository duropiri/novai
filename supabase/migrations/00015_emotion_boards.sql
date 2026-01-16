-- Emotion Boards table for face expression grid generation
CREATE TABLE emotion_boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'ready', 'failed')),

  -- Identity source (one of these will be set based on source_type)
  source_type TEXT NOT NULL CHECK (source_type IN ('image', 'lora', 'video', 'zip', 'character', 'reference_kit')),
  source_image_url TEXT,          -- Direct image URL (for image/video/zip sources)
  lora_id UUID REFERENCES lora_models(id) ON DELETE SET NULL,
  character_diagram_id UUID REFERENCES character_diagrams(id) ON DELETE SET NULL,
  reference_kit_id UUID REFERENCES reference_kits(id) ON DELETE SET NULL,

  -- Configuration
  grid_size TEXT DEFAULT '2x4' CHECK (grid_size IN ('2x4', '2x8')),
  emotions JSONB DEFAULT '[]'::jsonb,  -- Array of emotion names used

  -- Output
  board_url TEXT,                 -- Final composite grid image URL
  cell_urls JSONB,                -- { emotion: url } for individual cell images

  -- Tracking
  progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  error_message TEXT,
  cost_cents INTEGER,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Index for listing boards by status
CREATE INDEX emotion_boards_status_idx ON emotion_boards(status);

-- Index for listing boards by creation date
CREATE INDEX emotion_boards_created_at_idx ON emotion_boards(created_at DESC);
