
# Plano de Otimização de Performance

## Objetivo
Reduzir drasticamente o tempo de processamento de documentos, aproximando-o do desempenho do script Python de referência.

---

## Resumo das Mudanças

### Mudanças Principais
1. **Cache de PDFs carregados** - Evitar recarregar o mesmo arquivo múltiplas vezes
2. **Lazy Loading de previews** - Gerar miniaturas apenas quando necessário para exibição
3. **Web Workers para processamento pesado** - Mover extração de texto para thread separada
4. **Otimização do algoritmo de matching** - Parar busca ao encontrar primeiro match
5. **Processamento paralelo de holerites** - Usar Promise.all para processar múltiplos arquivos simultaneamente

---

## Etapas de Implementação

### Etapa 1: Criar Cache de PDFs
Criar um sistema de cache para evitar recarregar os mesmos arquivos.

**Arquivo:** `src/lib/pdfCache.ts` (novo)
- Implementar um Map para armazenar PDFs já carregados por hash/nome do arquivo
- Função `getCachedPdf(file: File)` que retorna PDF do cache ou carrega e armazena
- Função `clearCache()` para liberar memória quando necessário

### Etapa 2: Refatorar pdfUtils.ts
Modificar as funções para usar o cache e aceitar PDFs já carregados.

**Arquivo:** `src/lib/pdfUtils.ts`
- `extractTextFromPdf` - Aceitar PDF já carregado como parâmetro opcional
- `renderPdfPageToImage` - Aceitar PDF já carregado como parâmetro opcional  
- Criar função `extractTextFromPageRange()` para extrair texto de páginas específicas
- Implementar early return quando nome é encontrado (não processar páginas restantes)

### Etapa 3: Separar Geração de Previews
Mover a geração de previews para depois do processamento principal.

**Arquivo:** `src/hooks/useDocumentProcessor.ts`
- Remover chamadas `renderPdfPageToImage` do loop de extração
- Criar função separada `generatePreviews()` que roda após matching
- Gerar previews apenas para pares matched (não para todos os arquivos)
- Usar `requestIdleCallback` ou `setTimeout(0)` para não bloquear UI

### Etapa 4: Processamento Paralelo
Processar múltiplos holerites simultaneamente.

**Arquivo:** `src/hooks/useDocumentProcessor.ts`
- Substituir loop sequencial por `Promise.all()` com limite de concorrência (3-5 simultâneos)
- Usar `Promise.allSettled()` para continuar mesmo se um arquivo falhar
- Batch processing para comprovantes grandes

### Etapa 5: Otimizar Algoritmo de Matching
Melhorar a lógica de busca de correspondências.

**Arquivo:** `src/lib/pdfUtils.ts`
- Implementar busca com early termination ao encontrar match
- Extrair texto página por página (não todas de uma vez)
- Adicionar suporte a CPF como chave primária de matching (mais rápido e preciso)

---

## Detalhes Técnicos

### Estrutura do Cache de PDFs
```text
┌─────────────────────────────────────────────────────┐
│                   pdfCache.ts                        │
├─────────────────────────────────────────────────────┤
│  pdfDocumentCache: Map<string, PDFDocumentProxy>    │
│  arrayBufferCache: Map<string, ArrayBuffer>         │
├─────────────────────────────────────────────────────┤
│  getCachedPdf(file) → Promise<PDFDocumentProxy>     │
│  getCachedBuffer(file) → Promise<ArrayBuffer>       │
│  getFileKey(file) → string (name + size + modified) │
│  clearCache() → void                                 │
└─────────────────────────────────────────────────────┘
```

### Fluxo de Processamento Otimizado
```text
ANTES (Sequencial, bloqueante):
Holerite 1 → load → extract → render preview → WAIT
Holerite 2 → load → extract → render preview → WAIT
Holerite 3 → load → extract → render preview → WAIT

DEPOIS (Paralelo, não-bloqueante):  
Holerite 1 ─┬→ extract (cached) ─┐
Holerite 2 ─┼→ extract (cached) ─┼→ Match ─→ Generate Previews (lazy)
Holerite 3 ─┴→ extract (cached) ─┘
```

### Estimativa de Melhoria
| Operação | Antes | Depois | Ganho |
|----------|-------|--------|-------|
| Carregamento PDF | 3x por arquivo | 1x por arquivo | ~66% |
| Geração Preview | Durante processamento | Após matching | UI responsiva |
| Matching | O(n×m×p) todas páginas | O(n×m) early exit | ~40-60% |
| Threads | 1 (main) | Paralelo | ~50-70% |

---

## Arquivos a Serem Modificados

1. **`src/lib/pdfCache.ts`** (novo) - Sistema de cache para PDFs
2. **`src/lib/pdfUtils.ts`** - Refatorar para usar cache e otimizar extração
3. **`src/hooks/useDocumentProcessor.ts`** - Processamento paralelo e previews lazy
4. **`src/types/document.ts`** - Adicionar tipos para cache se necessário

---

## Considerações Adicionais

### Memória
O cache de PDFs aumentará o uso de memória. Implementar:
- Limite máximo de arquivos em cache (ex: 20 PDFs)
- LRU (Least Recently Used) para remoção automática
- Limpeza ao resetar o processamento

### Compatibilidade
Todas as mudanças são internas e não afetam a interface do usuário. O comportamento visual permanece idêntico, apenas mais rápido.

### Fallback
Se Web Workers não funcionarem em algum navegador, manter fallback para processamento na thread principal.
