# Guia de Migração para Leigo — Frontend no Vercel + Backend (Postgres/Supabase) na VPS Hostinger

> **Cenário desta migração**
> - **Código React (frontend)** → publicado no **Vercel** (deploy automático a cada commit no GitHub).
> - **Banco PostgreSQL + Auth + Edge Functions** → **Supabase self-hosted via Docker** rodando na **VPS Hostinger**.
> - **Sem Storage** — o app gera ZIPs localmente no navegador, então não precisamos do serviço de arquivos do Supabase.
>
> Leia tudo na ordem. Cada bloco de comando é para **copiar e colar**. Onde aparecer `<ALGO>` você substitui pelo seu valor.

---

## Visão geral em 1 minuto

```
 ┌────────────────────┐         HTTPS         ┌──────────────────────────────┐
 │   Navegador do     │  ───────────────────▶ │  Vercel (frontend React)     │
 │   usuário          │                       │  docpay.vercel.app           │
 └────────────────────┘                       └──────────────┬───────────────┘
                                                             │  chama API
                                                             ▼
                                              ┌──────────────────────────────┐
                                              │  VPS Hostinger (Ubuntu)      │
                                              │  api.seudominio.com          │
                                              │  ┌────────────────────────┐  │
                                              │  │ Docker: Supabase       │  │
                                              │  │  - Postgres            │  │
                                              │  │  - Auth (GoTrue)       │  │
                                              │  │  - PostgREST           │  │
                                              │  │  - Kong (gateway)      │  │
                                              │  │  - Edge Functions      │  │
                                              │  └────────────────────────┘  │
                                              └──────────────────────────────┘
```

---

## PARTE A — Preparar a VPS Hostinger

### A.1 Contratar a VPS
1. Entre no painel da Hostinger → **VPS** → **KVM 2** (2 vCPU, 8 GB RAM, 100 GB).
2. Sistema operacional: **Ubuntu 22.04 LTS**.
3. Anote o **IP público** e a **senha de root** enviada por e-mail.

### A.2 Conectar via SSH
No seu computador (Windows: use PowerShell ou Terminal do Windows; Mac/Linux: Terminal):
```bash
ssh root@<IP_DA_VPS>
```
Digite a senha quando pedir.

### A.3 Instalar tudo o que precisamos (1 bloco copy/paste)
```bash
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose-plugin git ufw nginx certbot python3-certbot-nginx
```

### A.4 Firewall (libera só SSH e web)
```bash
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
```

### A.5 Apontar o domínio
No painel do seu provedor de DNS (Hostinger, Registro.br, Cloudflare…):
- Crie um registro **A** `api.seudominio.com` → `<IP_DA_VPS>`.
- Aguarde 5–30 min para propagar. Teste: `ping api.seudominio.com` deve responder com o IP da VPS.

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
openssl rand -base64 48   # use esta saída como POSTGRES_PASSWORD
openssl rand -base64 64   # use esta saída como JWT_SECRET
```
Anote os dois valores.

### B.3 Gerar `ANON_KEY` e `SERVICE_ROLE_KEY`
Acesse no navegador: <https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys>
- Cole o **JWT_SECRET** que você gerou.
- A página gera 2 tokens longos: **ANON_KEY** (público) e **SERVICE_ROLE_KEY** (secreto).
- Anote ambos.

### B.4 Editar o `.env`
```bash
nano /opt/supabase/docker/.env
```
Preencha pelo menos:
```
POSTGRES_PASSWORD=<senha gerada em B.2>
JWT_SECRET=<jwt secret gerado em B.2>
ANON_KEY=<token público gerado em B.3>
SERVICE_ROLE_KEY=<token secreto gerado em B.3>

SITE_URL=https://docpay.vercel.app
API_EXTERNAL_URL=https://api.seudominio.com
SUPABASE_PUBLIC_URL=https://api.seudominio.com

DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=<defina uma senha forte aqui>
```
Salve com `Ctrl+O`, `Enter`, `Ctrl+X`.

### B.5 Remover o Storage (não usamos)
```bash
nano /opt/supabase/docker/docker-compose.yml
```
Remova/comente os blocos `storage:` e `imgproxy:` (apague desde a linha do nome do serviço até o próximo serviço). Salve.

Edite também o roteamento:
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
Todos devem aparecer como `running` ou `healthy`.

### B.7 Nginx + HTTPS (Let's Encrypt)
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
Responda **Yes** quando o Certbot perguntar sobre redirecionar para HTTPS.

Teste:
```bash
curl -i https://api.seudominio.com/auth/v1/health
```
Deve retornar `200 OK`.

---

## PARTE C — Exportar o banco do Supabase Cloud (origem)

### C.1 Instalar o `pg_dump` no seu computador
- **Windows**: instale o PostgreSQL <https://www.postgresql.org/download/windows/> (use só as ferramentas de linha de comando).
- **Mac**: `brew install libpq && brew link --force libpq`
- **Linux**: `sudo apt install postgresql-client`

### C.2 Pegar a senha do banco atual
No <https://supabase.com/dashboard/project/zouizzfomwrxfptgxkwj/settings/database> copie a senha do Postgres.

### C.3 Rodar o export (no seu PC, NÃO na VPS)
```bash
pg_dump "postgresql://postgres:<SENHA>@db.zouizzfomwrxfptgxkwj.supabase.co:5432/postgres" \
  --schema=public --schema=auth \
  --no-owner --no-privileges \
  --clean --if-exists \
  -f backup_docpay.sql
```

**O que cada flag faz (em português):**
- `--schema=public --schema=auth` → exporta só os schemas que importam (suas tabelas + usuários).
- `--no-owner --no-privileges` → ignora dono e permissões da nuvem (que não existem na VPS).
- `--clean --if-exists` → o arquivo começa removendo o que já existir, evitando duplicidade ao importar.
- `-f backup_docpay.sql` → nome do arquivo gerado.

Vai aparecer um `backup_docpay.sql` (alguns MB) na pasta atual.

---

## PARTE D — Importar o banco na VPS

### D.1 (OBRIGATÓRIO) Limpar parâmetros incompatíveis do dump

> **Por quê?** O `pg_dump` do Supabase Cloud usa PostgreSQL 15+ e adiciona a linha `SET transaction_timeout = 0;` no início do arquivo. A versão de Postgres que roda dentro do container do Supabase self-hosted (Postgres 15.1) **não reconhece esse parâmetro** e aborta a importação com:
>
> `ERROR: unrecognized configuration parameter "transaction_timeout"`
>
> A correção é remover essa linha do arquivo `.sql` **antes** de importar. Faça isso para **TODOS** os dumps (`backup_docpay.sql`, ou `backup_public.sql` + `backup_auth_users.sql` se você fez dumps separados).

**Linux / Mac (no seu PC):**
```bash
cp backup_docpay.sql backup_docpay_original.sql
sed -i.bak '/transaction_timeout/d' backup_docpay.sql
grep -c "transaction_timeout" backup_docpay.sql
```
O último comando deve imprimir `0`. Se imprimir `0`, está limpo.

**Windows (PowerShell, no seu PC):**
```powershell
Copy-Item backup_docpay.sql backup_docpay_original.sql
(Get-Content backup_docpay.sql) | Where-Object { $_ -notmatch 'transaction_timeout' } | Set-Content backup_docpay_limpo.sql
Select-String -Path backup_docpay_limpo.sql -Pattern "transaction_timeout"
```
Se o último comando **não imprimir nada**, está limpo. No Windows, use `backup_docpay_limpo.sql` daqui pra frente.

> Se aparecerem outros erros parecidos de parâmetro desconhecido (ex.: `idle_in_transaction_session_timeout`), aplique o mesmo `sed`/filtro trocando o nome do parâmetro.

### D.2 Enviar o arquivo para a VPS
No seu PC:
```bash
scp backup_docpay.sql root@<IP_DA_VPS>:/opt/supabase/
```

### D.3 Importar dentro do container do Postgres
Conecte na VPS via SSH e rode (com `ON_ERROR_STOP=1` para abortar de verdade se algo falhar):
```bash
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction < /opt/supabase/backup_docpay.sql
```
Vai imprimir várias linhas `CREATE TABLE`, `ALTER TABLE`, `COPY`. Mensagens `NOTICE:` (avisos) podem ser ignoradas. Linhas começando com `ERROR:` interrompem tudo — se acontecer, leia a mensagem, corrija o `.sql` (geralmente é mais um parâmetro a remover) e rode de novo.

### D.4 Conferir se deu certo
```bash
docker exec -it supabase-db psql -U postgres -c "\dt public.*"
docker exec -it supabase-db psql -U postgres -c "SELECT count(*) FROM auth.users;"
docker exec -it supabase-db psql -U postgres -c "SELECT count(*) FROM public.funcionarios;"
```
Os números devem bater com o Supabase Cloud atual.

### D.5 Como aplicar migrations futuras (quando o Lovable criar um arquivo novo em `supabase/migrations/`)
No seu PC, com o arquivo da migration baixado:
```bash
scp supabase/migrations/<NOVA_MIGRATION>.sql root@<IP_DA_VPS>:/tmp/
ssh root@<IP_DA_VPS> "docker exec -i supabase-db psql -U postgres -d postgres < /tmp/<NOVA_MIGRATION>.sql"
```
Pronto — a estrutura do banco fica sincronizada manualmente, sem precisar da CLI do Supabase.

---

## PARTE E — Deploy das Edge Functions

O projeto tem 2 funções: `admin-create-user` e `check-ip`.

### E.1 Copiar do seu PC para a VPS
```bash
scp -r supabase/functions/admin-create-user root@<IP_DA_VPS>:/opt/supabase/docker/volumes/functions/
scp -r supabase/functions/check-ip          root@<IP_DA_VPS>:/opt/supabase/docker/volumes/functions/
```

### E.2 Reiniciar o serviço de functions
```bash
ssh root@<IP_DA_VPS>
cd /opt/supabase/docker
docker compose restart functions
```

### E.3 Configurar secrets das functions
Edite o `.env` da pasta `docker` e adicione (no final):
```
SUPABASE_URL=https://api.seudominio.com
SUPABASE_ANON_KEY=<ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
```
Depois `docker compose up -d` novamente.

### E.4 Testar
```bash
curl -i https://api.seudominio.com/functions/v1/check-ip \
  -H "Authorization: Bearer <ANON_KEY>"
