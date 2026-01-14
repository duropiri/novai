-- Multi-image support for Character Diagrams and Reference Kits
-- Enables uploading multiple reference images for better identity consistency

-- ============================================
-- Character Diagram Images (multiple source images)
-- ============================================
CREATE TABLE IF NOT EXISTS character_diagram_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_diagram_id UUID NOT NULL REFERENCES character_diagrams(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  image_type VARCHAR(50) DEFAULT 'reference', -- 'primary', 'front', 'profile', '3/4 angle', 'full_body', 'expression'
  is_primary BOOLEAN DEFAULT FALSE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_char_diagram_images ON character_diagram_images(character_diagram_id);
CREATE INDEX IF NOT EXISTS idx_char_diagram_images_primary ON character_diagram_images(character_diagram_id, is_primary) WHERE is_primary = TRUE;

-- ============================================
-- Reference Kit Source Images (multiple source images)
-- ============================================
CREATE TABLE IF NOT EXISTS reference_kit_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_kit_id UUID NOT NULL REFERENCES reference_kits(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  image_type VARCHAR(50) DEFAULT 'source', -- 'source', 'front', 'profile', 'waist_up', 'full_body', 'expression'
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ref_kit_sources ON reference_kit_sources(reference_kit_id);

-- ============================================
-- Update character_diagrams table
-- ============================================
ALTER TABLE character_diagrams ADD COLUMN IF NOT EXISTS image_count INTEGER DEFAULT 1;
ALTER TABLE character_diagrams ADD COLUMN IF NOT EXISTS primary_image_url TEXT;

-- ============================================
-- Update reference_kits table
-- ============================================
ALTER TABLE reference_kits ADD COLUMN IF NOT EXISTS source_image_count INTEGER DEFAULT 1;
ALTER TABLE reference_kits ADD COLUMN IF NOT EXISTS uses_provided_images BOOLEAN DEFAULT FALSE;

-- ============================================
-- Migrate existing single-image data to new tables
-- ============================================

-- Migrate existing character diagram source images
INSERT INTO character_diagram_images (character_diagram_id, image_url, image_type, is_primary, sort_order)
SELECT id, source_image_url, 'primary', TRUE, 0
FROM character_diagrams
WHERE source_image_url IS NOT NULL
ON CONFLICT DO NOTHING;

-- Migrate existing reference kit source images
INSERT INTO reference_kit_sources (reference_kit_id, image_url, image_type, sort_order)
SELECT id, source_image_url, 'source', 0
FROM reference_kits
WHERE source_image_url IS NOT NULL
ON CONFLICT DO NOTHING;

-- Update image counts
UPDATE character_diagrams
SET image_count = 1, primary_image_url = source_image_url
WHERE source_image_url IS NOT NULL;

UPDATE reference_kits
SET source_image_count = 1
WHERE source_image_url IS NOT NULL;
