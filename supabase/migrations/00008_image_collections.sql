-- Migration: Image Collections Support
-- This extends collections to support images and creates a table for user-curated image collections

-- 1. Extend collections table to support 'image' type
-- First drop the existing constraint if it exists
ALTER TABLE collections
DROP CONSTRAINT IF EXISTS collections_type_check;

-- Add new constraint with 'image' type
ALTER TABLE collections
ADD CONSTRAINT collections_type_check
CHECK (type IN ('video', 'audio', 'image'));

-- 2. Create image_collection_items table for user-curated collections
-- This allows users to add images from various sources to their custom collections
CREATE TABLE IF NOT EXISTS image_collection_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  source_type VARCHAR(50) NOT NULL CHECK (source_type IN ('character_diagram', 'generated', 'url')),
  source_id UUID, -- References character_diagrams.id or jobs.id depending on source_type
  image_url TEXT NOT NULL,
  thumbnail_url TEXT,
  name VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_image_collection_items_collection ON image_collection_items(collection_id);
CREATE INDEX IF NOT EXISTS idx_image_collection_items_source ON image_collection_items(source_type, source_id);

-- Add a comment explaining the table purpose
COMMENT ON TABLE image_collection_items IS 'Stores images in user-created collections. Smart collections (Character Diagrams, Generated) are virtual and query their source tables directly.';
