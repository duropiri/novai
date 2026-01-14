-- Character Identity Profiles - Studio Reverse Engineering Engine
-- Stores comprehensive identity metadata extracted from input images
-- Enables consistent AI avatar generation through mathematical constraints

-- ============================================
-- Character Analysis Sessions
-- Tracks batch analysis jobs for multiple images
-- ============================================
CREATE TABLE IF NOT EXISTS character_analysis_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Links to existing entities (one must be set)
  character_diagram_id UUID REFERENCES character_diagrams(id) ON DELETE CASCADE,
  reference_kit_id UUID REFERENCES reference_kits(id) ON DELETE CASCADE,

  -- Session metadata
  name VARCHAR(255),
  status VARCHAR(50) DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'analyzing', 'aggregating', 'ready', 'failed')),

  -- Progress tracking
  total_images INTEGER DEFAULT 0,
  processed_images INTEGER DEFAULT 0,
  valid_images INTEGER DEFAULT 0,
  progress INTEGER DEFAULT 0,

  -- Analysis configuration
  analysis_mode VARCHAR(20) DEFAULT 'standard' CHECK (analysis_mode IN ('quick', 'standard', 'comprehensive')),
  cost_limit_cents INTEGER DEFAULT 2000,

  -- Error handling
  error_message TEXT,

  -- Cost tracking
  total_cost_cents INTEGER DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_analysis_sessions_diagram ON character_analysis_sessions(character_diagram_id);
CREATE INDEX IF NOT EXISTS idx_analysis_sessions_kit ON character_analysis_sessions(reference_kit_id);
CREATE INDEX IF NOT EXISTS idx_analysis_sessions_status ON character_analysis_sessions(status);

-- ============================================
-- Individual Image Analysis Results
-- Per-image extracted metadata
-- ============================================
CREATE TABLE IF NOT EXISTS character_image_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES character_analysis_sessions(id) ON DELETE CASCADE,

  -- Source image
  image_url TEXT NOT NULL,
  image_hash VARCHAR(64), -- Perceptual hash for deduplication

  -- Quality assessment
  quality_score DECIMAL(5,4), -- 0-1 overall quality
  blur_score DECIMAL(5,4),    -- 0-1 (1 = sharp)
  lighting_score DECIMAL(5,4), -- 0-1 (1 = well-lit)
  resolution_score DECIMAL(5,4), -- 0-1 based on pixel count
  face_visibility_score DECIMAL(5,4), -- 0-1 (1 = clear face)

  -- Validation
  is_valid BOOLEAN DEFAULT TRUE,
  rejection_reason TEXT,

  -- ============================================
  -- FACE GEOMETRY (JSONB for flexibility)
  -- ============================================
  face_geometry JSONB,
  -- Structure:
  -- {
  --   "landmarks": [...], -- 68 or 468 facial landmarks
  --   "bbox": { "x": 0, "y": 0, "w": 100, "h": 100 },
  --   "euler_angles": { "pitch": 0, "yaw": 0, "roll": 0 },
  --   "face_shape": "oval" | "round" | "square" | "heart" | "oblong",
  --   "eye_distance_ratio": 0.31, -- IPD relative to face width
  --   "face_symmetry_score": 0.92,
  --   "nose_shape": "straight" | "roman" | "button" | "upturned",
  --   "lip_shape": "full" | "thin" | "heart" | "wide",
  --   "chin_shape": "pointed" | "round" | "square",
  --   "jawline": "soft" | "defined" | "angular",
  --   "forehead_height": "low" | "average" | "high"
  -- }
  face_geometry_confidence DECIMAL(5,4),

  -- ============================================
  -- BODY PROPORTIONS (from full-body shots)
  -- ============================================
  body_proportions JSONB,
  -- Structure:
  -- {
  --   "skeleton_landmarks": [...], -- 33 body keypoints from DWPose
  --   "estimated_height_cm": null | number,
  --   "limb_ratios": {
  --     "arm_to_torso": 0.85,
  --     "leg_to_torso": 1.1,
  --     "shoulder_to_hip": 1.2,
  --     "head_to_body": 0.125
  --   },
  --   "body_type": "slim" | "athletic" | "average" | "curvy",
  --   "posture": "standing" | "sitting" | "other",
  --   "visibility": { "full_body": true, "upper_body": true, "face_only": false }
  -- }
  body_proportions_confidence DECIMAL(5,4),

  -- ============================================
  -- LIGHTING PROFILE
  -- ============================================
  lighting_profile JSONB,
  -- Structure:
  -- {
  --   "primary_direction": { "x": 0.5, "y": 0.3, "z": 0.8 }, -- Normalized vector
  --   "lighting_type": "front" | "rembrandt" | "loop" | "split" | "butterfly" | "natural",
  --   "key_to_fill_ratio": 2.5, -- 1:1 to 8:1
  --   "color_temperature_kelvin": 5500, -- 2700-6500K
  --   "intensity": "soft" | "medium" | "dramatic",
  --   "shadow_hardness": 0.6, -- 0-1 (soft to hard)
  --   "specular_highlights": [{ "x": 0.3, "y": 0.2, "intensity": 0.8 }],
  --   "ambient_level": 0.3
  -- }
  lighting_confidence DECIMAL(5,4),

  -- ============================================
  -- CAMERA PARAMETERS
  -- ============================================
  camera_parameters JSONB,
  -- Structure:
  -- {
  --   "estimated_focal_length_mm": 85,
  --   "estimated_sensor_size": "35mm" | "apsc" | "mft" | "phone",
  --   "subject_distance_m": 2.5,
  --   "depth_of_field": { "near_m": 2.3, "far_m": 2.7 },
  --   "perspective_distortion": "wide" | "normal" | "telephoto",
  --   "lens_characteristics": { "barrel_distortion": 0, "vignetting": 0.1 }
  -- }
  camera_confidence DECIMAL(5,4),

  -- ============================================
  -- STYLE FINGERPRINT
  -- ============================================
  style_fingerprint JSONB,
  -- Structure:
  -- {
  --   "color_palette": {
  --     "dominant": ["#F5E6D3", "#8B7355", "#2C1810"],
  --     "skin_tone": "#E8C4A8",
  --     "hair_color": "#2C1810",
  --     "eye_color": "#5B4A3F"
  --   },
  --   "texture_profile": {
  --     "skin_texture": "smooth" | "textured" | "mixed",
  --     "hair_texture": "straight" | "wavy" | "curly" | "coily"
  --   },
  --   "aesthetic_style": ["professional", "natural", "studio"],
  --   "makeup_level": "none" | "natural" | "moderate" | "full",
  --   "accessories": ["glasses", "earrings"],
  --   "typical_outfit_style": "casual" | "formal" | "athletic"
  -- }
  style_confidence DECIMAL(5,4),

  -- ============================================
  -- EXPRESSION & POSE
  -- ============================================
  expression_data JSONB,
  -- Structure:
  -- {
  --   "expression": "neutral" | "smiling" | "serious" | "surprised" | "other",
  --   "expression_intensity": 0.7,
  --   "gaze_direction": { "x": 0, "y": 0 },
  --   "head_pose": { "pitch": 5, "yaw": -10, "roll": 0 }
  -- }

  -- Processing metadata
  processing_time_ms INTEGER,
  api_cost_cents INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_image_analyses_session ON character_image_analyses(session_id);
