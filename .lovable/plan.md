## Objetivo

Reescrever `MIGRACAO_VERCEL_HOSTINGER.md` para **um único stack Supabase self-hosted** com database chamado **`docpay`** (remover toda a parte de multi-app), e incluir **comandos completos e prontos para copiar** de:

1. **Exportar** o banco inteiro do Supabase Cloud (schema `public` + `auth.users` + `auth.identities`)
2. **Importar** esses dumps no database `docpay` da VPS Hostinger

## O que sai do documento

- Parte N inteira (adicionar segundo app)
- Tabela "App | Pasta | Container DB | Database | Porta Kong | Subdomínio"
- Toda referência a `app2`, `/opt/supabase-app2/`, `KONG_HTTP_PORT=8010`, `api-app2.seudominio.com`
- Frase "cada app adicional consome 1.5–2 GB de RAM..." (vira nota simples de dimensionamento)

## O que fica / é ajustado

Convenções fixas no topo do doc:

| Item | Valor |
|---|---|
| Pasta do stack | `/opt/supabase-docpay` |
| `COMPOSE_PROJECT_NAME` | `docpay` |
| `POSTGRES_DB` | `docpay` |
| Container do Postgres | `docpay-db` |
| Porta Kong | `8000` |
| Subdomínio | `api-docpay.seudominio.com` |
| Backups | `/opt/backups/docpay` |

Estrutura final:

```text
PARTE A — Preparar VPS (Ubuntu, Docker, firewall, swap)
PARTE B — Subir Supabase self-hosted em /opt/supabase-docpay
PARTE C — Exportar TUDO do Supabase Cloud  ← comandos completos
PARTE D — Transferir os dumps para a VPS (scp)
PARTE E — Importar no database docpay        ← comandos completos
PARTE F — Garantir user_roles e primeiro admin
PARTE G — Aplicar migrations futuras
PARTE H — Edge Functions na VPS
PARTE I — Variáveis no Vercel
PARTE J — Nginx + HTTPS (api-docpay.seudominio.com)
PARTE K — Backup automático diário
PARTE L — Checklist de validação
PARTE M — Custos / dimensionamento (KVM 2 recomendado)
```

## PARTE C — Exportar do Supabase Cloud (comandos)

Rodar **na máquina local** (precisa do `psql`/`pg_dump` 15+ instalado). Pegar a connection string em Supabase Dashboard → Project Settings → Database → Connection string (modo "Session", URI).

```bash
# 1) Connection string do Cloud (substituir SENHA e REGIAO)
export CLOUD_URL="postgresql://postgres.zouizzfomwrxfptgxkwj:SENHA@aws-0-REGIAO.pooler.supabase.com:5432/postgres"

# 2) Schema + dados do schema public (estrutura e dados do app)
pg_dump "$CLOUD_URL" \
  --schema=public \
  --no-owner --no-privileges --no-comments \
  --quote-all-identifiers \
  -f backup_public.sql

# 3) Dados dos usuários (logins + senhas hash)
pg_dump "$CLOUD_URL" \
  --data-only --table=auth.users \
  --column-inserts --no-owner --no-privileges \
  -f backup_auth_users.sql

# 4) Vínculos de identidade (email/OAuth)
pg_dump "$CLOUD_URL" \
  --data-only --table=auth.identities \
  --column-inserts --no-owner --no-privileges \
  -f backup_auth_identities.sql

# 5) Conferir tamanho
ls -lh backup_*.sql
```

Nota explicando que esses 3 arquivos = 100% do necessário para migrar (estrutura do app + usuários).

## PARTE D — Enviar para a VPS

```bash
scp backup_public.sql backup_auth_users.sql backup_auth_identities.sql \
    root@<IP_DA_VPS>:/opt/supabase-docpay/
```

## PARTE E — Importar no docpay (comandos, em ordem)

Na VPS, via SSH:

```bash
cd /opt/supabase-docpay

# 1) Parar serviços que leem o banco (DB segue rodando)
docker compose stop kong auth rest realtime functions storage

# 2) Resetar schema public e importar estrutura+dados
docker exec -i docpay-db psql -U postgres -d docpay -v ON_ERROR_STOP=1 \
  -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"

docker exec -i docpay-db psql -U postgres -d docpay -v ON_ERROR_STOP=1 \
  --single-transaction < /opt/supabase-docpay/backup_public.sql

# 3) Importar usuários
docker exec -i docpay-db psql -U postgres -d docpay -v ON_ERROR_STOP=1 \
  -c "TRUNCATE auth.users CASCADE;"

docker exec -i docpay-db psql -U postgres -d docpay -v ON_ERROR_STOP=1 \
  --single-transaction < /opt/supabase-docpay/backup_auth_users.sql

docker exec -i docpay-db psql -U postgres -d docpay -v ON_ERROR_STOP=1 \
  --single-transaction < /opt/supabase-docpay/backup_auth_identities.sql

# 4) Reconceder permissões (PostgREST exige)
docker exec -i docpay-db psql -U postgres -d docpay -v ON_ERROR_STOP=1 <<'SQL'
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role, authenticated;
SQL

# 5) Religar e recarregar o PostgREST
docker compose start kong auth rest realtime functions storage
docker exec docpay-db psql -U postgres -d docpay \
  -c "NOTIFY pgrst, 'reload schema';"
docker compose ps
```

## PARTE K — Backup diário da VPS (mesmo formato do export)

```bash
mkdir -p /opt/backups/docpay
cat > /opt/supabase-docpay/backup.sh <<'EOF'
#!/usr/bin/env bash
set -e
DATE=$(date +%Y%m%d_%H%M)
docker exec docpay-db pg_dump -U postgres -d docpay | gzip \
  > /opt/backups/docpay/docpay_$DATE.sql.gz
find /opt/backups/docpay -name "docpay_*.sql.gz" -mtime +14 -delete
EOF
chmod +x /opt/supabase-docpay/backup.sh
(crontab -l 2>/dev/null; echo "0 3 * * * /opt/supabase-docpay/backup.sh") | crontab -
```

## PARTE L — Checklist de validação

1. `docker compose ps` → todos `Up (healthy)`
2. `SELECT count(*) FROM funcionarios;` na VPS == Cloud
3. `SELECT count(*) FROM auth.users;` na VPS == Cloud
4. Login na app Vercel funciona com usuário antigo
5. `curl https://api-docpay.seudominio.com/rest/v1/empresas -H "apikey: $ANON_KEY"` responde 200
6. Edge function `check-ip` responde

## Arquivos afetados

- `MIGRACAO_VERCEL_HOSTINGER.md` — reescrita single-stack, com os blocos de export (Parte C) e import (Parte E) acima prontos para copiar.
- `.lovable/plan.md` — substituído por este plano.

Nenhum código da aplicação é tocado.
