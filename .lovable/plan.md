## Comando para exportar TUDO do banco `zouizzfomwrxfptgxkwj`

A connection string já vem pronta no Supabase Dashboard → **Project Settings → Database → Connection string** (modo **Session**, formato URI). Você só substitui `SENHA` pela senha do banco e `REGIAO` pela região do seu projeto (ex: `sa-east-1`).

### Opção A — Export completo em UM único arquivo (recomendado, mais simples)

Roda **na sua máquina local** com `pg_dump` 15+ instalado.

```bash
# 1) Connection string do projeto zouizzfomwrxfptgxkwj
export CLOUD_URL="postgresql://postgres.zouizzfomwrxfptgxkwj:SENHA@aws-0-REGIAO.pooler.supabase.com:5432/postgres"

# 2) Dump completo: estrutura do schema public + dados + auth.users + auth.identities
pg_dump "$CLOUD_URL" \
  --schema=public \
  --schema=auth \
  --no-owner --no-privileges --no-comments \
  --quote-all-identifiers \
  --exclude-table-data='auth.audit_log_entries' \
  --exclude-table-data='auth.refresh_tokens' \
  --exclude-table-data='auth.sessions' \
  --exclude-table-data='auth.mfa_*' \
  --exclude-table-data='auth.sso_*' \
  --exclude-table-data='auth.saml_*' \
  --exclude-table-data='auth.flow_state' \
  --exclude-table-data='auth.one_time_tokens' \
  -f backup_docpay_full.sql

# 3) Conferir
ls -lh backup_docpay_full.sql
```

Isso gera **1 arquivo só** com:
- toda a estrutura do schema `public` (tabelas, funções `has_role`, `handle_new_user`, enums como `app_role`, triggers, RLS)
- todos os dados das tabelas `public.*`
- estrutura do schema `auth` + dados de `auth.users` e `auth.identities` (logins e senhas hash), ignorando tabelas voláteis (sessões, tokens, MFA) que serão recriadas pelo GoTrue.

### Opção B — 3 arquivos separados (já está no `MIGRACAO_VERCEL_HOSTINGER.md`)

Mantém o que já documentamos: `backup_public.sql`, `backup_auth_users.sql`, `backup_auth_identities.sql`. Vantagem: import mais granular. Desvantagem: 3 comandos a mais.

## O que muda no documento

Atualizar `MIGRACAO_VERCEL_HOSTINGER.md`:

1. **PARTE C** — adicionar no topo a **Opção A (1 arquivo)** como recomendada, mantendo a **Opção B (3 arquivos)** como alternativa.
2. **PARTE D** — mostrar o `scp` para ambos os cenários (`backup_docpay_full.sql` OU os 3 arquivos).
3. **PARTE E** — adicionar bloco de import correspondente à Opção A:
   ```bash
   docker compose stop kong auth rest realtime functions storage

   docker exec -i docpay-db psql -U postgres -d docpay -v ON_ERROR_STOP=1 \
     -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;
         TRUNCATE auth.users CASCADE;"

   docker exec -i docpay-db psql -U postgres -d docpay -v ON_ERROR_STOP=1 \
     --single-transaction < /opt/supabase-docpay/backup_docpay_full.sql

   # GRANTs (mesmo bloco já existente)
   # NOTIFY pgrst, 'reload schema'
   docker compose start kong auth rest realtime functions storage
   ```
4. **Solução de problemas** — adicionar linha: se `pg_dump` versão for < 15, atualizar antes de exportar (incompatibilidade com Supabase Cloud).

Nenhum código da aplicação é tocado.
