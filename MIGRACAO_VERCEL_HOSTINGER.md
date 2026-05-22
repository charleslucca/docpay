# Guia Completo de Migração — Frontend no Vercel + Banco/Backend na VPS Hostinger (Docker)

> **Para quem nunca mexeu com servidor.** Cada bloco de código é para **copiar e colar**. Onde aparecer `<ALGO>` você troca pelo seu valor.
>
> **Arquitetura final:**
> - **Vercel** hospeda o site React (atualiza sozinho a cada commit no GitHub).
> - **VPS Hostinger (Ubuntu + Docker)** roda o Supabase self-hosted: Postgres + Auth + PostgREST + Edge Functions.
> - **Sem Storage do Supabase** — o app gera ZIPs no navegador.

```
 Navegador  ───▶  Vercel (React)  ───▶  api.seudominio.com (VPS) ───▶  Docker: Postgres + Auth + PostgREST + Functions
```

---

## PARTE A — Preparar a VPS Hostinger

### A.1 Contratar a VPS
1. Painel Hostinger → **VPS** → **KVM 2** (2 vCPU, 8 GB RAM, 100 GB).
2. SO: **Ubuntu 22.04 LTS**.
3. Anote **IP público** e **senha de root**.

### A.2 Conectar via SSH
No seu PC (Windows: PowerShell; Mac/Linux: Terminal):
```bash
ssh root@<IP_DA_VPS>
```

### A.3 Instalar tudo o que precisamos
```bash
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose-plugin git ufw nginx certbot python3-certbot-nginx postgresql-client
```

### A.4 Firewall
```bash
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
```

### A.5 Apontar o domínio
No seu provedor de DNS, crie um registro **A**:
- `api.seudominio.com` → `<IP_DA_VPS>`

Aguarde 5–30 min. Teste: `ping api.seudominio.com` deve responder com o IP da VPS.

---

## PARTE B — Subir o Supabase self-hosted (sem Storage)

### B.1 Clonar o repositório oficial
```bash
mkdir -p /opt && cd /opt
git clone --depth 1 https://github.com/supabase/supabase.git
cd supabase/docker
cp .env.example .env
```

### B.2 Gerar senhas fortes
```bash
openssl rand -base64 48   # use como POSTGRES_PASSWORD
openssl rand -base64 64   # use como JWT_SECRET
```
Anote os dois valores.

### B.3 Gerar `ANON_KEY` e `SERVICE_ROLE_KEY`
Acesse <https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys>, cole o **JWT_SECRET** que você gerou em B.2, e copie os dois tokens gerados.

### B.4 Editar o `.env`
```bash
nano /opt/supabase/docker/.env
```
Preencha pelo menos:
```
POSTGRES_PASSWORD=<senha de B.2>
JWT_SECRET=<jwt secret de B.2>
ANON_KEY=<token público de B.3>
SERVICE_ROLE_KEY=<token secreto de B.3>

SITE_URL=https://docpay.vercel.app
API_EXTERNAL_URL=https://api.seudominio.com
SUPABASE_PUBLIC_URL=https://api.seudominio.com

DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=<senha forte>
```
Salve: `Ctrl+O`, `Enter`, `Ctrl+X`.

### B.5 Remover o Storage (não usamos)
```bash
nano /opt/supabase/docker/docker-compose.yml
```
Comente/apague os blocos `storage:` e `imgproxy:` inteiros. Depois:
```bash
nano /opt/supabase/docker/volumes/api/kong.yml
```
Remova as linhas que mencionam `/storage/v1/`. Salve.

### B.6 Subir os containers
```bash
cd /opt/supabase/docker
docker compose up -d
docker compose ps
```
Todos devem estar `running` ou `healthy`.

### B.7 Nginx + HTTPS
```bash
cat > /etc/nginx/sites-available/supabase <<'EOF'
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
EOF
ln -s /etc/nginx/sites-available/supabase /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d api.seudominio.com
```
Responda **Yes** ao redirecionamento HTTPS. Teste:
```bash
curl -i https://api.seudominio.com/auth/v1/health
```
Deve retornar `200 OK`.

