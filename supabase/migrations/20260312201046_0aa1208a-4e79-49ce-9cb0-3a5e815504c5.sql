DROP POLICY "Authenticated read funcionarios" ON public.funcionarios;
CREATE POLICY "Admin read funcionarios" ON public.funcionarios
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));