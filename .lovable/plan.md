

# Correção: Funcionários Não Sendo Salvos no Banco

## Causa Raiz

A tabela `funcionarios` **NÃO possui a coluna `observacoes`**, mas o código de sincronização (`supabaseExcelSync.ts`) inclui esse campo nos payloads de INSERT e UPDATE. Isso faz com que o Supabase rejeite TODAS as inserções de funcionários silenciosamente.

Evidência:
- Colunas existentes: `id, empresa_id, municipio_id, nome, nome_normalizado, cargo, banco, contrato, ativo, created_at, updated_at, codigo`
- Coluna **ausente**: `observacoes`
- Resultado: 0 funcionários inseridos nas últimas importações (659 registros processados, 0 salvos)
- Empresas (13) e Municípios (41) foram sincronizados corretamente porque não usam `observacoes`

## Correção

### 1. Migração SQL: adicionar coluna `observacoes`
```sql
ALTER TABLE public.funcionarios ADD COLUMN observacoes text;
```
Isso resolve a incompatibilidade entre código e schema sem necessidade de alterar a lógica de sincronização.

### 2. Atualizar `src/pages/AdminFuncionarios.tsx`
- Remover os casts `(f as any).observacoes` que mascaram o problema de tipagem
- O campo `observacoes` passará a existir nos types gerados após a migração

### 3. Nenhuma alteração nos outros arquivos
O `supabaseExcelSync.ts` e `excelUtils.ts` já lidam corretamente com `observacoes` — o problema era apenas a coluna ausente no banco.

## Resultado Esperado
Após a migração, a próxima importação salvará todos os 659+ funcionários corretamente no banco, e o menu "Funcionários" exibirá os dados.