---

## PARTE C — Exportar o banco do Supabase Cloud (origem)

### C.1 Instalar `pg_dump` no seu PC
- **Windows**: <https://www.postgresql.org/download/windows/> (só as command line tools).
- **Mac**: `brew install libpq && brew link --force libpq`
- **Linux**: `sudo apt install postgresql-client`

### C.2 Pegar a senha do banco atual
Em <https://supabase.com/dashboard/project/zouizzfomwrxfptgxkwj/settings/database> copie a senha do Postgres.

### C.3 Gerar DOIS dumps (no seu PC, NÃO na VPS)

> **Por que dois arquivos?** Exportar o schema `auth` inteiro tenta criar roles internas (`supabase_auth_admin`) que não existem no self-hosted e quebra o import. A abordagem segura é: schema `public` completo + **só os dados** de `auth.users` e `auth.identities`.

**Dump 1 — schema public completo:**
```bash
pg_dump "postgresql://postgres:<SENHA>@db.zouizzfomwrxfptgxkwj.supabase.co:5432/postgres" \
  --schema=public \
  --no-owner --no-privileges --no-comments \
  -f backup_public.sql
```

**Dump 2 — dados de autenticação:**
```bash
pg_dump "postgresql://postgres:<SENHA>@db.zouizzfomwrxfptgxkwj.supabase.co:5432/postgres" \
  --data-only \
  --table=auth.users --table=auth.identities \
  --column-inserts \
  --no-owner --no-privileges --no-comments \
  -f backup_auth_users.sql
```

**O que cada flag faz:**
- `--no-owner --no-privileges` — ignora donos/permissões da nuvem (não existem na VPS).
- `--no-comments` — evita `COMMENT ON EXTENSION` que pede superuser.
- **Não usamos `--clean`** — ele destrói triggers internos do Supabase self-hosted.
- `--column-inserts` — gera `INSERT` em vez de `COPY`, mais resiliente.

---

## PARTE D — Limpar parâmetros incompatíveis (OBRIGATÓRIO)

> **Por quê?** O Postgres do Supabase Cloud (15+) adiciona `SET transaction_timeout = 0;` no topo do dump. A versão dentro do container (15.1) **não conhece** esse parâmetro e aborta com:
> `ERROR: unrecognized configuration parameter "transaction_timeout"`

Faça para **os dois arquivos**.

**Linux / Mac:**
```bash
cp backup_public.sql backup_public.original.sql
cp backup_auth_users.sql backup_auth_users.original.sql
sed -i.bak '/transaction_timeout/d' backup_public.sql
sed -i.bak '/transaction_timeout/d' backup_auth_users.sql
grep -c "transaction_timeout" backup_public.sql backup_auth_users.sql
```
Os dois números devem ser `0`.

**Windows (PowerShell):**
```powershell
Copy-Item backup_public.sql backup_public.original.sql
Copy-Item backup_auth_users.sql backup_auth_users.original.sql
(Get-Content backup_public.sql) | Where-Object { $_ -notmatch 'transaction_timeout' } | Set-Content backup_public_clean.sql
(Get-Content backup_auth_users.sql) | Where-Object { $_ -notmatch 'transaction_timeout' } | Set-Content backup_auth_users_clean.sql
Select-String -Path backup_public_clean.sql,backup_auth_users_clean.sql -Pattern "transaction_timeout"
```
Se o último comando **não imprimir nada**, está limpo. No Windows, use os arquivos `_clean.sql` daqui em diante.

> Se aparecer outro `unrecognized configuration parameter "<nome>"`, repita o mesmo `sed`/filtro trocando o nome.

---

## PARTE E — Importar na VPS (ordem importa)

### E.1 Enviar os arquivos para a VPS
No seu PC:
```bash
scp backup_public.sql backup_auth_users.sql root@<IP_DA_VPS>:/opt/supabase/
```

