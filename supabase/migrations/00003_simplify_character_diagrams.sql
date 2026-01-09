-- Simplify character_diagrams table
-- Remove over-engineered columns, use media table pattern instead

-- Drop unused columns
ALTER TABLE character_diagrams
DROP COLUMN IF EXISTS full_body_url,
DROP COLUMN IF EXISTS face_closeup_url;

-- Add file_url column for the combined image (like other media types)
ALTER TABLE character_diagrams
ADD COLUMN IF NOT EXISTS file_url TEXT;

-- Update source_image_url to be nullable (will be set after upload)
ALTER TABLE character_diagrams
ALTER COLUMN source_image_url DROP NOT NULL;
