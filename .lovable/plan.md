

# Remover alerta de processamento lento

## O que será feito

Remover o toast de "Correspondência baixa" que aparece quando a taxa de matching é inferior a 50%. Os logs de diagnóstico no console serão mantidos para debugging.

## Alteração

### Arquivo: `src/hooks/useDocumentProcessor.ts`

Remover as linhas 1355-1363 (o bloco `if (pairs.length < totalEntries * 0.5)` com o `toast`). Os `console.log` de diagnóstico (linhas 1344-1353) permanecem intactos.

