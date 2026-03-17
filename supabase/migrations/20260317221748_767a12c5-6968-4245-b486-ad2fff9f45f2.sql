
-- Create salary table referencing funcionarios (RLS uses admin only for now)
CREATE TABLE IF NOT EXISTS public.funcionarios_salario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id uuid REFERENCES public.funcionarios(id) ON DELETE CASCADE NOT NULL,
  salario numeric,
  UNIQUE(funcionario_id)
);

ALTER TABLE public.funcionarios_salario ENABLE ROW LEVEL SECURITY;

-- Use a security definer function to check financeiro role safely
CREATE OR REPLACE FUNCTION public.has_role_any(_user_id uuid, _roles app_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = ANY(_roles)
  )
$$;

CREATE POLICY "Finance and admin read salario"
  ON public.funcionarios_salario FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admin insert salario"
  ON public.funcionarios_salario FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admin update salario"
  ON public.funcionarios_salario FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admin delete salario"
  ON public.funcionarios_salario FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
