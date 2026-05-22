## Objetivo

Reescrever `MIGRACAO_VERCEL_HOSTINGER.md` como um guia completo e linear para um leigo, do zero até o app no ar, **incluindo** toda a parte de banco de dados que já validamos (export, limpeza do `transaction_timeout`, import ordenado `auth → public`, e correção do `user_roles` vazio).

## Estrutura do novo documento

```text
PARTE A — Preparar a VPS Hostinger
  A.1 Contratar VPS (KVM 2, Ubuntu 22.04)
  A.2 Conectar via SSH
  A.3 Instalar Docker, Nginx, Certbot
  A.4 Firewall (UFW)
  A.5 Apontar domínio api.seudominio.com

PARTE B — Subir o Supabase self-hosted (sem Storage)
  B.1 Clonar repositório
  B.2 Gerar POSTGRES_PASSWORD e JWT_SECRET
  B.3 Gerar ANON_KEY e SERVICE_ROLE_KEY
  B.4 Editar .env
  B.5 Remover storage/imgproxy do docker-compose e kong.yml
  B.6 docker compose up -d
  B.7 Nginx + HTTPS via Certbot

PARTE C — Exportar banco do Supabase Cloud
  C.1 Instalar pg_dump
  C.2 Pegar senha do banco
  C.3 Export em DOIS arquivos (ordem importa no import):
       - backup_public.sql  (schema public, sem --clean)
       - backup_auth_users.sql (data-only de auth.users + auth.identities)

PARTE D — Limpar parâmetros incompatíveis (OBRIGATÓRIO)
  D.1 Remover linhas "transaction_timeout" dos 2 dumps
       - sed para Linux/Mac
       - PowerShell para Windows
  D.2 Validar com grep -c → deve ser 0

PARTE E — Importar na VPS (ORDEM CORRETA)
  E.1 Enviar arquivos com scp
  E.2 Parar serviços que consultam o banco (kong, auth, rest, functions)
  E.3 Importar backup_public.sql com ON_ERROR_STOP=1 --single-transaction
  E.4 Importar backup_auth_users.sql (auth.users + identities)
  E.5 Reaplicar GRANTs para anon/authenticated/service_role
  E.6 Reiniciar serviços

PARTE F — Corrigir user_roles vazio
  F.1 Verificar contagem (auth.users, profiles, user_roles)
  F.2 Se Cloud tinha roles e VPS tem 0:
       pg_dump --data-only --table=public.user_roles --table=public.profiles
       limpar transaction_timeout
       importar nessa ordem
  F.3 Se Cloud também tinha 0:
       INSERT manual de pelo menos 1 admin
       (pega UUID via SELECT id, email FROM auth.users)

PARTE G — Migrations futuras
  scp + docker exec -i supabase-db psql ...

PARTE H — Deploy das Edge Functions
  scp das pastas admin-create-user e check-ip
  docker compose restart functions
  configurar secrets no .env

PARTE I — Frontend no Vercel
  I.1 Subir código no GitHub (já conectado pelo Lovable)
  I.2 Importar projeto no Vercel (Vite preset)
  I.3 Variáveis VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_PROJECT_ID
  I.4 Ajustar SITE_URL e ADDITIONAL_REDIRECT_URLS na VPS para o domínio do Vercel

PARTE J — Verificação final (checklist)
  - /auth/v1/health responde 200
  - Login funciona
  - SELECTs de count batem com o Cloud
  - user_roles tem ao menos 1 admin
  - Edge function check-ip funciona

PARTE K — Backup automático diário (cron + pg_dump)

PARTE L — Rollback (voltar VITE_SUPABASE_URL para o Cloud)

PARTE M — Custos e Glossário
```

## Pontos-chave que vão entrar no documento (e que estavam dispersos no chat)

1. **Export em 2 arquivos separados**, não em 1 só — evita o erro `role "supabase_auth_admin" does not exist`.
2. **NÃO usar `--clean`** no dump principal — destrói triggers internos do Supabase self-hosted.
3. **Limpar `SET transaction_timeout = 0;`** com `sed` (Linux/Mac) ou `Where-Object` (PowerShell) antes de importar.
4. **Ordem de import: `public` → depois `auth.users`** (com `TRUNCATE auth.users CASCADE` antes do data-only).
5. **`ON_ERROR_STOP=1 --single-transaction`** em todo `psql` para abortar de verdade em erro real.
6. **Reaplicar GRANTs** para `anon`, `authenticated`, `service_role` depois do import.
7. **Seção dedicada para `user_roles` vazio** com os dois cenários (re-export vs INSERT manual).
8. Linhas `CREATE TABLE`, `COPY 679`, `NOTICE:` **não são erros** — só `ERROR:` interrompe.

## Arquivo afetado

- `MIGRACAO_VERCEL_HOSTINGER.md` — reescrita completa preservando o tom "para leigo" (cada bloco copy/paste, `<PLACEHOLDERS>` em maiúsculo, comentários em português logo abaixo de cada comando).

Nenhum arquivo de código da aplicação será tocado.