### E.2 Parar os serviços que falam com o banco
Na VPS:
```bash
cd /opt/supabase/docker
docker compose stop kong auth rest functions realtime
```

### E.3 Importar o schema public
```bash
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction < /opt/supabase/backup_public.sql
```
Mensagens `CREATE TABLE`, `ALTER TABLE`, `COPY 679`, `NOTICE:` **não são erros**. Só `ERROR:` interrompe.

### E.4 Importar usuários do Auth
```bash
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "TRUNCATE TABLE auth.users CASCADE;"
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction < /opt/supabase/backup_auth_users.sql
```

### E.5 Reaplicar GRANTs (essencial)
```bash
docker exec -i supabase-db psql -U postgres -d postgres <<'SQL'
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
SQL
```

### E.6 Religar os serviços
```bash
docker compose start kong auth rest functions realtime
docker compose ps
```

### E.7 Conferir contagens
```bash
docker exec -it supabase-db psql -U postgres -c "SELECT count(*) FROM auth.users;"
docker exec -it supabase-db psql -U postgres -c "SELECT count(*) FROM public.profiles;"
docker exec -it supabase-db psql -U postgres -c "SELECT count(*) FROM public.funcionarios;"
docker exec -it supabase-db psql -U postgres -c "SELECT count(*) FROM public.user_roles;"
```
Compare com o Supabase Cloud (SQL Editor).

---

## PARTE F — Corrigir `user_roles` vazio

> Caso clássico: `user_roles` retornou **0** mesmo com `auth.users` e `profiles` preenchidos. Existem dois cenários.

### F.1 Verificar a origem
No **Supabase Cloud** (SQL Editor):
```sql
SELECT count(*) FROM public.user_roles;
```

### F.2 Cenário A — Cloud tem roles, VPS não tem
No seu PC:
```bash
pg_dump "postgresql://postgres:<SENHA>@db.zouizzfomwrxfptgxkwj.supabase.co:5432/postgres" \
  --data-only \
  --table=public.profiles --table=public.user_roles \
  --column-inserts \
  --no-owner --no-privileges --no-comments \
  -f backup_roles.sql
sed -i.bak '/transaction_timeout/d' backup_roles.sql
scp backup_roles.sql root@<IP_DA_VPS>:/opt/supabase/
```
Na VPS:
```bash
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "TRUNCATE TABLE public.user_roles, public.profiles CASCADE;"
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction < /opt/supabase/backup_roles.sql
docker exec -it supabase-db psql -U postgres -c "SELECT count(*) FROM public.user_roles;"
```

### F.3 Cenário B — Cloud também está vazio
Você precisa criar pelo menos um admin manualmente. Descubra o UUID:
```bash
docker exec -it supabase-db psql -U postgres -c "SELECT id, email FROM auth.users;"
```
Insira o admin:
```bash
docker exec -it supabase-db psql -U postgres -c "INSERT INTO public.user_roles (user_id, role) VALUES ('<UUID_DO_SEU_USUARIO>', 'admin');"
```

---

## PARTE G — Migrations futuras

Toda vez que o Lovable criar um arquivo novo em `supabase/migrations/`, no seu PC:
```bash
scp supabase/migrations/<NOVA_MIGRATION>.sql root@<IP_DA_VPS>:/tmp/
ssh root@<IP_DA_VPS> "sed -i '/transaction_timeout/d' /tmp/<NOVA_MIGRATION>.sql && docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction < /tmp/<NOVA_MIGRATION>.sql"
```

---

## PARTE H — Deploy das Edge Functions

O projeto tem 2 funções: `admin-create-user` e `check-ip`.

### H.1 Copiar do seu PC para a VPS
```bash
scp -r supabase/functions/admin-create-user root@<IP_DA_VPS>:/opt/supabase/docker/volumes/functions/
scp -r supabase/functions/check-ip          root@<IP_DA_VPS>:/opt/supabase/docker/volumes/functions/
```

