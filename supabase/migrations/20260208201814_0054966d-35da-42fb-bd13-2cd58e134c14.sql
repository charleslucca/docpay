-- Create empresas table
CREATE TABLE public.empresas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  nome_normalizado TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create municipios table
CREATE TABLE public.municipios (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  nome_normalizado TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create funcionarios table
CREATE TABLE public.funcionarios (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  municipio_id UUID NOT NULL REFERENCES public.municipios(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  nome_normalizado TEXT NOT NULL,
  cargo TEXT,
  banco TEXT,
  contrato TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(empresa_id, municipio_id, nome_normalizado)
);

-- Create excel_upload_history table
CREATE TABLE public.excel_upload_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_path TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_empresas INTEGER NOT NULL DEFAULT 0,
  total_municipios INTEGER NOT NULL DEFAULT 0,
  total_funcionarios INTEGER NOT NULL DEFAULT 0,
  funcionarios_novos INTEGER NOT NULL DEFAULT 0,
  funcionarios_atualizados INTEGER NOT NULL DEFAULT 0,
  funcionarios_removidos INTEGER NOT NULL DEFAULT 0
);

-- Create indexes for performance
CREATE INDEX idx_funcionarios_empresa ON public.funcionarios(empresa_id);
CREATE INDEX idx_funcionarios_municipio ON public.funcionarios(municipio_id);
CREATE INDEX idx_funcionarios_ativo ON public.funcionarios(ativo);
CREATE INDEX idx_empresas_nome_normalizado ON public.empresas(nome_normalizado);
CREATE INDEX idx_municipios_nome_normalizado ON public.municipios(nome_normalizado);

-- Enable RLS on all tables
ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.municipios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funcionarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.excel_upload_history ENABLE ROW LEVEL SECURITY;

-- Create public access policies (no auth required for now)
CREATE POLICY "Allow public read access on empresas" ON public.empresas FOR SELECT USING (true);
CREATE POLICY "Allow public insert access on empresas" ON public.empresas FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update access on empresas" ON public.empresas FOR UPDATE USING (true);

CREATE POLICY "Allow public read access on municipios" ON public.municipios FOR SELECT USING (true);
CREATE POLICY "Allow public insert access on municipios" ON public.municipios FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update access on municipios" ON public.municipios FOR UPDATE USING (true);

CREATE POLICY "Allow public read access on funcionarios" ON public.funcionarios FOR SELECT USING (true);
CREATE POLICY "Allow public insert access on funcionarios" ON public.funcionarios FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update access on funcionarios" ON public.funcionarios FOR UPDATE USING (true);
CREATE POLICY "Allow public delete access on funcionarios" ON public.funcionarios FOR DELETE USING (true);

CREATE POLICY "Allow public read access on excel_upload_history" ON public.excel_upload_history FOR SELECT USING (true);
CREATE POLICY "Allow public insert access on excel_upload_history" ON public.excel_upload_history FOR INSERT WITH CHECK (true);

-- Create storage bucket for Excel files
INSERT INTO storage.buckets (id, name, public) VALUES ('excel-uploads', 'excel-uploads', false);

-- Storage policies for excel-uploads bucket
CREATE POLICY "Allow public upload to excel-uploads" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'excel-uploads');
CREATE POLICY "Allow public read from excel-uploads" ON storage.objects FOR SELECT USING (bucket_id = 'excel-uploads');

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_empresas_updated_at
  BEFORE UPDATE ON public.empresas
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_funcionarios_updated_at
  BEFORE UPDATE ON public.funcionarios
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();