
-- Update SELECT policy to include financeiro role
DROP POLICY IF EXISTS "Finance and admin read salario" ON public.funcionarios_salario;
CREATE POLICY "Finance and admin read salario"
  ON public.funcionarios_salario FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'financeiro'::app_role));
