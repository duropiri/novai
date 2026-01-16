-- HiRA (High Rank Adaptation) - 3D Face Identity System
-- Enables face detection, recognition, embedding storage, and 3D mesh generation
-- for accurate face training and cross-model face data reuse

-- Enable vector extension for face embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- Face Identities
-- Stores unique face profiles with embeddings and 3D geometry
-- ============================================
CREATE TABLE IF NOT EXISTS face_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,                              -- Optional display name

  -- Face embedding for recognition (512-dim InsightFace)
  embedding vector(512),                  -- Face embedding vector
  embedding_model TEXT DEFAULT 'insightface',

  -- 3D geometry from Meshy
  mesh_url TEXT,                          -- GLB file URL (Meshy output)
  mesh_thumbnail_url TEXT,                -- Preview image of 3D mesh
  depth_map_url TEXT,                     -- Primary depth map reference

  -- Extracted 3D skull geometry parameters
  skull_vectors JSONB,
  -- Structure:
  -- {
  --   "forehead_depth": 0.85,          -- Relative depth measurement
  --   "nose_projection": 1.2,          -- How far nose projects
  --   "chin_depth": 0.9,               -- Chin projection
  --   "cheekbone_width": 1.1,          -- Relative cheekbone width
  --   "jaw_angle": 125,                -- Jaw angle in degrees
  --   "eye_socket_depth": 0.3,         -- Eye socket depth
  --   "skull_shape": "mesocephalic",   -- dolichocephalic | mesocephalic | brachycephalic
  --   "face_width_to_depth_ratio": 1.2,
  --   "profile_angle": 168             -- Angle from forehead to chin in profile
  -- }

  -- Multi-angle coverage tracking
  angle_coverage JSONB,
  -- Structure:
  -- {
  --   "front": { "url": "...", "quality": 0.95, "detection_id": "..." },
  --   "profile_left": { "url": "...", "quality": 0.88, "detection_id": "..." },
  --   "profile_right": { "url": "...", "quality": 0.82, "detection_id": "..." },
  --   "quarter_left": { "url": "...", "quality": 0.91, "detection_id": "..." },
  --   "quarter_right": { "url": "...", "quality": 0.87, "detection_id": "..." }
  -- }

  -- Aggregated 2D facial geometry (from identity-analysis)
  face_geometry JSONB,
  -- Structure matches character_image_analyses.face_geometry

  -- Aggregated style fingerprint
  style_fingerprint JSONB,
  -- {
  --   "skin_tone": "#e8c4a0",
  --   "skin_undertone": "warm",
  --   "hair_color": "#3a2a1a",
  --   "hair_texture": "wavy",
  --   "hair_length": "shoulder",
  --   "eye_color": "#5a4a3a"
  -- }

  -- Source tracking
  source_type TEXT CHECK (source_type IN ('lora_training', 'character_diagram', 'reference_kit', 'manual')),
  source_id UUID,                         -- Reference to source entity

  -- Quality metrics
  image_count INTEGER DEFAULT 0,
  angle_count INTEGER DEFAULT 0,          -- Number of distinct angles captured
  confidence_score DECIMAL(5,4),          -- Overall confidence in identity
  mesh_quality_score DECIMAL(5,4),        -- Quality of 3D mesh if generated

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vector similarity search index (IVFFlat for approximate nearest neighbor)
CREATE INDEX IF NOT EXISTS face_identities_embedding_idx
  ON face_identities USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_face_identities_source ON face_identities(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_face_identities_name ON face_identities(name) WHERE name IS NOT NULL;


-- ============================================
-- Face Detections
-- Individual face detections from images with embeddings
-- ============================================
CREATE TABLE IF NOT EXISTS face_detections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source image reference
  image_url TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('lora_training', 'character_diagram', 'reference_kit')),
  source_id UUID NOT NULL,                -- ID of the LoRA model, character diagram, or reference kit

  -- Detection bounding box
  bbox JSONB NOT NULL,
  -- { "x": 100, "y": 50, "width": 200, "height": 250 }

  -- Cropped face image (for embedding and display)
  cropped_face_url TEXT,

  -- 2D facial landmarks (68-point)
  landmarks_2d JSONB,

  -- Face embedding (512-dim)
  embedding vector(512),

  -- Identity matching
  matched_identity_id UUID REFERENCES face_identities(id) ON DELETE SET NULL,
  match_confidence DECIMAL(5,4),          -- Cosine similarity score (0-1)
  is_primary BOOLEAN DEFAULT FALSE,       -- Is this the target face for training?

  -- Face quality assessment
  quality_score DECIMAL(5,4),             -- Overall face quality (0-1)
  blur_score DECIMAL(5,4),                -- Face sharpness
  occlusion_score DECIMAL(5,4),           -- How much face is visible (1 = fully visible)

  -- Angle estimation
  angle_estimate TEXT CHECK (angle_estimate IN ('front', 'profile_left', 'profile_right', 'quarter_left', 'quarter_right', 'other')),
  euler_angles JSONB,                     -- { "pitch": 0, "yaw": -45, "roll": 0 }

  -- Detection metadata
  detector_model TEXT DEFAULT 'insightface',
  detection_confidence DECIMAL(5,4),      -- Detector confidence

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS face_detections_embedding_idx
  ON face_detections USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_face_detections_source ON face_detections(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_face_detections_identity ON face_detections(matched_identity_id);
CREATE INDEX IF NOT EXISTS idx_face_detections_primary ON face_detections(source_type, source_id, is_primary) WHERE is_primary = TRUE;
CREATE INDEX IF NOT EXISTS idx_face_detections_angle ON face_detections(angle_estimate);


-- ============================================
-- Add face identity reference to lora_models
-- ============================================
ALTER TABLE lora_models
  ADD COLUMN IF NOT EXISTS primary_face_identity_id UUID REFERENCES face_identities(id) ON DELETE SET NULL;

ALTER TABLE lora_models
  ADD COLUMN IF NOT EXISTS detected_faces JSONB;
-- Structure:
-- [
--   { "detection_id": "...", "identity_id": "...", "is_primary": true, "match_confidence": 0.95 },
--   { "detection_id": "...", "identity_id": "...", "is_primary": false, "match_confidence": 0.87 }
-- ]


-- ============================================
-- Add face identity reference to character_diagrams
-- ============================================
ALTER TABLE character_diagrams
  ADD COLUMN IF NOT EXISTS primary_face_identity_id UUID REFERENCES face_identities(id) ON DELETE SET NULL;


-- ============================================
-- Add face identity reference to reference_kits
-- ============================================
ALTER TABLE reference_kits
  ADD COLUMN IF NOT EXISTS primary_face_identity_id UUID REFERENCES face_identities(id) ON DELETE SET NULL;


-- ============================================
-- Function to find similar faces by embedding
-- ============================================
CREATE OR REPLACE FUNCTION find_similar_faces(
  query_embedding vector(512),
  similarity_threshold DECIMAL DEFAULT 0.7,
  max_results INTEGER DEFAULT 10
)
RETURNS TABLE (
  identity_id UUID,
  identity_name TEXT,
  similarity DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    fi.id,
    fi.name,
    (1 - (fi.embedding <=> query_embedding))::DECIMAL AS similarity
  FROM face_identities fi
  WHERE fi.embedding IS NOT NULL
    AND (1 - (fi.embedding <=> query_embedding)) >= similarity_threshold
  ORDER BY fi.embedding <=> query_embedding
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql;


-- ============================================
-- Updated at trigger
-- ============================================
CREATE OR REPLACE FUNCTION update_face_identities_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER face_identities_updated_at
  BEFORE UPDATE ON face_identities
  FOR EACH ROW
  EXECUTE FUNCTION update_face_identities_updated_at();
