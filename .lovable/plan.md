## Objetivo

Salvar o guia de migração para VPS Hostinger na raiz do repositório Git, garantindo que o arquivo seja versionado e fique acessível tanto via Lovable quanto via GitHub (download/clone).

## Situação atual

- O guia existe hoje em `docs/MIGRACAO_VPS_HOSTINGER.md` (6.1 KB, conteúdo completo já validado).
- A versão `.txt` mencionada (`MIGRACAO_VPS_HOSTINGER_v2.txt`) foi gerada em `/mnt/documents/` em sessões anteriores, mas esse caminho **não faz parte do repositório Git** — por isso não aparece no GitHub nem é commitada.
- Para ficar “na raiz do git”, o arquivo precisa ser criado dentro da pasta do projeto (raiz = `/dev-server`, que corresponde à raiz do repo).

## O que será feito

1. **Criar `MIGRACAO_VPS_HOSTINGER.md` na raiz do repositório** com o mesmo conteúdo de `docs/MIGRACAO_VPS_HOSTINGER.md` (guia completo: provisionamento, export `pg_dump`, Supabase self-hosted sem Storage, edge functions, Nginx + TLS, build do frontend, backup automático, custos e rollback).
2. **Criar também `MIGRACAO_VPS_HOSTINGER.txt` na raiz** (mesma versão em texto puro) para garantir compatibilidade caso o visualizador de Markdown falhe, conforme você já reportou antes.
3. **Manter** o arquivo atual em `docs/MIGRACAO_VPS_HOSTINGER.md` (não remover) para não quebrar referências.

## Resultado esperado

Após a aprovação, na raiz do projeto (e portanto no GitHub assim que o sync ocorrer) você terá:

```text
/
├── MIGRACAO_VPS_HOSTINGER.md   ← novo, raiz
├── MIGRACAO_VPS_HOSTINGER.txt  ← novo, raiz
├── docs/
│   └── MIGRACAO_VPS_HOSTINGER.md
├── src/
├── supabase/
└── ...
```

Ambos os arquivos ficam visíveis na sidebar do Lovable e disponíveis para download direto pelo GitHub (`Code → Download ZIP` ou `git clone`).

## Detalhes técnicos

- Conteúdo será idêntico ao já aprovado em `docs/MIGRACAO_VPS_HOSTINGER.md`.
- Nenhuma alteração em código de aplicação, banco, RLS, edge functions ou dependências.
- Nenhuma migração SQL.
- Sync automático Lovable ↔ GitHub fará o commit dos dois novos arquivos na raiz.
