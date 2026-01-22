
# Plano: Paralelização do OCR com Worker Pool (Scheduler)

## Problema Atual

O processamento de um PDF com 691 páginas está demorando porque:
- Usa apenas **1 worker OCR** (singleton)
- Processa página por página **sequencialmente**
- Cada página leva ~2-3 segundos de OCR
- Total estimado: 691 × 2.5s = **~29 minutos**

## Solução: Tesseract.js Scheduler

O Tesseract.js possui uma API de **Scheduler** que gerencia um pool de workers e distribui jobs automaticamente. Com 4 workers paralelos, podemos processar 4 páginas simultaneamente, reduzindo o tempo para ~7-8 minutos.

---

## Arquitetura da Solução

```text
┌─────────────────────────────────────────────────────────────────┐
│                    SCHEDULER (Pool Manager)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐           │
│   │ Worker  │  │ Worker  │  │ Worker  │  │ Worker  │           │
│   │   #1    │  │   #2    │  │   #3    │  │   #4    │           │
│   └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘           │
│        │            │            │            │                  │
│        ▼            ▼            ▼            ▼                  │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐           │
│   │ Pág. 1  │  │ Pág. 2  │  │ Pág. 3  │  │ Pág. 4  │           │
│   │ Pág. 5  │  │ Pág. 6  │  │ Pág. 7  │  │ Pág. 8  │           │
│   │  ...    │  │  ...    │  │  ...    │  │  ...    │           │
│   └─────────┘  └─────────┘  └─────────┘  └─────────┘           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
               Páginas processadas em paralelo!
               691 páginas ÷ 4 workers = ~173 batches
               Tempo estimado: ~8 minutos
```

---

## Mudanças a Implementar

### Mudança 1: Refatorar ocrUtils.ts para usar Scheduler

**Arquivo:** `src/lib/ocrUtils.ts`

Substituir o worker singleton por um Scheduler com pool de workers:

```typescript
import { createScheduler, createWorker, Scheduler, Worker } from 'tesseract.js';

let scheduler: Scheduler | null = null;
const WORKER_COUNT = 4; // Número de workers paralelos

export async function initOcrScheduler(): Promise<Scheduler> {
  if (scheduler) return scheduler;
  
  console.log(`[OCR] Initializing scheduler with ${WORKER_COUNT} workers...`);
  
  scheduler = createScheduler();
  
  // Criar workers em paralelo
  const workerPromises = Array.from({ length: WORKER_COUNT }, async () => {
    const worker = await createWorker('por', 1, {
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-simd.wasm.js',
      langPath: 'https://tessdata.projectnaptha.com/4.0.0_best',
    });
    return worker;
  });
  
  const workers = await Promise.all(workerPromises);
  workers.forEach(w => scheduler!.addWorker(w));
  
  console.log(`[OCR] Scheduler ready with ${WORKER_COUNT} workers`);
  return scheduler;
}

// Nova função para processar em batch
export async function extractTextBatch(
  canvases: HTMLCanvasElement[],
  onProgress?: (completed: number, total: number) => void
): Promise<string[]> {
  const sched = await initOcrScheduler();
  let completed = 0;
  
  const promises = canvases.map(async (canvas) => {
    const result = await sched.addJob('recognize', canvas);
    completed++;
    onProgress?.(completed, canvases.length);
    return result.data.text;
  });
  
  return Promise.all(promises);
}
```

### Mudança 2: Processar Páginas em Lotes Paralelos

**Arquivo:** `src/hooks/useDocumentProcessor.ts`

Modificar `processHolerite` para processar páginas em lotes de 20:

```typescript
const PAGES_PER_BATCH = 20;

// Dentro de processHolerite:
for (let batchStart = 1; batchStart <= totalPages; batchStart += PAGES_PER_BATCH) {
  if (cancelledRef.current) break;
  
  const batchEnd = Math.min(batchStart + PAGES_PER_BATCH - 1, totalPages);
  const pageNumbers = Array.from(
    { length: batchEnd - batchStart + 1 }, 
    (_, i) => batchStart + i
  );
  
  setStatus(prev => ({
    ...prev,
    message: `OCR em ${holerite.name} (pág. ${batchStart}-${batchEnd} de ${totalPages})...`,
  }));
  
  // Renderizar todas as páginas do batch em paralelo
  const canvases = await Promise.all(
    pageNumbers.map(pageNum => renderPageForOCR(holerite.file, pageNum, 2.5))
  );
  
  // Processar OCR em paralelo com o scheduler
  const texts = await extractTextBatch(canvases, (done, total) => {
    const overallProgress = ((batchStart - 1 + done) / totalPages) * 100;
    setStatus(prev => ({ ...prev, ocrProgress: overallProgress }));
  });
  
  // Extrair nomes dos textos
  for (let i = 0; i < texts.length; i++) {
    const name = extractEmployeeName(texts[i]);
    if (name) {
      entries.push({
        originalHolerite: holerite,
        name,
        pageNumber: pageNumbers[i],
      });
    }
  }
}
```

### Mudança 3: Atualizar Feedback de Progresso

O progresso será mostrado como:
```
"OCR em RECIBO.pdf (pág. 1-20 de 691)..."
"OCR em RECIBO.pdf (pág. 21-40 de 691)..."
```

Com uma barra de progresso geral mostrando a porcentagem total.

---

## Arquivos a Modificar

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/ocrUtils.ts` | Implementar Scheduler com pool de 4 workers + função `extractTextBatch` |
| `src/hooks/useDocumentProcessor.ts` | Processar páginas em lotes de 20, usar `extractTextBatch` |
| `src/components/ProcessingStatus.tsx` | Atualizar mensagens para mostrar range de páginas |

---

## Estimativa de Performance

| Cenário | Antes | Depois |
|---------|-------|--------|
| 691 páginas | ~29 min | ~8 min |
| 100 páginas | ~4 min | ~1 min |
| 4 páginas | ~10 seg | ~3 seg |

Melhoria: **~4x mais rápido**

---

## Considerações de Memória

- Cada worker OCR usa ~50-100MB de RAM
- 4 workers = ~400MB de RAM
- Lotes de 20 páginas = ~20 canvas em memória por vez
- Após cada batch, os canvas são liberados

O número de workers (4) é conservador para funcionar em máquinas modestas. Podemos ajustar dinamicamente baseado em `navigator.hardwareConcurrency` para usar mais cores em máquinas potentes.

---

## Resultado Esperado

1. O processamento de 691 páginas levará ~8 minutos ao invés de ~29 minutos
2. O progresso mostrará batches de páginas sendo processados
3. O scheduler gerencia automaticamente a distribuição de trabalho
4. A memória será gerenciada com liberação após cada batch
