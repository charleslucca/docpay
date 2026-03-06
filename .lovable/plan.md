

# Remover alerta de processamento lento

## O que será feito

Remover completamente o mecanismo de "operação lenta detectada" que exibe um toast após 10 segundos de processamento por arquivo.

## Alterações

### `src/hooks/useDocumentProcessor.ts`

1. **Remover** a constante `SLOW_OPERATION_THRESHOLD_MS` (linha 58)
2. **Remover** o ref `slowOperationTimerRef` e `currentItemStartTimeRef` (linhas 167-168)
3. **Remover** o cleanup `useEffect` do timer (linhas 239-245)
4. **Remover** as funções `startSlowOperationTimer` e `clearSlowOperationTimer` (linhas 247-276)
5. **Remover** `isSlowOperation: false` do `updateProgress` (linha 291)
6. **Remover** todas as chamadas a `startSlowOperationTimer()` e `clearSlowOperationTimer()` espalhadas pelo código (~15 ocorrências)

### `src/types/document.ts`

- Remover o campo `isSlowOperation` do tipo `ProcessingStatus` (linha 55)

