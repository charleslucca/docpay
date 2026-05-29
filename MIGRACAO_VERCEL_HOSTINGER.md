# Migração — Frontend Vercel + Supabase self-hosted (VPS Hostinger)

Guia passo a passo para alguém sem experiência prévia. O frontend continua no **Vercel** e o backend Supabase passa a rodar em uma **VPS Hostinger** com Docker, em um único stack chamado **docpay**.

## Convenções (memorize)

| Item | Valor |
|---|---|
| Pasta do stack | `/opt/supabase-docpay` |
| `COMPOSE_PROJECT_NAME` | `docpay` |
| Database | `docpay` |
| Container do Postgres | `docpay-db` |
| Porta Kong (API) | `8000` |
| Subdomínio público | `api-docpay.seudominio.com` |
| Pasta de backups | `/opt/backups/docpay` |

---

## PARTE A — Preparar a VPS (Ubuntu 22.04)

Recomendado: Hostinger **KVM 2** (2 vCPU, 8 GB RAM, 100 GB).

```bash
# Acessar a VPS
ssh root@<IP_DA_VPS>

# Atualizar e instalar utilitários
apt update && apt upgrade -y
apt install -y curl git ufw nginx certbot python3-certbot-nginx

# Docker + Compose
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose-plugin

# Firewall
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# 4 GB de swap (segurança em picos de memória)
fallocate -l 4G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

---

## PARTE B — Subir o Supabase self-hosted

```bash
mkdir -p /opt && cd /opt
git clone --depth 1 https://github.com/supabase/supabase
cp -r supabase/docker /opt/supabase-docpay
cd /opt/supabase-docpay
cp .env.example .env
```

Gerar segredos:

```bash
# JWT secret (40+ chars)
openssl rand -base64 48

# ANON_KEY e SERVICE_ROLE_KEY: gere em https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys
# usando o JWT_SECRET acima.
```

Editar `/opt/supabase-docpay/.env` com pelo menos:

```env
COMPOSE_PROJECT_NAME=docpay
POSTGRES_DB=docpay
POSTGRES_PASSWORD=<senha-forte>

JWT_SECRET=<jwt-gerado>
ANON_KEY=<anon-gerado>
SERVICE_ROLE_KEY=<service-role-gerado>

KONG_HTTP_PORT=8000
KONG_HTTPS_PORT=8443

SITE_URL=https://docpay.seudominio.com
API_EXTERNAL_URL=https://api-docpay.seudominio.com
SUPABASE_PUBLIC_URL=https://api-docpay.seudominio.com

DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=<senha-do-studio>
```

Subir:

```bash
cd /opt/supabase-docpay
docker compose pull
docker compose up -d
docker compose ps   # todos devem ficar "Up (healthy)"
```

O container do Postgres ficará com o nome **`docpay-db`** (prefixo do `COMPOSE_PROJECT_NAME`).

---

## PARTE C — Exportar TUDO do Supabase Cloud

> Rodar **na sua máquina local**. Requer `pg_dump` versão 15 ou superior (`brew install postgresql@15` no macOS, `apt install postgresql-client-15` no Ubuntu).
>
> Pegue a connection string em: **Supabase Dashboard → Project Settings → Database → Connection string** (modo **Session**, formato URI). Substitua `SENHA` e `REGIAO`.

```bash
# 1) Definir a URL do banco Cloud
export CLOUD_URL="postgresql://postgres.zouizzfomwrxfptgxkwj:SENHA@aws-0-REGIAO.pooler.supabase.com:5432/postgres"

# 2) Estrutura + dados do schema public (todo o app)
pg_dump "$CLOUD_URL" \
  --schema=public \
  --no-owner --no-privileges --no-comments \
  --quote-all-identifiers \
  -f backup_public.sql

# 3) Usuários (logins e senhas hash)
pg_dump "$CLOUD_URL" \
  --data-only --table=auth.users \
  --column-inserts --no-owner --no-privileges \
  -f backup_auth_users.sql

# 4) Identidades (vínculos email/OAuth)
pg_dump "$CLOUD_URL" \
  --data-only --table=auth.identities \
  --column-inserts --no-owner --no-privileges \
  -f backup_auth_identities.sql

# 5) Conferir
ls -lh backup_*.sql
```

Esses **3 arquivos = 100%** do que você precisa para migrar (app + usuários).

---

## PARTE D — Enviar os dumps para a VPS

Da sua máquina local:

```bash
scp backup_public.sql backup_auth_users.sql backup_auth_identities.sql \
    root@<IP_DA_VPS>:/opt/supabase-docpay/
```

---

## PARTE E — Importar no database `docpay`

Na VPS, via SSH:

```bash
cd /opt/supabase-docpay

