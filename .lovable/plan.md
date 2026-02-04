

# Plano: Correção de Travamento no Processamento de Comprovantes de 70 Páginas

## Problema Identificado

A análise do código revelou que quando o comprovante tem 70 páginas que **todas precisam de OCR** (é um PDF escaneado), o processamento trava na barra de progresso ~60%.

### Causa Raiz: Conflito entre Pipelines de OCR

```text
┌─────────────────────────────────────────────────────────────┐
│ PROCESSAMENTO DE HOLERITES (Funciona bem)                   │
├─────────────────────────────────────────────────────────────┤
│ Usa pipeline paralelo sofisticado:                          │
│   renderLoop() ←→ ocrLoop()                                 │
│   - Fila de canvases                                        │
│   - Progresso atualizado a cada batch                       │
│   - Workers usados eficientemente                           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ PROCESSAMENTO DE COMPROVANTES (Problema)                    │
├─────────────────────────────────────────────────────────────┤
│ Usa abordagem mais simples:                                 │
│   for each batch:                                           │
│     1. Render 4 canvases                                    │
│     2. OCR 4 canvases (usa extractTextWithOCR)              │
│     3. onProgress(...)  ← Chamado após TODOS os 4           │
│                                                             │
│ PROBLEMA: extractTextWithOCR loga para CADA página          │
│ console.log('[OCR] Starting single page recognition...');   │
│ = 70 logs!                                                  │
│                                                             │
│ PROBLEMA: O progresso só atualiza após o batch completo     │
│ Com batches de 4 páginas e 70 páginas = 18 batches          │
│ Cada batch pode levar 4-8 segundos sem feedback visual      │
└─────────────────────────────────────────────────────────────┘
```

### Causas Secundárias

1. **Logging excessivo**: 70 páginas = 70 logs "[OCR] Starting single page recognition..." que podem sobrecarregar o console
2. **Feedback visual insuficiente**: O progresso só atualiza após cada batch de 4 páginas
3. **Timeout potencial**: O scheduler pode demorar para processar 70 páginas (~1-2s cada = 70-140s total)

---

## Solução Proposta

### 1. Adicionar Timeout de Segurança no OCR

Adicionar um timeout para evitar que o processamento trave indefinidamente:

```typescript
// Em ocrUtils.ts - extractTextWithOCR
const SINGLE_PAGE_TIMEOUT_MS = 30000; // 30 segundos por página

export async function extractTextWithOCR(
  imageSource: string | HTMLCanvasElement,
  onProgress?: OcrProgressCallback
): Promise<string> {
  const sched = await initOcrScheduler();
  
  const startTime = performance.now();
  
  // Adicionar timeout para evitar travamento
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('OCR timeout')), SINGLE_PAGE_TIMEOUT_MS);
  });
  
  try {
    const result = await Promise.race([
      sched.addJob('recognize', imageSource),
      timeoutPromise,
    ]);
    
    const duration = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`[OCR] Page done in ${duration}s, confidence: ${result.data.confidence}%`);
    
    onProgress?.(100);
    return result.data.text;
  } catch (error) {
    console.error('[OCR] Page failed:', error);
    return ''; // Retornar string vazia em vez de travar
  }
}
```

### 2. Progresso Mais Granular no Processamento de Comprovantes

Modificar `getCachedPageTextsWithOCR` para atualizar progresso **a cada página**, não a cada batch:

```typescript
// Em pdfCache.ts - getCachedPageTextsWithOCR

// STEP 2: Process OCR pages in parallel batches (if any)
if (pagesNeedingOcr.length > 0) {
  onProgress?.(0, totalPages, true);
  
  const OCR_BATCH_SIZE = 4;
  let ocrCompleted = 0;
  
  for (let i = 0; i < pagesNeedingOcr.length; i += OCR_BATCH_SIZE) {
    if (shouldCancel?.()) break;
    
    const batch = pagesNeedingOcr.slice(i, i + OCR_BATCH_SIZE);
    
    // Render and OCR batch in parallel, mas atualizar progresso individualmente
    const batchPromises = batch.map(async (pageNum) => {
      const canvas = await renderPageForOCR(file, pageNum, OCR_SCALE_HIGH, true);
      const text = await ocrExtractor(canvas);
      
      // Atualizar progresso imediatamente após cada página (não após batch)
      ocrCompleted++;
      onProgress?.(nativeCount + ocrCompleted, totalPages, true);
      
      return { pageNum, text };
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    for (const { pageNum, text } of batchResults) {
      pageTexts[pageNum - 1] = text;
    }
    
    // Pause para UI
    if (i + OCR_BATCH_SIZE < pagesNeedingOcr.length) {
      await new Promise(r => setTimeout(r, 10));
    }
  }
}
```

### 3. Reduzir Logging Excessivo

Remover log por página individual, manter apenas log de batch:

```typescript
// Em ocrUtils.ts
export async function extractTextWithOCR(
  imageSource: string | HTMLCanvasElement,
  onProgress?: OcrProgressCallback
): Promise<string> {
  const sched = await initOcrScheduler();
  
  const startTime = performance.now();
  const result = await sched.addJob('recognize', imageSource);
  
  // Log condensado (sem "Starting...")
  const duration = ((performance.now() - startTime) / 1000).toFixed(2);
  // Só logar se demorar mais de 2s (evita spam)
  if (parseFloat(duration) > 2) {
    console.log(`[OCR] Slow page: ${duration}s, confidence: ${result.data.confidence}%`);
  }
  
  onProgress?.(100);
  return result.data.text;
}
```

---

## Arquivos a Modificar

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/ocrUtils.ts` | Adicionar timeout e reduzir logging |
| `src/lib/pdfCache.ts` | Progresso mais granular por página |

---

## Resumo das Correções

| Problema | Solução |
|----------|---------|
| Travamento sem feedback | Timeout de 30s por página com fallback |
| Progresso atualiza só após batch | Atualizar após cada página individual |
| 70 logs "Starting..." | Só logar páginas lentas (>2s) |
| Sem indicação de progresso real | Mostrar "pág. X/70" durante OCR |

---

## Resultado Esperado

- **70 páginas de comprovante**: Processadas em ~70-120 segundos (1-2 min)
- **Feedback visual**: Barra atualiza a cada página processada
- **Sem travamento**: Timeout garante que páginas problemáticas não bloqueiam
- **Console limpo**: Apenas logs significativos (páginas lentas)

