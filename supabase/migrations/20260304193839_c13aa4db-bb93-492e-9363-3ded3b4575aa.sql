
-- Fix 1: Restrict excel-uploads storage policies to authenticated users only
DROP POLICY IF EXISTS "Allow public read from excel-uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow public insert to excel-uploads" ON storage.objects;

CREATE POLICY "Authenticated read excel-uploads" ON storage.objects FOR SELECT
USING (bucket_id = 'excel-uploads' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated insert excel-uploads" ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'excel-uploads' AND auth.role() = 'authenticated');

-- Fix 2: Make generated-documents bucket private
UPDATE storage.buckets SET public = false WHERE id = 'generated-documents';
