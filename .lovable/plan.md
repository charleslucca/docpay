
# Melhorias de Confiabilidade — Implementado ✅

## Alterações realizadas

### 1. Labels de extração expandidos (`src/lib/pdfUtils.ts`)
- Adicionados: CREDITADO, TITULAR, TITULAR DA CONTA, RECEBEDOR, NOME COMPLETO, NOME DO CREDITADO, NOME DO RECEBEDOR, NOME DO TITULAR
- Cobertura ampliada para mais formatos bancários

### 2. Score de confiança por match (`src/lib/pdfUtils.ts`, `src/hooks/useDocumentProcessor.ts`)
- `findNameInPreparedPage` agora retorna `MatchResult` com `score`: 1.0 (favorecido), 0.8 (substring), 0.6 (word-overlap)
- Audit log completo no console com distribuição de métodos
- Matches de baixa confiança sinalizados para revisão manual

### 3. Detecção de duplicatas (`src/hooks/useDocumentProcessor.ts`)
- Após matching, detecta páginas de comprovante com múltiplos funcionários associados
- Log de alerta no console para revisão

### 4. UI de distribuição de confiança (`src/components/ProcessingStatus.tsx`)
- Painel visual mostrando quantos matches vieram de cada método (Alta/Média/Baixa confiança)
- Exibido ao finalizar processamento

### 5. Tipo atualizado (`src/types/document.ts`)
- `ProcessingStatus.matchMethodCounts` adicionado para passar dados de confiança à UI
