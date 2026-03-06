
-- Drop existing open policies on empresas
DROP POLICY IF EXISTS "Allow public insert access on empresas" ON public.empresas;
DROP POLICY IF EXISTS "Allow public read access on empresas" ON public.empresas;
DROP POLICY IF EXISTS "Allow public update access on empresas" ON public.empresas;

-- Drop existing open policies on municipios
DROP POLICY IF EXISTS "Allow public insert access on municipios" ON public.municipios;
DROP POLICY IF EXISTS "Allow public read access on municipios" ON public.municipios;
DROP POLICY IF EXISTS "Allow public update access on municipios" ON public.municipios;

-- Drop existing open policies on funcionarios
DROP POLICY IF EXISTS "Allow public insert access on funcionarios" ON public.funcionarios;
DROP POLICY IF EXISTS "Allow public read access on funcionarios" ON public.funcionarios;
DROP POLICY IF EXISTS "Allow public update access on funcionarios" ON public.funcionarios;
DROP POLICY IF EXISTS "Allow public delete access on funcionarios" ON public.funcionarios;

-- Drop existing open policies on excel_upload_history
DROP POLICY IF EXISTS "Allow public insert access on excel_upload_history" ON public.excel_upload_history;
DROP POLICY IF EXISTS "Allow public read access on excel_upload_history" ON public.excel_upload_history;

-- empresas: authenticated read, admin write
CREATE POLICY "Authenticated read empresas" ON public.empresas FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin insert empresas" ON public.empresas FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin update empresas" ON public.empresas FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- municipios: authenticated read, admin write
CREATE POLICY "Authenticated read municipios" ON public.municipios FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin insert municipios" ON public.municipios FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin update municipios" ON public.municipios FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- funcionarios: authenticated read, admin write/delete
CREATE POLICY "Authenticated read funcionarios" ON public.funcionarios FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin insert funcionarios" ON public.funcionarios FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin update funcionarios" ON public.funcionarios FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin delete funcionarios" ON public.funcionarios FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- excel_upload_history: authenticated read, admin insert
CREATE POLICY "Authenticated read excel_upload_history" ON public.excel_upload_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin insert excel_upload_history" ON public.excel_upload_history FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
