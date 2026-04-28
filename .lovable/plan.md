
# Plano de Migração: Lovable + Supabase Cloud → VPS Hostinger

## Visão geral da arquitetura atual

- **Frontend**: React 18 + Vite + TypeScript + Tailwind (SPA estática após build)
- **Backend Supabase Cloud (`zouizzfomwrxfptgxkwj`)**:
  - **Auth** (email/senha, JWT)
  - **Postgres** com 9 tabelas (`empresas`, `municipios`, `funcionarios`, `funcionarios_salario`, `excel_upload_history`, `processing_history`, `profiles`, `user_roles`, `ip_whitelist`) + RLS + 4 funções SQL (`has_role`, `has_role_any`, `handle_new_user`, `update_updated_at_column`)
  - **Storage**: 2 buckets privados (`excel-uploads`, `generated-documents`)
  - **Edge Functions (Deno)**: `check-ip` e `admin-create-user`
- **Processamento pesado** (PDF/OCR/Excel) já roda 100% no browser do usuário — não precisa migrar nada server-side disso.

## Estratégia recomendada

Rodar **Supabase self-hosted via Docker Compose** no VPS Hostinger. Isso preserva 100% da estrutura do código (cliente `@supabase/supabase-js`, RLS, Auth, Storage e Edge Functions continuam funcionando sem reescrever). É a alternativa de menor risco e menor esforço.

### Alternativas consideradas

| Opção | Esforço | Recomendado? |
|---|---|---|
| **Supabase self-hosted (Docker)** | Baixo — preserva código | ✅ Sim |
| Postgres puro + PostgREST + GoTrue + MinIO manual | Médio | Só se quiser componentes separados |
| Reescrever backend em Node/Express + Prisma + S3 | Alto — refatorar todo `src/` | ❌ Não vale |
| Pocketbase / Appwrite | Alto — reescrever auth/RLS/clientes | ❌ Não |

**Equivalências para Edge Functions**: O Supabase self-hosted já inclui o runtime Deno (`edge-runtime`), então as duas funções (`check-ip` e `admin-create-user`) funcionam **sem alteração**. Caso prefira não usar o edge-runtime, alternativa é reescrever ambas como rotas Express/Fastify em um container Node separado.

### Requisitos do VPS Hostinger

- Plano **VPS KVM 2** ou superior (mínimo 2 vCPU, 8 GB RAM, 100 GB SSD) — Supabase stack consome ~3-4 GB RAM
- Ubuntu 22.04 LTS
- 1 domínio apontando para o IP do VPS (ex: `docpay.seudominio.com` para o app, `api.seudominio.com` para o Supabase)

---

## Passo a passo da migração

### Fase 1 — Preparação (antes de mexer no VPS)

1. **Backup completo do Supabase atual**
   - Dump SQL do banco: dashboard → Database → Backups → download, ou via `supabase db dump`
   - Export dos buckets `excel-uploads` e `generated-documents` (script Node usando service_role)
   - Export dos usuários do Auth: `auth.users` via SQL ou `supabase-js` admin API
   - Anotar todos os secrets atuais

2. **Anotar variáveis de ambiente do frontend**
   - `VITE_SUPABASE_URL` (vai mudar para `https://api.seudominio.com`)
   - `VITE_SUPABASE_PUBLISHABLE_KEY` (será regenerada)
   - `VITE_SUPABASE_PROJECT_ID` (não relevante em self-hosted, pode remover)

### Fase 2 — Provisionamento do VPS

3. **Contratar VPS na Hostinger** (KVM 2+) e acessar via SSH
4. **Hardening básico**:
   - `apt update && apt upgrade`
   - Criar usuário não-root + chave SSH, desabilitar login root e senha
   - `ufw allow 22, 80, 443` e ativar firewall
   - Instalar `fail2ban`
