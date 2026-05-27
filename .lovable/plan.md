## Objetivo

Reescrever `MIGRACAO_VERCEL_HOSTINGER.md` para suportar **múltiplos apps na mesma VPS**, cada um com seu **stack Supabase isolado** (próprio Postgres, Auth, Kong, PostgREST, Functions) e database nomeado conforme o app — começando por **`docpay`**. Cada novo app no futuro segue exatamente o mesmo passo a passo, trocando só o nome (`docpay` → `app2`).

## Princípio de isolamento

```text
VPS Hostinger
├── /opt/supabase-docpay/   ← stack 1 (database: docpay)
│   └── docker-compose.yml  ← COMPOSE_PROJECT_NAME=docpay
│       containers: docpay-db, docpay-auth, docpay-kong, docpay-rest, docpay-functions
│       portas internas: kong 8000
│       Nginx: api-docpay.seudominio.com  →  127.0.0.1:8000
│
├── /opt/supabase-app2/     ← stack 2 (database: app2)  [futuro]
│   └── docker-compose.yml  ← COMPOSE_PROJECT_NAME=app2
│       containers: app2-db, app2-auth, app2-kong, ...
│       portas internas: kong 8010
│       Nginx: api-app2.seudominio.com   →  127.0.0.1:8010
```

Vantagens: zero conflito entre `auth.users`, backup/rollback independentes, derrubar 1 app não afeta o outro, RLS e JWT_SECRET isolados.

## Mudanças no documento

### Renomear placeholders e caminhos
- `/opt/supabase/` → **`/opt/supabase-docpay/`** em todas as partes.
- `api.seudominio.com` → **`api-docpay.seudominio.com`** (e padrão `api-<app>.seudominio.com`).
- Toda referência a `docker exec ... supabase-db` → **`docker exec ... docpay-db`**.
- Todo `psql -d postgres` → **`psql -d docpay`**.

### PARTE B — Subir Supabase (reescrita para multi-stack)

Novo subitem **B.0 Convenção de nomes** explicando o padrão `<app>` (slug minúsculo, sem hífen no nome do database).

**B.1 Clonar em pasta dedicada por app:**
```bash
mkdir -p /opt/supabase-docpay && cd /opt/supabase-docpay
git clone --depth 1 https://github.com/supabase/supabase.git .src
cp -r .src/docker/* .
cp .src/docker/.env.example .env
rm -rf .src
```

**B.4 `.env` ganha 3 variáveis novas (essenciais):**
```
COMPOSE_PROJECT_NAME=docpay      # prefixa todos os containers: docpay-db, docpay-kong...
POSTGRES_DB=docpay               # nome do database criado no init do Postgres
KONG_HTTP_PORT=8000              # próximo app usa 8010, 8020...
KONG_HTTPS_PORT=8443             # próximo app usa 8453, 8463...
```
Mais nota explicando que `POSTGRES_DB` é lido pela imagem oficial do Postgres do Supabase e cria o database já com esse nome no primeiro boot, em vez de usar o default `postgres`.

**B.5** continua igual (remover `storage:` e `imgproxy:`).

**B.6** vira:
```bash
cd /opt/supabase-docpay
docker compose up -d
docker compose ps   # nomes devem aparecer como docpay-db, docpay-kong, etc.
```

**B.7** Nginx — bloco passa a usar `api-docpay.seudominio.com` e `proxy_pass http://localhost:8000`, e o guia mostra como duplicar o arquivo para o próximo app trocando subdomínio + porta.

### PARTE C — Exportar do Cloud (sem mudança no comando, mas com nota)

Adicionar nota no topo de C.3: "O dump vem do database `postgres` do Cloud, mas será importado no database `docpay` da VPS — a troca de nome é só no `psql` de destino (Parte E)."

### PARTE E — Importar (toda a parte muda de `postgres` → `docpay`)

**E.2** stop dos serviços do **stack docpay**:
```bash
cd /opt/supabase-docpay
docker compose stop kong auth rest functions realtime
```

**E.3** — `-d docpay` em todos os `psql` e nome do container atualizado:
```bash
docker exec -i docpay-db psql -U postgres -d docpay -v ON_ERROR_STOP=1 \
  -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
docker exec -i docpay-db psql -U postgres -d docpay -v ON_ERROR_STOP=1 --single-transaction \
  < /opt/supabase-docpay/backup_public.sql
```

