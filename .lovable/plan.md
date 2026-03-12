

# Diagnóstico: Match falha no Chrome/Edge Windows, funciona no Safari/macOS

## Causa Raiz Identificada

O problema está na **ordem dos itens de texto** retornada pelo PDF.js (`page.getTextContent()`). Existem **duas funções de extração com comportamento diferente**:

1. **`extractTextFromPage`** (pdfUtils.ts, linha 18): Junta os itens na ordem em que o PDF.js retorna — **SEM ordenação posicional**
2. **`extractSinglePageText`** (pdfCache.ts, linha 91): Ordena por posição Y/X antes de juntar

O PDF.js não garante ordem consistente dos `textContent.items` entre browsers. Safari/macOS pode retornar numa ordem que, por acaso, preserva a leitura natural. Chrome/Edge no Windows retorna numa ordem diferente (baseada na estrutura interna do PDF), quebrando os regex de extração de nomes.

### Impacto no fluxo:

- **Holerites**: Usa `extractSinglePageText` (com ordenação) → menos afetado, mas o threshold de `yDiff > 5` pode agrupar linhas diferente entre browsers
- **Comprovantes**: Usa `getCachedPageTextsWithOCREnhanced` → que internamente usa `extractSinglePageText` → os favorecidos são extraídos via `extractFavorecidoNames` que depende de padrões como `FAVORECIDO\s*:?\s*NOME_AQUI`
- **`extractTextFromPage`** (usada em `countPagesWithFavorecido` e `countPagesWithEmployeeName`): **NÃO ordena** → resultado totalmente dependente da ordem do browser

### Cenário de falha concreto:

No Chrome/Windows, os items do PDF podem vir numa ordem onde "FAVORECIDO" e o nome do funcionário não ficam adjacentes no texto concatenado. O regex falha, 0 nomes são extraídos, 0 matches são encontrados.

## Solução

### 1. Unificar extração de texto em uma única função com ordenação posicional

Substituir **todos** os usos de `extractTextFromPage` (pdfUtils.ts) pela versão com ordenação posicional (`extractSinglePageText` de pdfCache.ts). Isso garante que o texto reconstruído tenha a mesma ordem de leitura em todos os browsers.

Arquivos afetados:
- **`src/lib/pdfUtils.ts`**: Alterar `extractTextFromPage` (linhas 27-36) para usar a mesma lógica de ordenação por posição Y/X do `extractSinglePageText`
- **`src/lib/pdfUtils.ts`**: Alterar `extractTextFromPdf` (linhas 6-24) — mesma correção

### 2. Tornar o threshold de agrupamento de linhas mais robusto

Na função `extractSinglePageText` (pdfCache.ts, linha 96), o threshold `Math.abs(yDiff) > 5` para determinar "mesma linha" pode ser frágil. Normalizar usando a **altura da fonte** (`item.height` ou `item.transform[3]`) em vez de um valor fixo em pixels:

```typescript
const lineThreshold = Math.max(5, Math.min(a.height, b.height) * 0.5);
```

### 3. Adicionar log de diagnóstico cross-browser

Na etapa de matching (useDocumentProcessor.ts), já existe `console.log` do `navigator.userAgent`. Adicionar log da primeira página de cada comprovante mostrando:
- Quantidade de text items retornados pelo PDF.js
- Texto dos primeiros 200 chars (para comparação entre browsers)
- Se a ordenação posicional alterou a ordem original

### Resumo das alterações:

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/pdfUtils.ts` | `extractTextFromPdf` e `extractTextFromPage`: adicionar ordenação Y/X igual ao `extractSinglePageText` |
| `src/lib/pdfCache.ts` | `extractSinglePageText`: usar altura da fonte como threshold em vez de valor fixo (5px) |
| `src/hooks/useDocumentProcessor.ts` | Adicionar log de diagnóstico com contagem de items e amostra de texto na extração de comprovantes |

Nenhuma alteração de arquitetura — apenas unificação da lógica de ordenação de texto para garantir consistência cross-browser.

