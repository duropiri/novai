-- Create all required storage buckets
-- These need to exist for the app to upload/retrieve files

-- Insert buckets (if they don't exist)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('training-images', 'training-images', true, 52428800, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('lora-weights', 'lora-weights', true, 524288000, ARRAY['application/octet-stream', 'image/jpeg', 'image/png', 'image/webp']),
  ('character-images', 'character-images', true, 52428800, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('source-videos', 'source-videos', true, 524288000, ARRAY['video/mp4', 'video/quicktime', 'video/webm']),
  ('processed-videos', 'processed-videos', true, 524288000, ARRAY['video/mp4', 'video/quicktime', 'video/webm']),
  ('variant-videos', 'variant-videos', true, 524288000, ARRAY['video/mp4', 'video/quicktime', 'video/webm']),
  ('audio', 'audio', true, 104857600, ARRAY['audio/mpeg', 'audio/wav', 'audio/mp3', 'audio/m4a']),
  ('reference-kits', 'reference-kits', true, 52428800, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Drop existing policies if they exist, then recreate
DROP POLICY IF EXISTS "Public read access" ON storage.objects;
DROP POLICY IF EXISTS "Allow uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow updates" ON storage.objects;
DROP POLICY IF EXISTS "Allow deletes" ON storage.objects;

-- Allow public read access to all buckets (for displaying thumbnails/media)
CREATE POLICY "Public read access" ON storage.objects FOR SELECT USING (true);

-- Allow all uploads/updates/deletes for development
-- In production, you'd want to restrict this based on auth
CREATE POLICY "Allow uploads" ON storage.objects FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow updates" ON storage.objects FOR UPDATE USING (true);
CREATE POLICY "Allow deletes" ON storage.objects FOR DELETE USING (true);
