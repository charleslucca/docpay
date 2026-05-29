## Validação de integridade — Postgres self-hosted (VPS 191.101.234.62)

Não consigo conectar diretamente na VPS pelas minhas ferramentas (elas só falam com o Supabase Cloud). A validação será feita via um único bloco SQL que você roda na VPS e me cola a saída. O script confere tudo que precisa estar íntegro para o frontend funcionar.

### O que o script verifica

1. **Schemas existentes** (precisa ter `public` e `auth`)
2. **Tabelas do schema `public`** — lista esperada: `empresas`, `funcionarios`, `funcionarios_salario`, `municipios`, `profiles`, `user_roles`, `ip_whitelist`, `processing_history`, `excel_upload_history`
3. **Contagem de linhas** por tabela (compara com o Cloud depois)
4. **Enum `app_role`** existe com valores `admin`, `employee`, `financeiro`
5. **Funções**: `has_role`, `has_role_any`, `handle_new_user`, `update_updated_at_column`
6. **Trigger `on_auth_user_created`** em `auth.users` (cria profile + role automaticamente)
7. **RLS habilitado** em todas as tabelas de `public`
8. **Policies** por tabela (contagem)
9. **GRANTs** para `anon`, `authenticated`, `service_role` no schema `public`
10. **Tabelas de `auth`**: `users` e `identities` com contagem
11. **Buckets de storage**: `excel-uploads`, `generated-documents`

### Como executar

Você roda **um único comando** na VPS:

```bash
docker exec -i docpay-db psql -U postgres -d docpay <<'SQL' > /tmp/integridade.txt 2>&1
\echo === 1. SCHEMAS ===
SELECT schema_name FROM information_schema.schemata
WHERE schema_name IN ('public','auth','storage') ORDER BY 1;

\echo === 2. TABELAS PUBLIC ===
SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1;

\echo === 3. CONTAGENS PUBLIC ===
SELECT 'empresas' t, count(*) FROM public.empresas UNION ALL
SELECT 'funcionarios', count(*) FROM public.funcionarios UNION ALL
SELECT 'funcionarios_salario', count(*) FROM public.funcionarios_salario UNION ALL
SELECT 'municipios', count(*) FROM public.municipios UNION ALL
SELECT 'profiles', count(*) FROM public.profiles UNION ALL
SELECT 'user_roles', count(*) FROM public.user_roles UNION ALL
SELECT 'ip_whitelist', count(*) FROM public.ip_whitelist UNION ALL
SELECT 'processing_history', count(*) FROM public.processing_history UNION ALL
SELECT 'excel_upload_history', count(*) FROM public.excel_upload_history;

\echo === 4. ENUM app_role ===
SELECT unnest(enum_range(NULL::public.app_role));

\echo === 5. FUNÇÕES ===
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND proname IN
('has_role','has_role_any','handle_new_user','update_updated_at_column') ORDER BY 1;

\echo === 6. TRIGGER on_auth_user_created ===
SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgname='on_auth_user_created';

\echo === 7. RLS HABILITADO ===
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' ORDER BY 1;

\echo === 8. POLICIES POR TABELA ===
SELECT tablename, count(*) FROM pg_policies WHERE schemaname='public'
GROUP BY tablename ORDER BY 1;

\echo === 9. GRANTS PUBLIC ===
SELECT grantee, table_name, string_agg(privilege_type, ',') privs
FROM information_schema.role_table_grants
WHERE table_schema='public' AND grantee IN ('anon','authenticated','service_role')
GROUP BY grantee, table_name ORDER BY 2,1;

\echo === 10. AUTH ===
SELECT 'auth.users' t, count(*) FROM auth.users UNION ALL
SELECT 'auth.identities', count(*) FROM auth.identities;

\echo === 11. STORAGE BUCKETS ===
SELECT id, public FROM storage.buckets ORDER BY 1;
SQL

cat /tmp/integridade.txt
```

### O que faço com a saída

Você cola o conteúdo do `/tmp/integridade.txt` no chat. Eu comparo cada bloco contra o estado esperado (que conheço do Cloud) e devolvo um relatório no formato:

```
[OK]    Schemas: public, auth, storage presentes
[OK]    9/9 tabelas em public
[FALHA] Trigger on_auth_user_created ausente → script de correção:
        CREATE TRIGGER on_auth_user_created ...
[FALHA] Tabela funcionarios_salario sem GRANT para authenticated → corrigir com:
        GRANT SELECT ON public.funcionarios_salario TO authenticated;
...
```

Para cada falha, eu te entrego o SQL exato de correção, pronto para rodar com `docker exec -i docpay-db psql ...`.

### Nenhuma alteração de código

Esta validação é 100% diagnóstica. Nenhum arquivo do projeto é tocado. Só geramos correções SQL **depois** que você compartilhar a saída e identificarmos o que está faltando.