```

---

## PARTE F — Publicar o frontend no Vercel

### F.1 Subir o código no GitHub
O projeto Lovable já está conectado ao GitHub. Confirme que o último commit está visível em **github.com/<seu-usuario>/<repo>**.

### F.2 Conectar ao Vercel
1. Acesse <https://vercel.com> → **Add New… → Project**.
2. Importe o repositório do GitHub.
3. Em **Framework Preset** escolha **Vite**.
4. **Build Command**: `npm run build`
5. **Output Directory**: `dist`

### F.3 Variáveis de ambiente no Vercel
Na tela de import, abra **Environment Variables** e adicione:

| Nome | Valor |
|---|---|
| `VITE_SUPABASE_URL` | `https://api.seudominio.com` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `<ANON_KEY da VPS>` |
| `VITE_SUPABASE_PROJECT_ID` | `docpay` |

Clique em **Deploy**. Em ~1 minuto seu app está no ar em `https://<projeto>.vercel.app`.

### F.4 Liberar CORS para o domínio do Vercel
Na VPS:
```bash
nano /opt/supabase/docker/.env
```
Atualize:
```
SITE_URL=https://<projeto>.vercel.app
ADDITIONAL_REDIRECT_URLS=https://<projeto>.vercel.app
```
Reinicie:
```bash
cd /opt/supabase/docker && docker compose up -d
```

---

## PARTE G — Checklist final

- [ ] `https://api.seudominio.com/auth/v1/health` responde 200.
- [ ] Login com um usuário existente funciona no app do Vercel.
- [ ] Página de Admin lista funcionários (RLS ativa).
- [ ] Função `check-ip` bloqueia IP fora da whitelist.
- [ ] Upload de Excel + geração de ZIP de holerites funciona.

---

## PARTE H — Backup automático diário

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
Pronto — todo dia às 3h o banco é salvo em `/opt/backups`, mantendo 14 dias de histórico.

---

## PARTE I — Rollback (plano B)

Se algo der errado nos primeiros dias:
1. No Vercel, em **Settings → Environment Variables**, troque `VITE_SUPABASE_URL` de volta para `https://zouizzfomwrxfptgxkwj.supabase.co` e a `VITE_SUPABASE_PUBLISHABLE_KEY` para a anon key original.
2. Faça **Redeploy**.
3. O app volta a usar o Supabase Cloud como se nada tivesse acontecido.

Mantenha o projeto Supabase Cloud ativo por **15 dias** após o cutover.

---

## Custos estimados

| Item | Mensal |
|---|---|
| Hostinger VPS KVM 2 | R$ 40–60 |
| Vercel Hobby (frontend) | Grátis |
| Domínio `.com.br` | ~R$ 40/ano |
| **Total** | **~R$ 50/mês** |

---

## Glossário rápido

- **VPS** — computador virtual na nuvem que você aluga e administra sozinho.
- **SSH** — forma segura de acessar a VPS pelo terminal.
- **Docker** — programa que roda outros programas em "caixinhas" isoladas (containers).
- **Edge Function** — pequeno trecho de código que roda no servidor sob demanda (em vez de no navegador).
- **RLS** — Row Level Security, regras do Postgres que decidem quem pode ver/editar cada linha.
- **CORS** — regra que diz quais sites podem chamar seu backend.