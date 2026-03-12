

# Cancelar Processamento — Reset Completo e Voltar ao Início

## Problema

Ao clicar "Cancelar Processamento", o sistema para o OCR e limpa matches/docs gerados, mas **não** limpa holerites, comprovantes, spreadsheet, nem volta ao step 1. O usuário fica preso no step 3 com estado parcial.

## Solução

### 1. `src/hooks/useDocumentProcessor.ts` — `cancelProcessing` faz reset completo
Reutilizar a lógica do `reset` dentro de `cancelProcessing`: revogar blob URLs, limpar caches (PDF + OCR), limpar IndexedDB, e zerar todos os estados (holerites, comprovantes, matchedPairs, generatedDocs, unprocessedList, status).

### 2. `src/pages/Index.tsx` — Cancelar navega ao step 1
Substituir a chamada direta a `cancelProcessing` por uma nova função que chama `cancelProcessing` (agora com reset completo) e depois executa `handleReset` para voltar ao step 1, resetar `syncComplete` e `showRepository`.

Em resumo: cancelar = parar tudo + limpar tudo + voltar ao início (step 1).

