

# Problema: Sync mostra "atualizados" e "removidos" sem alterações reais

## Diagnóstico

Analisando `supabaseExcelSync.ts`, identifiquei **duas causas raiz**:

### Causa 1: "Removidos" falso positivo (linha 192-195 + 300-302)
A query busca **TODOS** os funcionários das empresas presentes no Excel:
```typescript
.in("empresa_id", empresaIds)
```
Mas **não filtra por município**. Se existem funcionários de outros municípios (não presentes no Excel) vinculados à mesma empresa, eles são marcados como "removidos" indevidamente.

### Causa 2: "Atualizados" falso positivo (linha 240-243)
A comparação é frágil:
```typescript
existing.banco !== banco || existing.contrato !== record.contrato
```
- `null !== undefined` = `true` (falso positivo)
- Diferenças de espaço/capitalização entre o banco extraído via `extractBancoFromContrato` e o valor armazenado
- O campo `contrato` pode ter variações de formatação entre uploads

## Alterações Propostas

### 1. `src/lib/supabaseExcelSync.ts` — Corrigir escopo da desativação
Filtrar `toDeactivate` para incluir apenas funcionários cujo `municipio_id` está presente nos municípios do Excel atual. Funcionários de outros municípios não devem ser afetados.

### 2. `src/lib/supabaseExcelSync.ts` — Corrigir comparação de atualização
Normalizar valores antes de comparar: tratar `null`, `undefined` e `""` como equivalentes. Normalizar banco/contrato (trim, uppercase) para evitar falsos positivos por formatação.

### 3. `src/lib/supabaseExcelSync.ts` — Adicionar log detalhado
Logar exatamente **o que** mudou para cada atualização e remoção, facilitando auditoria:
- Para atualizados: campo anterior vs novo valor
- Para removidos: nome do funcionário sendo desativado