5. **Instalar Docker + Docker Compose plugin**
6. **Instalar Nginx + Certbot** (para reverse proxy + HTTPS Let's Encrypt)
7. **Configurar DNS na Hostinger**: registros A apontando `app.dominio.com` e `api.dominio.com` para o IP do VPS

### Fase 3 — Subir Supabase self-hosted

8. **Clonar repo oficial**:
   ```
   git clone --depth 1 https://github.com/supabase/supabase /opt/supabase
   cd /opt/supabase/docker
   cp .env.example .env
   ```
9. **Editar `.env`** com:
   - `POSTGRES_PASSWORD` forte
   - `JWT_SECRET` (32+ chars)
   - `ANON_KEY` e `SERVICE_ROLE_KEY` (gerar em https://supabase.com/docs/guides/self-hosting/docker → tool de geração de JWTs)
   - `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` (Studio admin)
   - `SITE_URL=https://app.dominio.com`
   - `API_EXTERNAL_URL=https://api.dominio.com`
   - `SMTP_*` (configurar SMTP — pode usar o próprio email da Hostinger ou Resend/Brevo) para emails de auth
10. **Subir stack**: `docker compose up -d`
11. **Configurar Nginx** como reverse proxy:
    - `api.dominio.com` → `localhost:8000` (Kong gateway do Supabase)
    - `app.dominio.com` → diretório estático do build do React (ou container Nginx separado)
    - Studio em subdomínio interno (ex: `studio.dominio.com` com basic-auth extra)
12. **Emitir certificados SSL** com `certbot --nginx`

### Fase 4 — Restaurar dados

13. **Restaurar schema + dados**:
    - Aplicar todas as 14 migrations de `supabase/migrations/` em ordem cronológica via `psql`
    - Importar dump das tabelas (dados)
    - Recriar usuários no Auth via API admin (não dá pra copiar `auth.users` cru porque IDs precisam bater com `profiles.id` — usar script que recria com mesmo `id` e força `password_hash` ou envia link de redefinição)
14. **Restaurar buckets de Storage**:
    - Criar buckets `excel-uploads` e `generated-documents` (privados) no Studio self-hosted
    - Reenviar arquivos via script usando service_role
    - Reaplicar policies de Storage

### Fase 5 — Migrar Edge Functions

15. **Copiar funções**:
    ```
    cp -r supabase/functions/* /opt/supabase/docker/volumes/functions/
    ```
16. **Configurar `supabase/config.toml`** equivalente no self-hosted (já está no `.env` via `FUNCTIONS_VERIFY_JWT=false` por função)
17. **Verificar** que `check-ip` e `admin-create-user` respondem em `https://api.dominio.com/functions/v1/<nome>`
18. **Atenção `check-ip`**: agora o IP virá pelo Nginx — adicionar `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` no Nginx para que `x-forwarded-for` chegue corretamente na função

### Fase 6 — Build e deploy do frontend

19. **Atualizar `.env` do projeto**:
    ```
    VITE_SUPABASE_URL=https://api.dominio.com
    VITE_SUPABASE_PUBLISHABLE_KEY=<novo ANON_KEY gerado>
    ```
20. **Atualizar `src/integrations/supabase/client.ts`** se houver URLs hardcoded (atualmente tem — trocar para `import.meta.env`)
21. **Build local**: `npm ci && npm run build` → gera `dist/`
22. **Enviar `dist/`** para `/var/www/docpay/` no VPS (via `rsync` ou pipeline GitHub Actions)
23. **Configurar Nginx** com fallback SPA (`try_files $uri /index.html;`)

### Fase 7 — Validação

24. Testar login, criação de usuário (admin-create-user), IP whitelist, upload Excel, processamento de PDF, geração de documentos
25. Verificar logs: `docker compose logs -f` no `/opt/supabase/docker`
26. Confirmar emails de auth chegando (SMTP)

### Fase 8 — Operação contínua

27. **Backups automáticos**: cron diário com `pg_dump` + sync dos volumes Docker para storage externo (ex: backup B2/S3 ou Hostinger Object Storage)
28. **Monitoramento**: instalar `netdata` ou `uptime-kuma`
29. **Atualizações**: `cd /opt/supabase && git pull && docker compose pull && docker compose up -d`
30. **Renovação SSL**: certbot já roda via cron automaticamente

---

## Principais riscos e mitigações

| Risco | Mitigação |
|---|---|
| Migrar `auth.users` mantendo IDs | Script com `auth.admin.createUser` + UPDATE direto em `auth.users.id` antes de qualquer trigger rodar; ou enviar links de reset de senha em massa |
| Triggers `handle_new_user` duplicarem profiles | Aplicar migrations ANTES de importar usuários, e fazer import com `ON CONFLICT DO NOTHING` |
| Storage URLs assinadas antigas pararem | URLs assinadas são geradas on-demand pelo cliente; nada a fazer |
| Edge runtime self-hosted ser mais lento | Aceitável; ou migrar funções para Node se virar gargalo |
| SMTP da Hostinger ter rate limit baixo | Usar Resend/Brevo (free tier) — mais confiável para auth emails |

## Entregáveis

Ao aprovar, vou gerar **um único arquivo Markdown** (`/mnt/documents/MIGRACAO_VPS_HOSTINGER.md`) contendo:

- Este plano completo, expandido com:
  - Comandos shell prontos para colar (apt, docker, nginx, certbot)
  - Template completo do `.env` do Supabase self-hosted
  - Configuração Nginx pronta para os 3 subdomínios
  - Script Node de export/import de buckets de Storage
  - Script Node de migração de usuários do Auth preservando IDs
  - Comandos de backup automático (cron + pg_dump)
  - Checklist final de validação pós-migração
  - Troubleshooting comum

## Arquivos a serem criados/alterados no projeto

- `/mnt/documents/MIGRACAO_VPS_HOSTINGER.md` — guia completo (novo, fora do projeto)
- `src/integrations/supabase/client.ts` — trocar URLs hardcoded por `import.meta.env` (no momento da migração)
- `.env.example` — adicionar template (no momento da migração)

Nenhuma alteração no código de negócio é necessária — RLS, queries, auth e storage continuam idênticos.
