-- NOVAI Storage Buckets Setup
-- Run this in your Supabase SQL Editor after creating the buckets in the dashboard

-- Note: Creates buckets and sets up storage policies.

-- ============================================
-- CREATE STORAGE BUCKETS
-- ============================================
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('training-images', 'training-images', false),
  ('lora-weights', 'lora-weights', false),
  ('character-images', 'character-images', true),
  ('variant-videos', 'variant-videos', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- STORAGE POLICIES FOR PUBLIC READ ACCESS
-- ============================================

-- Training Images (private - only service role can access)
DROP POLICY IF EXISTS "Service role can manage training-images" ON storage.objects;
CREATE POLICY "Service role can manage training-images"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'training-images')
WITH CHECK (bucket_id = 'training-images');

-- LoRA Weights (private - only service role can access)
DROP POLICY IF EXISTS "Service role can manage lora-weights" ON storage.objects;
CREATE POLICY "Service role can manage lora-weights"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'lora-weights')
WITH CHECK (bucket_id = 'lora-weights');

-- Character Images (public read, service write)
DROP POLICY IF EXISTS "Public can view character-images" ON storage.objects;
CREATE POLICY "Public can view character-images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'character-images');

DROP POLICY IF EXISTS "Service role can manage character-images" ON storage.objects;
CREATE POLICY "Service role can manage character-images"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'character-images')
WITH CHECK (bucket_id = 'character-images');

-- Variant Videos (public read for sharing)
DROP POLICY IF EXISTS "Public can view variant-videos" ON storage.objects;
CREATE POLICY "Public can view variant-videos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'variant-videos');

DROP POLICY IF EXISTS "Service role can manage variant-videos" ON storage.objects;
CREATE POLICY "Service role can manage variant-videos"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'variant-videos')
WITH CHECK (bucket_id = 'variant-videos');
