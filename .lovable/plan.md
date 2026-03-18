
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

---

# Auditoria de Normalização de Nomes — Implementado ✅

## Problema
Duas funções de normalização independentes (`normalizeForMatch` em pdfUtils.ts e `normalizeForComparison` em excelUtils.ts) tratavam nomes de forma diferente, permitindo que caracteres invisíveis (BOM, zero-width spaces, non-breaking spaces, soft hyphens) causassem falhas de matching em nomes visualmente idênticos.

## Correções

### 1. Função centralizada `sanitizeName` (`src/lib/nameUtils.ts`) — NOVO
- Pipeline de 8 etapas: strip invisíveis → normalizar whitespace → NFD → uppercase → hífens → remover não-letras → colapsar espaços → trim
- `sanitizeNameWithOCR`: mesma pipeline + correções OCR (0→O, 1→I, 5→S)
- `debugNameBytes`: representação hex para diagnóstico byte-a-byte
- `logSanitizationDiff`: log automático quando sanitização altera o valor

### 2. Unificação (`src/lib/pdfUtils.ts` + `src/lib/excelUtils.ts`)
- `normalizeForMatch` → delega para `sanitizeNameWithOCR`
- `normalizeForComparison` → delega para `sanitizeName`
- Ambos os caminhos agora produzem output consistente

### 3. Diagnóstico na entrada de dados (`src/lib/excelUtils.ts`)
- Log `[SANITIZE]` com bytes hex quando o valor do colaborador é alterado durante sanitização

### 4. Testes de regressão (`src/test/matching.test.ts`)
- 15 novos testes cobrindo: non-breaking space, zero-width space, BOM, tabs, newlines, soft hyphens, zero-width joiners, acentos, múltiplos espaços, pontuação/dígitos, correções OCR, debugNameBytes, pipeline unificado
- Total: 46 testes, todos passando