# 1) Parar serviços que leem o banco (o Postgres continua rodando)
docker compose stop kong auth rest realtime functions storage

# 2) Resetar o schema public e importar estrutura + dados
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

---

## PARTE F — Garantir `user_roles` e o primeiro admin

```bash
# Conferir se a tabela existe (veio no backup_public.sql)
docker exec docpay-db psql -U postgres -d docpay \
  -c "\d public.user_roles"

# Promover seu usuário a admin (troque o email)
docker exec docpay-db psql -U postgres -d docpay <<'SQL'
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role FROM auth.users WHERE email = 'voce@empresa.com'
ON CONFLICT (user_id, role) DO NOTHING;
SQL
```

---

## PARTE G — Aplicar migrations futuras

Sempre que o Lovable gerar uma nova migration em `supabase/migrations/`:

```bash
# Copiar para a VPS
scp supabase/migrations/NOVO_ARQUIVO.sql root@<IP>:/opt/supabase-docpay/

# Aplicar
docker exec -i docpay-db psql -U postgres -d docpay -v ON_ERROR_STOP=1 \
  --single-transaction < /opt/supabase-docpay/NOVO_ARQUIVO.sql

# Recarregar API
docker exec docpay-db psql -U postgres -d docpay \
  -c "NOTIFY pgrst, 'reload schema';"
```

---

## PARTE H — Edge Functions na VPS

```bash
# Copiar pasta de funções do projeto local
scp -r supabase/functions/* root@<IP>:/opt/supabase-docpay/volumes/functions/

# Reiniciar runtime
cd /opt/supabase-docpay
docker compose restart functions
docker compose logs -f functions   # acompanhar
```

Secrets das funções vão no mesmo `.env` do stack (a função lê com `Deno.env.get('NOME')`).

---

## PARTE I — Variáveis no Vercel

Painel do Vercel → **Settings → Environment Variables**:

```
VITE_SUPABASE_URL=https://api-docpay.seudominio.com
VITE_SUPABASE_PUBLISHABLE_KEY=<ANON_KEY da PARTE B>
VITE_SUPABASE_PROJECT_ID=docpay
```

Redeploy.

---

## PARTE J — Nginx + HTTPS

```bash
cat > /etc/nginx/sites-available/api-docpay <<'NGINX'
server {
    listen 80;
    server_name api-docpay.seudominio.com;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX

ln -s /etc/nginx/sites-available/api-docpay /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# DNS: criar um A record api-docpay → IP da VPS, depois:
certbot --nginx -d api-docpay.seudominio.com
```

---

## PARTE K — Backup automático diário

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

Para restaurar um backup:

```bash
gunzip -c /opt/backups/docpay/docpay_YYYYMMDD_HHMM.sql.gz | \
  docker exec -i docpay-db psql -U postgres -d docpay
```

---

## PARTE L — Checklist de validação

1. `docker compose ps` → todos `Up (healthy)`
2. Contagens iguais Cloud vs VPS:
   ```bash
   docker exec docpay-db psql -U postgres -d docpay -c "SELECT count(*) FROM funcionarios;"
   docker exec docpay-db psql -U postgres -d docpay -c "SELECT count(*) FROM auth.users;"
   ```
3. API respondendo:
   ```bash
   curl https://api-docpay.seudominio.com/rest/v1/empresas \
     -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
   ```
4. Login na app do Vercel funciona com um usuário antigo
5. Edge function de teste:
   ```bash
   curl https://api-docpay.seudominio.com/functions/v1/check-ip \
     -H "Authorization: Bearer $ANON_KEY"
   ```

---

## PARTE M — Dimensionamento e custos (Hostinger)

| Plano | RAM | Indicado para |
|---|---|---|
| KVM 1 | 4 GB | testes / staging |
| **KVM 2** | **8 GB** | **produção docpay (recomendado)** |
| KVM 4 | 16 GB | crescimento futuro |

O stack Supabase consome ~3–4 GB de RAM com uso normal. KVM 2 dá folga confortável + swap configurado na PARTE A.

---

## Solução de problemas

| Sintoma | Causa provável | Correção |
|---|---|---|
| `permission denied for table` | faltou GRANT após import | reexecutar bloco de GRANTs da PARTE E |
| PostgREST não vê nova tabela | cache de schema | `NOTIFY pgrst, 'reload schema'` |
| Login falha após import | `auth.identities` não importado | rodar passo 3 da PARTE E |
| 502 no subdomínio | Kong fora do ar | `docker compose ps` + `docker compose logs kong` |
| Container DB não chama `docpay-db` | `COMPOSE_PROJECT_NAME` errado | corrigir `.env` e `docker compose up -d` |
