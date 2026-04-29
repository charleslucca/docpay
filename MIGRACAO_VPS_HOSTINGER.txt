# Guia de Migração: Supabase Cloud → VPS Hostinger

> Versão sem Storage. PDFs gerados são entregues como ZIP local; planilhas Excel originais não são mais persistidas.

---

## 1. Visão geral da arquitetura

**Hoje (Supabase Cloud):**
- PostgreSQL gerenciado + Auth + Edge Functions (Deno) + RLS.
- Frontend React/Vite hospedado no Lovable.
- Sem Storage (removido).

**Alvo (VPS Hostinger):**
- 1 VPS (mín. 2 vCPU / 4 GB RAM / 40 GB SSD — KVM 2 da Hostinger é suficiente).
- Stack via Docker Compose:
  - **Supabase self-hosted** (Postgres + GoTrue + PostgREST + Kong + Studio) — sem o serviço `storage-api`.
  - **Edge Runtime** (Deno) para as funções `admin-create-user` e `check-ip`.
  - **Nginx** + **Certbot** (TLS Let's Encrypt) como reverse proxy.
  - Frontend buildado servido por Nginx (estático).

---

## 2. Pré-requisitos

- VPS Ubuntu 22.04 LTS.
- Domínio apontado (ex.: `app.seudominio.com` para o frontend e `api.seudominio.com` para Supabase).
- Acesso SSH como root.
- Backup recente do projeto Supabase Cloud atual.

---

## 3. Provisionamento do VPS

```bash
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose-plugin git ufw nginx certbot python3-certbot-nginx
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```

---

## 4. Exportar dados do Supabase Cloud

### 4.1 Schema + dados (PostgreSQL)

No seu computador local:

```bash
export SRC="postgresql://postgres:[SENHA]@db.zouizzfomwrxfptgxkwj.supabase.co:5432/postgres"

pg_dump "$SRC" \
  --schema=public --schema=auth \
  --no-owner --no-privileges \
  --clean --if-exists \
  -f backup_supabase.sql
```

### 4.2 Edge Functions

Já versionadas em `supabase/functions/` (`admin-create-user`, `check-ip`). Não precisam de export.

### 4.3 Secrets

Liste em **Project Settings → Edge Functions → Secrets** e anote para recriar no `.env` do VPS:
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e quaisquer secrets customizados.

---

## 5. Subir Supabase self-hosted no VPS (sem Storage)

```bash
mkdir -p /opt/supabase && cd /opt/supabase
git clone --depth 1 https://github.com/supabase/supabase.git
cd supabase/docker
cp .env.example .env
```

### 5.1 Editar `.env`

```bash
openssl rand -base64 48     # POSTGRES_PASSWORD
openssl rand -base64 64     # JWT_SECRET
```

```
POSTGRES_PASSWORD=<gerado>
JWT_SECRET=<gerado>
ANON_KEY=<gerar conforme docs Supabase self-hosting>
SERVICE_ROLE_KEY=<idem>
SITE_URL=https://app.seudominio.com
API_EXTERNAL_URL=https://api.seudominio.com
SUPABASE_PUBLIC_URL=https://api.seudominio.com
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=<senha forte>
SMTP_*=<seu provedor de e-mail>
```

### 5.2 Remover Storage do compose

Edite `docker-compose.yml` e **remova** os serviços `storage` e `imgproxy`. Em `volumes/api/kong.yml`, remova as rotas `/storage/v1/*`.

### 5.3 Subir

```bash
docker compose up -d
docker compose ps
```

---

## 6. Importar dados

```bash
scp backup_supabase.sql root@<VPS_IP>:/opt/supabase/
docker exec -i supabase-db psql -U postgres -d postgres < /opt/supabase/backup_supabase.sql

docker exec -it supabase-db psql -U postgres -c "\dt public.*"
docker exec -it supabase-db psql -U postgres -c "SELECT count(*) FROM auth.users;"
```

---

## 7. Deploy das Edge Functions

```bash
mkdir -p /opt/supabase/supabase/docker/volumes/functions/admin-create-user
mkdir -p /opt/supabase/supabase/docker/volumes/functions/check-ip

scp supabase/functions/admin-create-user/index.ts root@<VPS_IP>:/opt/supabase/supabase/docker/volumes/functions/admin-create-user/
scp supabase/functions/check-ip/index.ts          root@<VPS_IP>:/opt/supabase/supabase/docker/volumes/functions/check-ip/

docker compose restart functions
```

Teste:
```bash
curl -i https://api.seudominio.com/functions/v1/check-ip -H "Authorization: Bearer <ANON_KEY>"
```

---

## 8. Nginx + TLS

`/etc/nginx/sites-available/supabase`:

```nginx
server {
  server_name api.seudominio.com;
  client_max_body_size 50M;
  location / {
    proxy_pass http://localhost:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
server {
  server_name app.seudominio.com;
  root /var/www/docpay;
  index index.html;
  location / { try_files $uri $uri/ /index.html; }
}
```

```bash
ln -s /etc/nginx/sites-available/supabase /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d api.seudominio.com -d app.seudominio.com
```

---

## 9. Build e deploy do frontend

```bash
# .env de produção
VITE_SUPABASE_URL=https://api.seudominio.com
VITE_SUPABASE_PUBLISHABLE_KEY=<ANON_KEY do VPS>
VITE_SUPABASE_PROJECT_ID=docpay

npm ci && npm run build
scp -r dist/* root@<VPS_IP>:/var/www/docpay/
```

---

## 10. Checklist pós-migração

- [ ] Login funciona com usuário existente.
- [ ] RLS ativa nas tabelas principais.
- [ ] Edge function `check-ip` bloqueia IP fora da whitelist.
- [ ] Upload de planilha + processamento de PDFs ok.
- [ ] Geração de ZIP de holerites consolidados ok.

---

## 11. Backup automático

`/opt/supabase/backup.sh`:
```bash
#!/usr/bin/env bash
set -e
DATE=$(date +%Y%m%d_%H%M)
OUT=/opt/backups
mkdir -p $OUT
docker exec supabase-db pg_dump -U postgres postgres | gzip > $OUT/db_$DATE.sql.gz
find $OUT -name "db_*.sql.gz" -mtime +14 -delete
```

```bash
chmod +x /opt/supabase/backup.sh
(crontab -l 2>/dev/null; echo "0 3 * * * /opt/supabase/backup.sh") | crontab -
```

> Sem Storage para fazer backup — apenas Postgres (~50-200 MB).

---

## 12. Custos estimados (Hostinger)

| Plano | vCPU | RAM | Disco | Preço aprox./mês |
|---|---|---|---|---|
| KVM 2 | 2 | 8 GB | 100 GB NVMe | R$ 40-60 |
| KVM 4 | 4 | 16 GB | 200 GB NVMe | R$ 80-120 |

Recomendado: **KVM 2** para começar.

---

## 13. Rollback

Mantenha o projeto Supabase Cloud ativo por **15 dias** após o cutover. Se algo falhar, reverta `VITE_SUPABASE_URL` no frontend e redeploye. O dump original (`backup_supabase.sql`) é o ponto de restauração.
