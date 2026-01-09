-- Collections table (organize videos and audio)
CREATE TABLE IF NOT EXISTS collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('video', 'audio')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Videos table - create if not exists, then add missing columns
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

-- Add collection_id column if videos table already exists without it
ALTER TABLE videos ADD COLUMN IF NOT EXISTS collection_id UUID REFERENCES collections(id) ON DELETE SET NULL;

-- Audio files table - create if not exists, then add missing columns
CREATE TABLE IF NOT EXISTS audio_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  collection_id UUID REFERENCES collections(id) ON DELETE SET NULL,
  file_url TEXT NOT NULL,
  duration_seconds DECIMAL(10, 2),
  file_size_bytes BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add collection_id column if audio_files table already exists without it
ALTER TABLE audio_files ADD COLUMN IF NOT EXISTS collection_id UUID REFERENCES collections(id) ON DELETE SET NULL;

-- Hooks table (text overlays for variants)
CREATE TABLE IF NOT EXISTS hooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  text TEXT NOT NULL,
  category VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_collections_type ON collections(type);
CREATE INDEX IF NOT EXISTS idx_videos_collection ON videos(collection_id);
CREATE INDEX IF NOT EXISTS idx_videos_type ON videos(type);
CREATE INDEX IF NOT EXISTS idx_videos_parent ON videos(parent_video_id);
CREATE INDEX IF NOT EXISTS idx_audio_collection ON audio_files(collection_id);

-- Add updated_at triggers for collections and videos
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

-- Add storage buckets for videos and audio
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('source-videos', 'source-videos', false),
  ('processed-videos', 'processed-videos', true),
  ('audio', 'audio', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for source-videos (private - service role only)
DROP POLICY IF EXISTS "Service role can manage source-videos" ON storage.objects;
CREATE POLICY "Service role can manage source-videos"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'source-videos')
WITH CHECK (bucket_id = 'source-videos');

-- Storage policies for processed-videos (public read, service write)
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

-- Storage policies for audio (private - service role only)
DROP POLICY IF EXISTS "Service role can manage audio" ON storage.objects;
CREATE POLICY "Service role can manage audio"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'audio')
WITH CHECK (bucket_id = 'audio');