**E.4, E.5, E.7** — todos os `psql` passam a usar `docpay-db` + `-d docpay`.

**Importante:** schema `auth` é criado pela imagem do Supabase **no database `docpay`** (porque `POSTGRES_DB=docpay`). O `TRUNCATE auth.users CASCADE` e o import do `backup_auth_users.sql` funcionam normalmente, apenas dentro de `docpay` em vez de `postgres`.

### PARTE F — `user_roles` vazio

Mesmos comandos, trocando `-d postgres` → `-d docpay` e `supabase-db` → `docpay-db`.

### PARTE G — Migrations futuras

Snippet vira:
```bash
scp supabase/migrations/<MIG>.sql root@<IP>:/tmp/
ssh root@<IP> "sed -i '/transaction_timeout/d' /tmp/<MIG>.sql && \
  docker exec -i docpay-db psql -U postgres -d docpay -v ON_ERROR_STOP=1 --single-transaction < /tmp/<MIG>.sql"
```

### PARTE H — Edge Functions

Caminhos passam para `/opt/supabase-docpay/volumes/functions/` e o restart é `docker compose restart functions` rodado dentro de `/opt/supabase-docpay`. Secrets do `.env` desse stack apontam para `https://api-docpay.seudominio.com`.

### PARTE I — Frontend Vercel

`VITE_SUPABASE_URL` = `https://api-docpay.seudominio.com`. `VITE_SUPABASE_PROJECT_ID=docpay` (já estava).

### PARTE K — Backup automático

Script vira por-stack e por-database:
```bash
cat > /opt/supabase-docpay/backup.sh <<'EOF'
#!/usr/bin/env bash
set -e
DATE=$(date +%Y%m%d_%H%M)
OUT=/opt/backups/docpay
mkdir -p $OUT
docker exec docpay-db pg_dump -U postgres -d docpay | gzip > $OUT/docpay_$DATE.sql.gz
find $OUT -name "docpay_*.sql.gz" -mtime +14 -delete
EOF
chmod +x /opt/supabase-docpay/backup.sh
(crontab -l 2>/dev/null; echo "0 3 * * * /opt/supabase-docpay/backup.sh") | crontab -
```
Nota: cada app futuro tem seu próprio `backup.sh` e sua pasta em `/opt/backups/<app>/`.

### NOVA PARTE N — Adicionar um segundo app (passo a passo)

Bloco curto no fim do documento, tipo receita:
1. Escolher slug (ex.: `app2`).
2. Repetir Parte B em `/opt/supabase-app2/`, com:
   - `COMPOSE_PROJECT_NAME=app2`
   - `POSTGRES_DB=app2`
   - `KONG_HTTP_PORT=8010`, `KONG_HTTPS_PORT=8453`
   - novo `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `POSTGRES_PASSWORD` (independentes!)
3. DNS: `api-app2.seudominio.com` → IP da VPS.
4. Nginx: copiar `/etc/nginx/sites-available/supabase-docpay` → `supabase-app2`, trocar `server_name` e `proxy_pass` para `8010`. `certbot --nginx -d api-app2.seudominio.com`.
5. Repetir Partes C–F apontando `psql` para `app2-db` / `-d app2`.
6. Cron de backup independente.

Tabela final mostrando o mapeamento:

| App | Pasta | Container DB | Database | Porta Kong | Subdomínio |
|---|---|---|---|---|---|
| docpay | /opt/supabase-docpay | docpay-db | docpay | 8000 | api-docpay.seudominio.com |
| app2 | /opt/supabase-app2 | app2-db | app2 | 8010 | api-app2.seudominio.com |

### PARTE M — Custos

Atualizar nota: cada stack adicional consome ~1.5–2 GB de RAM. KVM 2 (8 GB) comporta confortavelmente 2–3 stacks; acima disso, subir para KVM 4.

## Arquivos afetados

- `MIGRACAO_VERCEL_HOSTINGER.md` — reescrita completa com todas as substituições acima e nova Parte N.

Nenhum código da aplicação será tocado.