CREATE INDEX IF NOT EXISTS idx_image_analyses_quality ON character_image_analyses(session_id, quality_score DESC) WHERE is_valid = TRUE;
CREATE INDEX IF NOT EXISTS idx_image_analyses_hash ON character_image_analyses(image_hash);

-- ============================================
-- Aggregated Character Identity Profile
-- Unified profile computed from all valid images
-- ============================================
CREATE TABLE IF NOT EXISTS character_identity_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Links
  session_id UUID REFERENCES character_analysis_sessions(id) ON DELETE SET NULL,
  character_diagram_id UUID REFERENCES character_diagrams(id) ON DELETE CASCADE,
  reference_kit_id UUID REFERENCES reference_kits(id) ON DELETE CASCADE,

  -- ============================================
  -- AGGREGATED FACE GEOMETRY
  -- ============================================
  face_geometry_profile JSONB,
  -- Structure (aggregated from all images):
  -- {
  --   "face_shape": { "value": "oval", "confidence": 0.92 },
  --   "eye_spacing": { "value": "average", "confidence": 0.88 },
  --   "nose_shape": { "value": "straight", "confidence": 0.85 },
  --   "lip_shape": { "value": "full", "confidence": 0.90 },
  --   "chin_shape": { "value": "pointed", "confidence": 0.87 },
  --   "forehead_height": { "value": "average", "confidence": 0.83 },
  --   "jawline": { "value": "defined", "confidence": 0.86 },
  --   "euler_angles": {
  --     "typical_pitch": { "mean": 0, "std": 5.2 },
  --     "typical_yaw": { "mean": 2.1, "std": 12.5 },
  --     "typical_roll": { "mean": 0, "std": 3.1 }
  --   },
  --   "eye_distance_ratio": { "mean": 0.31, "std": 0.02 },
  --   "face_symmetry": { "mean": 0.92, "std": 0.05 },
  --   "preferred_angle": "15deg",
  --   "angle_scores": { "0deg": 0.95, "15deg": 0.87, "30deg": 0.72 }
  -- }
  face_sample_count INTEGER DEFAULT 0,

  -- ============================================
  -- AGGREGATED BODY PROPORTIONS
  -- ============================================
  body_proportions_profile JSONB,
  -- Structure:
  -- {
  --   "body_type": { "value": "athletic", "confidence": 0.85 },
  --   "height_estimate": { "value": "average", "confidence": 0.70 },
  --   "shoulder_width": { "value": "average", "confidence": 0.82 },
  --   "limb_ratios": {
  --     "arm_to_torso": { "mean": 0.85, "std": 0.03 },
  --     "leg_to_torso": { "mean": 1.1, "std": 0.05 },
  --     "shoulder_to_hip": { "mean": 1.2, "std": 0.04 },
  --     "head_to_body": { "mean": 0.125, "std": 0.01 }
  --   }
  -- }
  body_sample_count INTEGER DEFAULT 0,

  -- ============================================
  -- AGGREGATED LIGHTING (typical conditions)
  -- ============================================
  lighting_profile JSONB,
  -- Structure:
  -- {
  --   "preferred_direction": { "value": "front", "confidence": 0.78 },
  --   "preferred_intensity": { "value": "medium", "confidence": 0.82 },
  --   "color_temperature": { "mean": 5200, "std": 400 },
  --   "shadow_preference": { "value": "moderate", "confidence": 0.75 },
  --   "typical_key_fill_ratio": { "mean": 2.5, "std": 0.8 }
  -- }
  lighting_sample_count INTEGER DEFAULT 0,

  -- ============================================
  -- AGGREGATED CAMERA PROFILE
  -- ============================================
  camera_profile JSONB,
  -- Structure:
  -- {
  --   "typical_focal_length": { "mean": 85, "std": 15 },
  --   "typical_distance": { "mean": 2.5, "std": 0.5 },
  --   "preferred_perspective": { "value": "normal", "confidence": 0.88 }
  -- }
  camera_sample_count INTEGER DEFAULT 0,

  -- ============================================
  -- AGGREGATED STYLE FINGERPRINT
  -- ============================================
  style_fingerprint JSONB,
  -- Structure:
  -- {
  --   "skin_tone": { "value": "#E8C4A8", "confidence": 0.95 },
  --   "skin_undertone": { "value": "warm", "confidence": 0.88 },
  --   "hair_color": { "value": "#2C1810", "confidence": 0.92 },
  --   "hair_length": { "value": "long", "confidence": 0.90 },
  --   "hair_texture": { "value": "wavy", "confidence": 0.85 },
  --   "eye_color": { "value": "#5B4A3F", "confidence": 0.88 },
  --   "has_freckles": false,
  --   "has_visible_marks": false,
  --   "makeup_level": { "value": "natural", "confidence": 0.82 },
  --   "style_keywords": ["professional", "natural", "elegant"],
  --   "typical_outfit_style": { "value": "casual", "confidence": 0.75 }
  -- }
  style_sample_count INTEGER DEFAULT 0,

  -- ============================================
  -- QUALITY METRICS
  -- ============================================
  overall_confidence DECIMAL(5,4), -- 0-1
  data_consistency_score DECIMAL(5,4), -- How consistent are the images
  best_reference_image_url TEXT, -- Highest quality source image
  image_quality_ranking JSONB, -- Ordered list of images by quality

  -- ============================================
  -- ANALYSIS METADATA
  -- ============================================
  analysis_model VARCHAR(50), -- 'gemini-3-pro', 'gemini-2.0-flash'
  analysis_version VARCHAR(20) DEFAULT '1.0',
  total_cost_cents INTEGER DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_identity_profiles_diagram ON character_identity_profiles(character_diagram_id);
