## Apontar app publicado para o Supabase self-hosted (VPS)

### O que muda

Atualizar as credenciais do Supabase no frontend para usar o banco self-hosted em vez do Supabase Cloud.

**Novos valores:**
- URL: `http://191.101.234.62:8000`
- ANON_KEY: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzc5NDcxMjMzLCJleHAiOjE5MzcxNTEyMzN9.GW2Tk-7ZIAR3iHIAHG6SWVOaU4QSloY8q0g4cbLQlOQ`

### Arquivos a modificar

1. **`.env`** — substituir `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` pelos valores do VPS.
2. **`src/integrations/supabase/client.ts`** — atualizar os valores hardcoded (URL e anon key) que servem de fallback quando as envs não estão presentes em build.

### Validação após mudança

- Build limpo (`bun run build`).
- Testar login na preview apontando para o VPS.
- Publicar.

### Avisos importantes

- **HTTP (não HTTPS)**: o VPS está em `http://`. Navegadores modernos bloqueiam requisições HTTP a partir de um site publicado em HTTPS (`docpay.lovable.app`) → **mixed content**. O login vai falhar no domínio publicado. Soluções:
  - (a) Configurar HTTPS no VPS (Caddy/Nginx + Let's Encrypt) — recomendado.
  - (b) Acessar o app via HTTP também (não recomendado).
- **Edge Functions**: as functions hoje rodam no Supabase Cloud. Se forem necessárias no VPS, precisam ser deployadas lá separadamente (fora do escopo deste plano).
- **CORS**: o Kong do self-hosted precisa permitir o domínio `https://docpay.lovable.app`.

Quer que eu prossiga assim mesmo (sabendo do problema de mixed content), ou prefere primeiro resolver o HTTPS no VPS?
