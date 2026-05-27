# Guia Completo de Migração — Frontend no Vercel + Banco/Backend na VPS Hostinger (Docker)

> **Para quem nunca mexeu com servidor.** Cada bloco de código é para **copiar e colar**. Onde aparecer `<ALGO>` você troca pelo seu valor.
>
> **Arquitetura final:**
> - **Vercel** hospeda o site React (atualiza sozinho a cada commit no GitHub).
> - **VPS Hostinger (Ubuntu + Docker)** roda **um stack Supabase self-hosted por app** (Postgres + Auth + PostgREST + Edge Functions). O primeiro app se chama **`docpay`** e cada novo app futuro (`app2`, `app3`...) ganha seu próprio stack isolado seguindo o mesmo passo a passo.
> - **Sem Storage do Supabase** — o app gera ZIPs no navegador.

```
 Navegador ─▶ Vercel (React) ─▶ api-docpay.seudominio.com (VPS) ─▶ Stack docpay: docpay-db + docpay-auth + docpay-kong + docpay-functions
                                                                    │
                                                                    └─ (futuro) api-app2.seudominio.com ─▶ Stack app2: app2-db + app2-auth + ...
```

### Princípio de isolamento (multi-app)

Cada app vive numa pasta própria em `/opt/supabase-<app>/`, com **seu próprio Postgres**, **seu próprio database** (`docpay`, `app2`...), **seus próprios JWT/keys** e **seu próprio subdomínio**. Vantagens:
- Zero conflito entre `auth.users` de apps diferentes.
- Backup, restore e rollback independentes por app.
- Derrubar 1 stack não afeta os outros.

```text
/opt/supabase-docpay/   stack 1  database: docpay   kong: 8000   api-docpay.seudominio.com
/opt/supabase-app2/     stack 2  database: app2     kong: 8010   api-app2.seudominio.com   (futuro)
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
- `api-docpay.seudominio.com` → `<IP_DA_VPS>`

Aguarde 5–30 min. Teste: `ping api-docpay.seudominio.com` deve responder com o IP da VPS.

> Para cada app futuro crie um subdomínio análogo (`api-app2.seudominio.com`, etc.).

---

## PARTE B — Subir o stack Supabase do app `docpay` (sem Storage)

### B.0 Convenção de nomes (importante para multi-app)

Cada app recebe um **slug** minúsculo, sem hífen, sem acento. Esse slug é reutilizado em:
- Pasta: `/opt/supabase-<slug>/`
- `COMPOSE_PROJECT_NAME=<slug>` (prefixa containers: `<slug>-db`, `<slug>-kong`...)
- `POSTGRES_DB=<slug>` (nome do database criado já no primeiro boot)
- Subdomínio: `api-<slug>.seudominio.com`
- Porta interna Kong: começa em `8000` para o primeiro app e vai somando 10 (8010, 8020...) para os próximos.

Neste guia, `<slug> = docpay`.

### B.1 Clonar o repositório oficial
```bash
mkdir -p /opt/supabase-docpay && cd /opt/supabase-docpay
git clone --depth 1 https://github.com/supabase/supabase.git .src
cp -r .src/docker/. .
cp .src/docker/.env.example .env
rm -rf .src
```
Resultado: `/opt/supabase-docpay/docker-compose.yml`, `/opt/supabase-docpay/.env`, `/opt/supabase-docpay/volumes/`...

### B.2 Gerar senhas fortes
```bash
openssl rand -base64 48   # use como POSTGRES_PASSWORD
openssl rand -base64 64   # use como JWT_SECRET
```
Anote os dois valores. **Cada app futuro gera os seus próprios** — nunca reaproveite.

### B.3 Gerar `ANON_KEY` e `SERVICE_ROLE_KEY`
Acesse <https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys>, cole o **JWT_SECRET** que você gerou em B.2, e copie os dois tokens gerados.

### B.4 Editar o `.env`
```bash
nano /opt/supabase-docpay/.env
```
Preencha pelo menos (os 4 primeiros são **novos** e essenciais para o isolamento multi-app):
```
COMPOSE_PROJECT_NAME=docpay
POSTGRES_DB=docpay
KONG_HTTP_PORT=8000
KONG_HTTPS_PORT=8443

