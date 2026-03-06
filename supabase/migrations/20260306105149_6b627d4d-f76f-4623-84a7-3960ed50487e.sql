
CREATE TABLE public.processing_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  pdf_count integer NOT NULL,
  duration_seconds integer,
  month integer,
  year integer,
  month_name text
);

ALTER TABLE public.processing_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own history" ON public.processing_history
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can insert own history" ON public.processing_history
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP TABLE IF EXISTS public.generated_documents;
