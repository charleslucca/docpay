
# Plano: Otimização de Performance do OCR

## Análise do Problema

### Dados dos Logs
| Métrica | Valor Atual |
|---------|-------------|
| Velocidade OCR | **0.4-0.5 páginas/segundo** |
| Tempo por batch (4 páginas) | 7-9 segundos |
| Para 691 páginas | **~25 minutos** |
| Resolução de renderização | 1488x2104px (scale 2.5) |

### Gargalos Identificados

1. **Resolução muito alta para OCR**
   - Renderização atual: `scale = 2.5` → 1488x2104px por página
   - O Tesseract.js processa cada pixel - imagens maiores = muito mais lento
   - Para extração de nomes, não precisa de resolução tão alta

2. **Rendering sequencial dentro do batch**
   - Páginas são renderizadas uma a uma ANTES de iniciar o OCR
   - Isso adiciona ~1-2s de latência por batch

3. **Workers não estão sendo utilizados eficientemente**
   - 4 workers paralelos, mas cada um processa imagens de 3MP+
   - O overhead de comunicação com WASM é alto para imagens grandes

4. **Sem pré-processamento de imagem**
   - Imagens coloridas são mais pesadas de processar
   - Converter para escala de cinza acelera significativamente o OCR

---

## Soluções Propostas

### Otimização 1: Reduzir Resolução de Renderização

**Impacto:** ⭐⭐⭐⭐⭐ (maior ganho)

Reduzir scale de **2.5 para 1.5** para holerites:
- Resolução: 1488x2104 → **892x1262px** (3x menos pixels)
- Ainda suficiente para OCR de texto grande em holerites
- Ganho esperado: **2-3x mais rápido**

```typescript
// ANTES: renderPageForOCR(..., 2.5)
// DEPOIS: renderPageForOCR(..., 1.5) // Para holerites
```

### Otimização 2: Pipeline Paralelo (Render + OCR)

**Impacto:** ⭐⭐⭐⭐

Em vez de: Render 4 → OCR 4 → Render 4 → OCR 4
Fazer: Render+OCR em pipeline contínuo

```text
┌─────────────────────────────────────────────────────────┐
│ ATUAL (Sequencial por Batch)                           │
├─────────────────────────────────────────────────────────┤
│ [Render P1][Render P2][Render P3][Render P4]           │
│                                        │               │
│                                        ▼               │
│           [────── OCR em Paralelo ──────]              │
│                                        │               │
│                                        ▼               │
│ [Render P5][Render P6][Render P7][Render P8]           │
│                                        ▼               │
│           [────── OCR em Paralelo ──────]              │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ PROPOSTO (Pipeline Contínuo)                           │
├─────────────────────────────────────────────────────────┤
│ [Render P1][Render P2][Render P3][Render P4]...        │
│         │                                              │
│         └──► [OCR P1]                                  │
│                  └──► [OCR P2]                         │
│                           └──► [OCR P3]...             │
│                                                        │
│ Workers nunca ficam ociosos esperando renders!         │
└─────────────────────────────────────────────────────────┘
```

### Otimização 3: Pré-processamento de Imagem

**Impacto:** ⭐⭐⭐

Converter canvas para escala de cinza antes do OCR:
- Reduz dados transferidos para WASM em ~3x
- OCR precisa apenas de luminância, não de cor

```typescript
function convertToGrayscale(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    data[i] = data[i + 1] = data[i + 2] = gray;
  }
  
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}
```

### Otimização 4: Aumentar Pool de Workers

**Impacto:** ⭐⭐

Atualmente: `min(6, max(2, cores/2))` → geralmente 4 workers

Proposta: `min(8, max(4, cores * 0.75))` → até 8 workers

Mais workers = mais páginas processadas em paralelo

### Otimização 5: Cache de Resultados OCR por Página

**Impacto:** ⭐⭐

Se o usuário reprocessar ou retomar, não refazer OCR de páginas já processadas:

```typescript
const ocrResultCache = new Map<string, string>(); // pageKey -> text

function getOcrCacheKey(file: File, pageNum: number): string {
  return `${file.name}_${file.size}_${pageNum}`;
}
```

---

## Estimativa de Ganho

| Otimização | Ganho Esperado |
|------------|----------------|
| Reduzir scale 2.5 → 1.5 | **2-3x** |
| Pipeline paralelo | **1.3-1.5x** |
| Escala de cinza | **1.2-1.4x** |
| Mais workers | **1.3-1.5x** |
| **TOTAL COMBINADO** | **4-8x mais rápido** |

**Tempo para 691 páginas:**
- Atual: ~25 minutos
- Otimizado: **3-6 minutos**

---

## Arquivos a Modificar

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/pdfCache.ts` | Adicionar função de conversão grayscale, ajustar scale padrão |
| `src/lib/ocrUtils.ts` | Aumentar pool de workers, adicionar cache de resultados |
| `src/hooks/useDocumentProcessor.ts` | Implementar pipeline paralelo render+OCR |

---

## Implementação Detalhada

### 1. `pdfCache.ts` - Reduzir resolução e adicionar grayscale

```typescript
// Nova escala otimizada para OCR (1.5 em vez de 2.5)
const OCR_SCALE_FAST = 1.5;  // Para holerites (texto grande)
const OCR_SCALE_HIGH = 2.0;  // Para comprovantes (texto pequeno)

