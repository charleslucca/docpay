
-- Create public bucket for generated PDF documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('generated-documents', 'generated-documents', true)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for generated-documents bucket
-- Allow authenticated users to upload
CREATE POLICY "Authenticated users can upload generated docs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'generated-documents');

-- Allow authenticated users to read
CREATE POLICY "Authenticated users can read generated docs"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'generated-documents');

-- Allow authenticated users to delete their own uploads
CREATE POLICY "Authenticated users can delete generated docs"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'generated-documents');

-- Table to persist generated document metadata
CREATE TABLE public.generated_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users NOT NULL DEFAULT auth.uid(),
  employee_name TEXT NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  month_name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  empresa TEXT,
  municipio TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.generated_documents ENABLE ROW LEVEL SECURITY;

-- Users can only see their own documents
CREATE POLICY "Users can view own generated documents"
ON public.generated_documents FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Users can insert their own documents
CREATE POLICY "Users can insert own generated documents"
ON public.generated_documents FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Users can delete their own documents
CREATE POLICY "Users can delete own generated documents"
ON public.generated_documents FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- Index for efficient filtering by year/month
CREATE INDEX idx_generated_documents_year_month ON public.generated_documents (user_id, year, month);
