-- Drop existing overly-broad storage policies for generated-documents
DROP POLICY IF EXISTS "Authenticated users can upload generated docs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read generated docs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete generated docs" ON storage.objects;

-- Owner-scoped storage policies: user can only access files under their own user ID prefix
CREATE POLICY "Owner upload generated docs"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'generated-documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Owner read generated docs"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'generated-documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Owner delete generated docs"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'generated-documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
);