CREATE INDEX IF NOT EXISTS idx_identity_profiles_kit ON character_identity_profiles(reference_kit_id);
CREATE INDEX IF NOT EXISTS idx_identity_profiles_session ON character_identity_profiles(session_id);

-- ============================================
-- Add identity_profile_id to character_diagrams
-- ============================================
ALTER TABLE character_diagrams
  ADD COLUMN IF NOT EXISTS identity_profile_id UUID REFERENCES character_identity_profiles(id) ON DELETE SET NULL;

-- ============================================
-- Add identity_profile_id to reference_kits
-- ============================================
ALTER TABLE reference_kits
  ADD COLUMN IF NOT EXISTS identity_profile_id UUID REFERENCES character_identity_profiles(id) ON DELETE SET NULL;

-- ============================================
-- Add dataset analysis fields to lora_models
-- ============================================
ALTER TABLE lora_models
  ADD COLUMN IF NOT EXISTS dataset_analysis JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS applied_optimizations JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS validation_result JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS quality_score INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS test_images JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS augmentation_applied BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS original_params JSONB DEFAULT NULL;

COMMENT ON COLUMN lora_models.dataset_analysis IS 'Pre-training analysis: quality scores, angle distribution, gaps';
COMMENT ON COLUMN lora_models.quality_score IS 'Post-training quality validation score (0-100)';
COMMENT ON COLUMN lora_models.test_images IS 'Test images generated during validation';

-- ============================================
-- Function to update updated_at timestamp
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_analysis_sessions_updated_at ON character_analysis_sessions;
CREATE TRIGGER update_analysis_sessions_updated_at
    BEFORE UPDATE ON character_analysis_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_identity_profiles_updated_at ON character_identity_profiles;
CREATE TRIGGER update_identity_profiles_updated_at
    BEFORE UPDATE ON character_identity_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
