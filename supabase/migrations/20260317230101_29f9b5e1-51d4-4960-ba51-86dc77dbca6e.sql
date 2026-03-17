
-- Add codigo column to funcionarios
ALTER TABLE public.funcionarios ADD COLUMN IF NOT EXISTS codigo text;

-- Add financial columns to funcionarios_salario
ALTER TABLE public.funcionarios_salario 
  ADD COLUMN IF NOT EXISTS outros_proventos numeric,
  ADD COLUMN IF NOT EXISTS salario_familia numeric,
  ADD COLUMN IF NOT EXISTS inss numeric,
  ADD COLUMN IF NOT EXISTS irrf numeric,
  ADD COLUMN IF NOT EXISTS outros_descontos numeric,
  ADD COLUMN IF NOT EXISTS liquido numeric,
  ADD COLUMN IF NOT EXISTS fgts numeric;