POSTGRES_PASSWORD=<senha de B.2>
JWT_SECRET=<jwt secret de B.2>
ANON_KEY=<token público de B.3>
SERVICE_ROLE_KEY=<token secreto de B.3>

SITE_URL=https://docpay.vercel.app
API_EXTERNAL_URL=https://api-docpay.seudominio.com
SUPABASE_PUBLIC_URL=https://api-docpay.seudominio.com

DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=<senha forte>
```
Salve: `Ctrl+O`, `Enter`, `Ctrl+X`.

> **Por quê esses 4?**
> - `COMPOSE_PROJECT_NAME=docpay` faz o Docker prefixar todos os containers com `docpay-` (em vez de `supabase-`), evitando colisão com stacks futuros.
> - `POSTGRES_DB=docpay` faz a imagem oficial do Postgres criar o database já chamado `docpay` no primeiro boot, em vez do default `postgres`.
> - `KONG_HTTP_PORT/KONG_HTTPS_PORT` precisam ser únicos por stack. Próximo app: `8010/8453`. Terceiro: `8020/8463`. Etc.

### B.5 Remover o Storage (não usamos)
```bash
nano /opt/supabase-docpay/docker-compose.yml
```
Comente/apague os blocos `storage:` e `imgproxy:` inteiros. Depois:
```bash
nano /opt/supabase-docpay/volumes/api/kong.yml
```
Remova as linhas que mencionam `/storage/v1/`. Salve.

### B.6 Subir os containers
```bash
cd /opt/supabase-docpay
docker compose up -d
docker compose ps
```
Todos devem estar `running` ou `healthy`. **Confirme** que os nomes aparecem como `docpay-db`, `docpay-kong`, `docpay-auth`, etc. — se aparecerem como `supabase-db`, o `COMPOSE_PROJECT_NAME` não foi lido (volte ao B.4).

### B.7 Nginx + HTTPS
```bash
cat > /etc/nginx/sites-available/supabase-docpay <<'EOF'
server {
  server_name api-docpay.seudominio.com;
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
ln -s /etc/nginx/sites-available/supabase-docpay /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d api-docpay.seudominio.com
```
Responda **Yes** ao redirecionamento HTTPS. Teste:
```bash
curl -i https://api-docpay.seudominio.com/auth/v1/health
```
Deve retornar `200 OK`.

> Para o próximo app, duplique o arquivo trocando `docpay` → `app2` e a porta `8000` → `8010`. Veja a **Parte N** no final.

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
>
> **Nome do database de origem x destino:** os dumps saem do database `postgres` do Cloud, mas serão importados no database **`docpay`** da VPS. Essa troca acontece só no `psql` da Parte E — o conteúdo dos arquivos é o mesmo.

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
scp backup_public.sql backup_auth_users.sql root@<IP_DA_VPS>:/opt/supabase-docpay/
```

### E.2 Parar os serviços que falam com o banco
Na VPS:
```bash
cd /opt/supabase-docpay
docker compose stop kong auth rest functions realtime
```

### E.3 Importar o schema public
```bash
docker exec -i docpay-db psql -U postgres -d docpay -v ON_ERROR_STOP=1 \
  -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
docker exec -i docpay-db psql -U postgres -d docpay -v ON_ERROR_STOP=1 --single-transaction \
  < /opt/supabase-docpay/backup_public.sql
```
Mensagens `CREATE TABLE`, `ALTER TABLE`, `COPY 679`, `NOTICE:` **não são erros**. Só `ERROR:` interrompe.

> O schema `auth` já existe **dentro do database `docpay`** porque a imagem oficial do Supabase roda os scripts de init em qualquer database definido por `POSTGRES_DB`. Por isso o `TRUNCATE auth.users` abaixo funciona normalmente.

### E.4 Importar usuários do Auth
```bash
docker exec -i docpay-db psql -U postgres -d docpay -v ON_ERROR_STOP=1 \
  -c "TRUNCATE TABLE auth.users CASCADE;"
docker exec -i docpay-db psql -U postgres -d docpay -v ON_ERROR_STOP=1 --single-transaction \
  < /opt/supabase-docpay/backup_auth_users.sql
```

### E.5 Reaplicar GRANTs (essencial)
```bash
docker exec -i docpay-db psql -U postgres -d docpay <<'SQL'
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
cd /opt/supabase-docpay
docker compose start kong auth rest functions realtime
docker compose ps
```

### E.7 Conferir contagens
```bash
docker exec -it docpay-db psql -U postgres -d docpay -c "SELECT count(*) FROM auth.users;"
docker exec -it docpay-db psql -U postgres -d docpay -c "SELECT count(*) FROM public.profiles;"
docker exec -it docpay-db psql -U postgres -d docpay -c "SELECT count(*) FROM public.funcionarios;"
docker exec -it docpay-db psql -U postgres -d docpay -c "SELECT count(*) FROM public.user_roles;"
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
scp backup_roles.sql root@<IP_DA_VPS>:/opt/supabase-docpay/
```
Na VPS:
```bash
docker exec -i docpay-db psql -U postgres -d docpay -v ON_ERROR_STOP=1 \
  -c "TRUNCATE TABLE public.user_roles, public.profiles CASCADE;"
docker exec -i docpay-db psql -U postgres -d docpay -v ON_ERROR_STOP=1 --single-transaction \
  < /opt/supabase-docpay/backup_roles.sql
docker exec -it docpay-db psql -U postgres -d docpay -c "SELECT count(*) FROM public.user_roles;"
```

### F.3 Cenário B — Cloud também está vazio
Você precisa criar pelo menos um admin manualmente. Descubra o UUID:
```bash
docker exec -it docpay-db psql -U postgres -d docpay -c "SELECT id, email FROM auth.users;"
```
Insira o admin:
```bash
docker exec -it docpay-db psql -U postgres -d docpay \
  -c "INSERT INTO public.user_roles (user_id, role) VALUES ('<UUID_DO_SEU_USUARIO>', 'admin');"
```

---

## PARTE G — Migrations futuras

Toda vez que o Lovable criar um arquivo novo em `supabase/migrations/`, no seu PC:
```bash
scp supabase/migrations/<NOVA_MIGRATION>.sql root@<IP_DA_VPS>:/tmp/
ssh root@<IP_DA_VPS> "sed -i '/transaction_timeout/d' /tmp/<NOVA_MIGRATION>.sql && \
  docker exec -i docpay-db psql -U postgres -d docpay -v ON_ERROR_STOP=1 --single-transaction \
  < /tmp/<NOVA_MIGRATION>.sql"
```

---

## PARTE H — Deploy das Edge Functions

O projeto tem 2 funções: `admin-create-user` e `check-ip`.

### H.1 Copiar do seu PC para a VPS
```bash
scp -r supabase/functions/admin-create-user root@<IP_DA_VPS>:/opt/supabase-docpay/volumes/functions/
scp -r supabase/functions/check-ip          root@<IP_DA_VPS>:/opt/supabase-docpay/volumes/functions/
```

### H.2 Garantir secrets das functions no `.env` do stack
Edite `/opt/supabase-docpay/.env`:
```
SUPABASE_URL=https://api-docpay.seudominio.com
SUPABASE_ANON_KEY=<ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
```

### H.3 Reiniciar
```bash
cd /opt/supabase-docpay
docker compose up -d
docker compose restart functions
```

### H.4 Testar
```bash
curl -i https://api-docpay.seudominio.com/functions/v1/check-ip -H "Authorization: Bearer <ANON_KEY>"
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
| `VITE_SUPABASE_URL` | `https://api-docpay.seudominio.com` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `<ANON_KEY da VPS>` |
| `VITE_SUPABASE_PROJECT_ID` | `docpay` |

Clique **Deploy**.

### I.4 Liberar o domínio do Vercel no Supabase
Na VPS, edite `/opt/supabase-docpay/.env`:
```
SITE_URL=https://<projeto>.vercel.app
ADDITIONAL_REDIRECT_URLS=https://<projeto>.vercel.app
```
Reinicie:
```bash
cd /opt/supabase-docpay && docker compose up -d
```

---

## PARTE J — Checklist final

- [ ] `curl https://api-docpay.seudominio.com/auth/v1/health` → 200
- [ ] Login funciona no app do Vercel
- [ ] `SELECT count(*) FROM auth.users` em `docpay` bate com o Cloud
- [ ] `SELECT count(*) FROM public.user_roles` em `docpay` ≥ 1 admin
- [ ] Página Admin lista funcionários (RLS ok)
- [ ] `check-ip` bloqueia IP fora da whitelist
- [ ] Geração de ZIP de holerites funciona

---

## PARTE K — Backup automático diário (por app)

Na VPS, **um script por stack**:
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
Todo dia às 3h o database `docpay` é salvo em `/opt/backups/docpay/`, com 14 dias de histórico. Cada app futuro ganha seu próprio `backup.sh` e sua própria pasta em `/opt/backups/<app>/`.

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

**Consumo por stack:** cada Supabase self-hosted gasta ~1.5–2 GB de RAM. Uma VPS KVM 2 (8 GB) comporta confortavelmente **2 a 3 stacks**. A partir do 4º app, suba para KVM 4 (16 GB).

**Glossário:**
- **VPS** — servidor virtual na nuvem.
- **SSH** — acesso seguro à VPS pelo terminal.
- **Docker** — roda programas em "caixinhas" isoladas (containers).
- **Stack** — conjunto de containers que formam um Supabase completo (db + auth + kong + rest + functions).
- **Edge Function** — código que roda no servidor sob demanda.
- **RLS** — Row Level Security, regras do Postgres por linha.
- **CORS** — quais sites podem chamar seu backend.

---

## PARTE N — Adicionar um segundo app (receita)

Suponha que você queira adicionar o app `app2` na mesma VPS. Repita os passos abaixo trocando `app2` pelo slug real.

### N.1 DNS
Crie um registro **A**: `api-app2.seudominio.com` → `<IP_DA_VPS>`.

### N.2 Pasta + clone
```bash
mkdir -p /opt/supabase-app2 && cd /opt/supabase-app2
git clone --depth 1 https://github.com/supabase/supabase.git .src
cp -r .src/docker/. .
cp .src/docker/.env.example .env
rm -rf .src
```

### N.3 `.env` do `app2` (note as portas e o nome trocados)
```bash
nano /opt/supabase-app2/.env
```
```
COMPOSE_PROJECT_NAME=app2
POSTGRES_DB=app2
KONG_HTTP_PORT=8010
KONG_HTTPS_PORT=8453

POSTGRES_PASSWORD=<NOVA senha — openssl rand -base64 48>
JWT_SECRET=<NOVO jwt — openssl rand -base64 64>
ANON_KEY=<NOVO token gerado a partir do novo JWT>
SERVICE_ROLE_KEY=<NOVO token gerado a partir do novo JWT>

SITE_URL=https://app2.vercel.app
API_EXTERNAL_URL=https://api-app2.seudominio.com
SUPABASE_PUBLIC_URL=https://api-app2.seudominio.com

DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=<senha forte e diferente da do docpay>
```
Repita B.5 (remover storage/imgproxy).

### N.4 Subir
```bash
cd /opt/supabase-app2
docker compose up -d
docker compose ps   # deve mostrar app2-db, app2-kong, app2-auth...
```

### N.5 Nginx + HTTPS
```bash
cp /etc/nginx/sites-available/supabase-docpay /etc/nginx/sites-available/supabase-app2
sed -i 's/api-docpay/api-app2/; s/localhost:8000/localhost:8010/' /etc/nginx/sites-available/supabase-app2
ln -s /etc/nginx/sites-available/supabase-app2 /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d api-app2.seudominio.com
```

### N.6 Import do banco
Repita Partes C, D, E e F trocando em **todos** os comandos:
- `docpay-db` → `app2-db`
- `-d docpay` → `-d app2`
- `/opt/supabase-docpay/` → `/opt/supabase-app2/`

### N.7 Backup independente
Repita a Parte K trocando todas as ocorrências de `docpay` por `app2`. O cron mantém os dois jobs em paralelo (rodam às 3h, sem conflito).

### N.8 Mapeamento final

| App | Pasta | Container DB | Database | Porta Kong | Subdomínio |
|---|---|---|---|---|---|
| docpay | `/opt/supabase-docpay` | `docpay-db` | `docpay` | 8000 | `api-docpay.seudominio.com` |
| app2   | `/opt/supabase-app2`   | `app2-db`   | `app2`   | 8010 | `api-app2.seudominio.com`   |
| app3   | `/opt/supabase-app3`   | `app3-db`   | `app3`   | 8020 | `api-app3.seudominio.com`   |

Mantenha essa tabela atualizada toda vez que adicionar um novo app — é o seu "mapa" da VPS.