### H.2 Garantir secrets das functions no `.env`
```
SUPABASE_URL=https://api.seudominio.com
SUPABASE_ANON_KEY=<ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
```

### H.3 Reiniciar
```bash
cd /opt/supabase/docker
docker compose up -d
docker compose restart functions
```

### H.4 Testar
```bash
curl -i https://api.seudominio.com/functions/v1/check-ip -H "Authorization: Bearer <ANON_KEY>"
```

---

## PARTE I — Publicar o frontend no Vercel

### I.1 GitHub
Confirme que o último commit do Lovable está no seu repositório GitHub.

### I.2 Importar no Vercel
1. <https://vercel.com> → **Add New… → Project** → importe o repo.
2. **Framework**: Vite. **Build**: `npm run build`. **Output**: `dist`.

### I.3 Variáveis de ambiente
| Nome | Valor |
|---|---|
| `VITE_SUPABASE_URL` | `https://api.seudominio.com` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `<ANON_KEY da VPS>` |
| `VITE_SUPABASE_PROJECT_ID` | `docpay` |

Clique **Deploy**.

### I.4 Liberar o domínio do Vercel no Supabase
Na VPS, edite `/opt/supabase/docker/.env`:
```
SITE_URL=https://<projeto>.vercel.app
ADDITIONAL_REDIRECT_URLS=https://<projeto>.vercel.app
```
Reinicie:
```bash
cd /opt/supabase/docker && docker compose up -d
```

---

## PARTE J — Checklist final

- [ ] `curl https://api.seudominio.com/auth/v1/health` → 200
- [ ] Login funciona no app do Vercel
- [ ] `SELECT count(*) FROM auth.users` bate com o Cloud
- [ ] `SELECT count(*) FROM public.user_roles` ≥ 1 admin
- [ ] Página Admin lista funcionários (RLS ok)
- [ ] `check-ip` bloqueia IP fora da whitelist
- [ ] Geração de ZIP de holerites funciona

---

## PARTE K — Backup automático diário

Na VPS:
```bash
cat > /opt/supabase/backup.sh <<'EOF'
#!/usr/bin/env bash
set -e
DATE=$(date +%Y%m%d_%H%M)
OUT=/opt/backups
mkdir -p $OUT
docker exec supabase-db pg_dump -U postgres postgres | gzip > $OUT/db_$DATE.sql.gz
find $OUT -name "db_*.sql.gz" -mtime +14 -delete
EOF
chmod +x /opt/supabase/backup.sh
(crontab -l 2>/dev/null; echo "0 3 * * * /opt/supabase/backup.sh") | crontab -
```
Todo dia às 3h o banco é salvo em `/opt/backups`, com 14 dias de histórico.

---

## PARTE L — Rollback (plano B)

Se algo der errado nos primeiros dias:
1. No Vercel → **Settings → Environment Variables** → volte `VITE_SUPABASE_URL` para `https://zouizzfomwrxfptgxkwj.supabase.co` e a `VITE_SUPABASE_PUBLISHABLE_KEY` para a anon key original do Cloud.
2. **Redeploy** no Vercel.
3. O app volta a usar o Supabase Cloud.

Mantenha o Supabase Cloud ativo por **15 dias** após o cutover.

---

## PARTE M — Custos e Glossário

| Item | Mensal |
|---|---|
| Hostinger VPS KVM 2 | R$ 40–60 |
| Vercel Hobby | Grátis |
| Domínio `.com.br` | ~R$ 40/ano |
| **Total** | **~R$ 50/mês** |

**Glossário:**
- **VPS** — servidor virtual na nuvem.
- **SSH** — acesso seguro à VPS pelo terminal.
- **Docker** — roda programas em "caixinhas" isoladas (containers).
- **Edge Function** — código que roda no servidor sob demanda.
- **RLS** — Row Level Security, regras do Postgres por linha.
- **CORS** — quais sites podem chamar seu backend.