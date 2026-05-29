
-- Tighten excel_upload_history SELECT to admins only
DROP POLICY IF EXISTS "Authenticated read excel_upload_history" ON public.excel_upload_history;

CREATE POLICY "Admin read excel_upload_history"
ON public.excel_upload_history
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Storage policies for excel-uploads bucket (admin-only access)
DROP POLICY IF EXISTS "Admin read excel-uploads" ON storage.objects;
DROP POLICY IF EXISTS "Admin insert excel-uploads" ON storage.objects;
DROP POLICY IF EXISTS "Admin update excel-uploads" ON storage.objects;
DROP POLICY IF EXISTS "Admin delete excel-uploads" ON storage.objects;

CREATE POLICY "Admin read excel-uploads"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'excel-uploads' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admin insert excel-uploads"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'excel-uploads' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admin update excel-uploads"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'excel-uploads' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admin delete excel-uploads"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'excel-uploads' AND has_role(auth.uid(), 'admin'::app_role));
