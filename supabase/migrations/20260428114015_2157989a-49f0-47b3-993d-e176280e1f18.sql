-- 1) Remover coluna file_path da tabela de histórico (não é mais usada)
ALTER TABLE public.excel_upload_history DROP COLUMN IF EXISTS file_path;

-- 2) Remover policies de Storage relacionadas aos buckets do projeto
DROP POLICY IF EXISTS "Allow public upload to excel-uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read from excel-uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow public insert to excel-uploads" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated read excel-uploads" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated insert excel-uploads" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload generated docs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read generated docs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete generated docs" ON storage.objects;
DROP POLICY IF EXISTS "Owner can upload generated docs" ON storage.objects;
DROP POLICY IF EXISTS "Owner can read generated docs" ON storage.objects;
DROP POLICY IF EXISTS "Owner can delete generated docs" ON storage.objects;