

# Holerite não encontra funcionário no Chrome — Diagnóstico e Correção

## Problema Identificado

Analisando a imagem: o RECIBO.pdf (holerite) mostra **"1 página • funcionário(s)"** — sem número antes de "funcionário(s)", indicando que `estimatedEmployees` está `undefined`. O comprovante funciona (1 funcionário). Isso significa que a extração do nome do funcionário falha completamente no holerite.

### Causa Raiz 1: Bug em `countPagesWithEmployeeName` (crash silencioso)

Linha 152 de `pdfUtils.ts`:
```text
const samplePages = [1, Math.floor(totalPages / 2), Math.max(1, totalPages - 1)];
```
Para um PDF de **1 página**: `samplePages = [1, 0, 1]`. A página **0** não é filtrada pelo guard `if (pageNum > totalPages)` (porque `0 > 1` é `false`), e `pdf.getPage(0)` **lança exceção** no pdf.js (páginas são 1-indexed). Isso crasheia toda a função `countPagesWithEmployeeName`, e o catch no caller (`addFiles`, linha 328) engole o erro silenciosamente, deixando `estimatedEmployees` como `undefined`.

### Causa Raiz 2: `extractEmployeeName` não reconhece o formato do RECIBO.pdf

Se o holerite usa um layout que não corresponde a nenhum dos 8 padrões regex (ex: "RECIBO" sem "DE PAGAMENTO", ou formato de tabela diferente), o nome não é extraído. Sem nome extraído do holerite, o funcionário nunca entra na lista de matching, resultando em "0 funcionário(s)" e nenhuma correspondência.

### Causa Raiz 3: PDFs escaneados de 1 página sem OCR na contagem

Para 1 página escaneada, a estimativa retorna `Math.max(1, 0) = 1`, mas se a extração nativa falha E o OCR durante processamento também falha, o nome nunca é capturado.

## Alterações Propostas

### 1. `src/lib/pdfUtils.ts` — Corrigir bug de página 0

Linha 152: Filtrar valores ≤ 0 e duplicatas do `samplePages`:
```typescript
const samplePages = [...new Set([1, Math.floor(totalPages / 2), Math.max(1, totalPages - 1)])].filter(p => p >= 1);
```

### 2. `src/lib/pdfUtils.ts` — Adicionar padrões de extração mais amplos em `extractEmployeeName`

Adicionar novos padrões para formatos comuns de recibos brasileiros que não estão cobertos:
- Padrão para "RECIBO" seguido de nome (sem "DE PAGAMENTO")
- Padrão para tabelas onde o nome aparece após "EMPREGADOR" ou "FUNCIONÁRIO" com formatação não-padrão
- Fallback final mais agressivo: buscar no texto por qualquer sequência de 2+ palavras maiúsculas (≥3 chars cada) que não sejam labels conhecidos, próxima a um CPF

### 3. `src/lib/pdfUtils.ts` — Adicionar logging de diagnóstico na contagem

Quando `extractEmployeeName` falha, logar os primeiros 500 chars do texto para diagnóstico, facilitando identificar o formato do PDF.

### 4. `src/hooks/useDocumentProcessor.ts` — Tratar estimatedEmployees undefined

Na UI (FileDropzone.tsx, linha 153), quando `estimatedEmployees` é `undefined`, mostrar "calculando..." em vez de `undefined`.

### 5. `src/components/FileDropzone.tsx` — Corrigir exibição de undefined

Tratar o caso de `estimatedEmployees` ser `undefined` ou `0` para exibir mensagem adequada.

## Resumo

| Alteração | Arquivo | Impacto |
|-----------|---------|---------|
| Fix página 0 em samplePages | pdfUtils.ts | Elimina crash silencioso na contagem |
| Novos padrões de extração | pdfUtils.ts | Reconhece mais formatos de holerite |
| Log diagnóstico | pdfUtils.ts | Facilita debug de formatos não reconhecidos |
| Tratar undefined na UI | FileDropzone.tsx | Exibe feedback correto ao usuário |

