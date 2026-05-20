## Objetivo

Mover o DocPay para uma arquitetura híbrida:
- **Frontend (código React/Vite)** → hospedado no **Vercel** (deploy automático via GitHub).
- **Backend (PostgreSQL + Auth + Edge Functions)** → **Supabase self-hosted** rodando em **Docker na VPS Hostinger**.
- **Migração do banco** atual (Supabase Cloud `zouizzfomwrxfptgxkwj`) → novo Postgres da VPS.

O passo a passo será escrito para leigo: cada comando explicado em uma linha, sem pular etapas.

---

## Estrutura do guia que será gerado

Será criado **1 único arquivo** na raiz do projeto: `MIGRACAO_VERCEL_HOSTINGER.md` (substituindo os antigos `MIGRACAO_VPS_HOSTINGER.*` que ficaram obsoletos para esse novo cenário).

### Seções do guia

**Parte A — Preparar a VPS Hostinger (backend)**
1. Contratar VPS KVM 2 Ubuntu 22.04 no painel Hostinger (cliques).
2. Acessar via SSH (`ssh root@IP`).
3. Instalar Docker, Docker Compose, Nginx, Certbot, UFW (1 bloco copy/paste).
4. Configurar firewall (portas 22, 80, 443).
5. Apontar subdomínio `api.seudominio.com` para o IP da VPS (DNS).

**Parte B — Subir Supabase self-hosted (sem Storage)**
1. `git clone` do repositório `supabase/supabase`.
2. Editar `.env` (gerar senhas com `openssl rand`, montar `ANON_KEY` e `SERVICE_ROLE_KEY` usando o JWT generator oficial — link incluído).
3. Remover serviços `storage` e `imgproxy` do `docker-compose.yml`.
4. `docker compose up -d` e verificação com `docker compose ps`.
5. Configurar Nginx + Certbot (HTTPS) para `api.seudominio.com`.

**Parte C — Exportar banco do Supabase Cloud atual**
1. Pegar a senha do Postgres no painel atual (Project Settings → Database).
2. Comando único de export (no PC do usuário, com `pg_dump`):
   ```bash
   pg_dump "postgresql://postgres:SENHA@db.zouizzfomwrxfptgxkwj.supabase.co:5432/postgres" \
     --schema=public --schema=auth \
     --no-owner --no-privileges --clean --if-exists \
     -f backup_docpay.sql
   ```
3. Explicação: o que cada flag faz, em português simples.

**Parte D — Importar banco na VPS**
1. `scp backup_docpay.sql root@IP:/opt/supabase/`
2. `docker exec -i supabase-db psql -U postgres -d postgres < backup_docpay.sql`
3. Verificações: contar tabelas, contar usuários, conferir RLS.
4. **Aplicar migrations futuras**: como rodar arquivos de `supabase/migrations/` manualmente via `psql` (`docker exec -i supabase-db psql -U postgres -d postgres < arquivo.sql`).

**Parte E — Deploy das Edge Functions na VPS**
1. Copiar `admin-create-user` e `check-ip` para `volumes/functions/`.
2. `docker compose restart functions`.
3. Teste com `curl`.

**Parte F — Frontend no Vercel**
1. Conectar o repositório GitHub do projeto no Vercel (cliques).
2. Configurar build:
   - Framework: Vite
   - Build command: `npm run build`
   - Output: `dist`
3. Definir as Environment Variables no Vercel:
   ```
   VITE_SUPABASE_URL=https://api.seudominio.com
   VITE_SUPABASE_PUBLISHABLE_KEY=<ANON_KEY gerada na VPS>
   VITE_SUPABASE_PROJECT_ID=docpay
   ```
4. Deploy. O Vercel gera URL `docpay.vercel.app` (ou domínio custom).
5. Atualizar CORS no Kong da VPS para permitir o domínio do Vercel.

**Parte G — Cutover e validação**
- Checklist: login, RLS, IP whitelist, upload Excel, geração de ZIP.

**Parte H — Backup automático do banco**
- Script `backup.sh` + cron diário (3h da manhã).

**Parte I — Rollback**
- Manter Supabase Cloud ativo 15 dias; reverter `VITE_SUPABASE_URL` no Vercel se algo falhar.

---

## Detalhes técnicos importantes

- **Storage**: o projeto não usa mais (ZIPs são gerados localmente no navegador). Os serviços `storage-api` e `imgproxy` são removidos do compose para economizar RAM.
- **Buckets `excel-uploads` e `generated-documents`** ainda aparecem no Supabase atual mas estão sem uso prático — o guia menciona que podem ser ignorados na migração.
- **CORS**: o Kong (gateway do Supabase self-hosted) precisa liberar o domínio do Vercel (`*.vercel.app` ou domínio próprio). Comando de edição do `kong.yml` será incluído.
- **JWT_SECRET**: precisa ser o mesmo usado para gerar `ANON_KEY` e `SERVICE_ROLE_KEY` — guia aponta para `https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys`.
- **Migrations futuras**: como o projeto continuará usando arquivos `supabase/migrations/*.sql`, o guia mostra como aplicá-los manualmente na VPS (sem CLI Supabase), via `docker exec`.

---

## Entregável

- 1 arquivo: **`MIGRACAO_VERCEL_HOSTINGER.md`** na raiz do repositório.
- Remoção dos arquivos antigos `MIGRACAO_VPS_HOSTINGER.md`, `MIGRACAO_VPS_HOSTINGER.txt` e da pasta `docs/` (que ficaram obsoletos e duplicados).
- Como será criado via ferramenta versionada do Lovable, o commit aparece automaticamente no GitHub e dispara o deploy do Vercel.

---

## O que NÃO está incluso (confirme se precisa)

- Configuração de e-mail SMTP para o Auth (Resend, SendGrid etc.) — posso adicionar uma seção opcional.
- Domínio próprio no Vercel (apenas menciono; passos detalhados podem ser adicionados).
- Migração de usuários do `auth.users` com senhas (o `pg_dump` do schema `auth` cobre isso, mas vale destacar).