// Função para converter para grayscale
function applyGrayscale(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    data[i] = data[i + 1] = data[i + 2] = gray;
  }
  
  ctx.putImageData(imageData, 0, 0);
}

// Atualizar renderPageForOCR para aplicar grayscale
export async function renderPageForOCR(
  file: File,
  pageNumber: number = 1,
  scale: number = OCR_SCALE_FAST,
  grayscale: boolean = true
): Promise<HTMLCanvasElement> {
  // ... renderização existente ...
  
  if (grayscale) {
    applyGrayscale(canvas);
  }
  
  return canvas;
}
```

### 2. `ocrUtils.ts` - Aumentar workers e adicionar cache

```typescript
// Aumentar limite de workers
const WORKER_COUNT = Math.min(8, Math.max(4, Math.floor((navigator.hardwareConcurrency || 4) * 0.75)));

// Cache de resultados OCR
const ocrResultCache = new Map<string, string>();

export function getOcrCacheKey(fileName: string, pageNum: number): string {
  return `${fileName}_${pageNum}`;
}

export function getCachedOcrResult(key: string): string | undefined {
  return ocrResultCache.get(key);
}

export function setCachedOcrResult(key: string, text: string): void {
  ocrResultCache.set(key, text);
  // Limitar tamanho do cache
  if (ocrResultCache.size > 1000) {
    const firstKey = ocrResultCache.keys().next().value;
    ocrResultCache.delete(firstKey);
  }
}
```

### 3. `useDocumentProcessor.ts` - Pipeline Paralelo

```typescript
// Novo: processar em pipeline contínuo
const processHoleritePipeline = async (
  holerite: UploadedFile,
  index: number,
  resumeFromPage: number = 1
): Promise<HoleriteEntry[]> => {
  const pdf = await getCachedPdf(holerite.file);
  const totalPages = pdf.numPages;
  const entries: HoleriteEntry[] = [];
  const workerCount = getWorkerCount();
  
  // Queue de canvases prontos para OCR
  const canvasQueue: { pageNum: number; canvas: HTMLCanvasElement }[] = [];
  let renderingComplete = false;
  let ocrComplete = false;
  let nextPageToRender = resumeFromPage;
  let pagesProcessed = 0;
  
  // Função de renderização contínua
  const renderLoop = async () => {
    while (nextPageToRender <= totalPages && !cancelledRef.current) {
      // Manter queue com até workerCount * 2 items
      while (canvasQueue.length < workerCount * 2 && nextPageToRender <= totalPages) {
        const pageNum = nextPageToRender++;
        const canvas = await renderPageForOCR(holerite.file, pageNum, 1.5, true);
        canvasQueue.push({ pageNum, canvas });
      }
      
      // Pequena pausa para dar chance ao OCR
      await new Promise(r => setTimeout(r, 10));
    }
    renderingComplete = true;
  };
  
  // Função de OCR contínuo
  const ocrLoop = async () => {
    while (!ocrComplete && !cancelledRef.current) {
      // Processar batch do tamanho do worker pool
      const batch: { pageNum: number; canvas: HTMLCanvasElement }[] = [];
      
      while (batch.length < workerCount && canvasQueue.length > 0) {
        batch.push(canvasQueue.shift()!);
      }
      
      if (batch.length > 0) {
        const texts = await extractTextBatch(batch.map(b => b.canvas));
        
        for (let i = 0; i < texts.length; i++) {
          const name = extractEmployeeName(texts[i]);
          if (name) {
            entries.push({
              originalHolerite: holerite,
              name,
              pageNumber: batch[i].pageNum,
            });
          }
          pagesProcessed++;
        }
        
        // Atualizar progresso
        setStatus(prev => ({
          ...prev,
          ocrProgress: Math.round((pagesProcessed / totalPages) * 100),
        }));
      }
      
      // Verificar se terminou
      if (renderingComplete && canvasQueue.length === 0) {
        ocrComplete = true;
      } else if (canvasQueue.length === 0) {
        // Aguardar mais canvases
        await new Promise(r => setTimeout(r, 50));
      }
    }
  };
  
  // Executar render e OCR em paralelo
  await Promise.all([renderLoop(), ocrLoop()]);
  
  return entries;
};
```

---

## Resumo das Mudanças

1. **Reduzir scale de 2.5 para 1.5** - ganho imediato de 2-3x
2. **Converter imagens para grayscale** - reduz dados para WASM
3. **Aumentar pool de workers para 8** - mais paralelismo
4. **Pipeline contínuo render+OCR** - workers nunca ficam ociosos
5. **Cache de resultados OCR** - evita reprocessamento

**Resultado esperado:** Processamento 4-8x mais rápido, reduzindo ~25 minutos para ~3-6 minutos.
