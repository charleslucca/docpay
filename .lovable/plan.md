
# Análise de Performance: Por que a Extração ficou Lenta

## Diagnóstico Completo

Após analisar o código, identifiquei **5 gargalos principais** que explicam a lentidão no processamento:

---

## Gargalo 1: Auto-Retry de OCR Duplica o Tempo

**Localização:** `src/lib/pdfCache.ts`, linhas 378-412

**Problema:**
Quando o OCR retorna texto curto (<40 chars), o sistema automaticamente faz retry com escala maior (3.0) e timeout estendido (45s). Isso foi adicionado para melhorar a qualidade, mas:
- Cada página com pouco texto faz **2 OCRs** em vez de 1
- A escala 3.0 gera imagem **2.25x maior** que a 2.0 (9 vs 4 megapixels)
- O retry usa timeout de 45s (vs 30s original)

**Impacto:** Para um PDF de 70 páginas onde 50% das páginas têm texto curto, o tempo pode **dobrar ou triplicar**.

```typescript
// Código problemático - retry automático mesmo quando desnecessário
if (opts.retryOnShortText && result.text.trim().length < opts.minAcceptableTextLen && !result.timedOut) {
  metrics.retryCount++;
  canvas = await renderPageForOCR(file, pageNum, opts.scaleRetry, true); // Escala 3.0!
  const retryResult = await ocrExtractor(canvas, { timeoutMs: opts.timeoutRetryMs }); // 45s!
  ...
}
```

---

## Gargalo 2: Processamento Sequencial de Comprovantes

**Localização:** `src/hooks/useDocumentProcessor.ts`, linha 829

**Problema:**
Os comprovantes são processados **um de cada vez** (concurrency = 1):
```typescript
await processInBatches(comprovanteList, preExtractComprovante, 1, cancelledRef);
```

Enquanto isso faz sentido para evitar sobrecarga de memória, o resultado é que o OCR fica subutilizado durante a extração de texto nativo.

**Impacto:** Para múltiplos comprovantes, o tempo é linear em vez de paralelo.

---

## Gargalo 3: OCR em Batch de 4 é Conservador Demais

**Localização:** `src/lib/pdfCache.ts`, linha 369

**Problema:**
O OCR de comprovantes processa páginas em batches de apenas 4:
```typescript
const OCR_BATCH_SIZE = 4;
```

Mas o pool de workers tem **até 8 workers** disponíveis. Isso significa que metade dos workers podem estar ociosos.

**Impacto:** Throughput de OCR reduzido em ~50%.

---

## Gargalo 4: Dupla Chamada ao Scheduler (extractTextWithOCRResult)

**Localização:** `src/lib/pdfCache.ts`, linhas 754-758

**Problema:**
Na extração de comprovantes, o código usa `extractTextWithOCRResult` que passa pelo scheduler normalmente. Mas essa função foi projetada para uso individual, não em batch.

Comparando:
- `extractTextBatch` (usado nos holerites): Dispara N jobs simultaneamente → máxima eficiência
- `extractTextWithOCRResult` (usado nos comprovantes): Dispara 1 job por vez com timeout → overhead

```typescript
// Comprovantes - menos eficiente
const result = await ocrExtractor(canvas, { timeoutMs: opts.timeoutPrimaryMs });

// Holerites - mais eficiente
const texts = await extractTextBatch(batch.map(b => b.canvas), ...);
```

---

## Gargalo 5: Renderização Bloqueante (Scale 2.0-3.0)

**Localização:** `src/lib/pdfCache.ts`, linhas 299-301

**Problema:**
A escala padrão para comprovantes é 2.0, mas no enhanced mode ou retry sobe para 3.0. Isso cria canvases enormes:
- Scale 1.5 (holerites): ~2 megapixels
- Scale 2.0 (comprovantes): ~4 megapixels
- Scale 3.0 (retry/enhanced): ~9 megapixels

A renderização de cada página a scale 3.0 pode levar 1-2 segundos só para criar o canvas.

---

## Solução Proposta: Otimizações de Alto Impacto

### 1. Desabilitar Auto-Retry por Padrão
O retry automático é útil apenas quando há problemas graves de OCR. Para processamento normal, deve estar desligado:

```typescript
// Mudar default em pdfCache.ts
retryOnShortText: options?.retryOnShortText ?? false, // Era true
```

Manter a opção disponível para o botão "OCR Reforçado" que o usuário pode acionar manualmente.

### 2. Usar Batch OCR nos Comprovantes (como nos Holerites)
Refatorar a extração de comprovantes para usar o mesmo pattern pipeline dos holerites:
- Renderizar páginas em paralelo (queue)
- Processar OCR em batch de `workerCount` páginas
- Reutilizar `extractTextBatch` em vez de `extractTextWithOCRResult`

### 3. Aumentar Batch Size para Match Worker Count
```typescript
const OCR_BATCH_SIZE = Math.max(4, getWorkerCount()); // 4-8 dependendo do hardware
```

### 4. Reduzir Escala Inicial para 1.8 (vs 2.0)
A diferença de qualidade entre 1.8 e 2.0 é mínima, mas a performance é ~20% melhor:
```typescript
export const OCR_SCALE_HIGH = 1.8;  // Era 2.0
```

### 5. Cache de Texto Nativo Mais Agressivo
Antes de qualquer OCR, verificar se já existe texto nativo suficiente:
```typescript
// Se texto nativo >= 100 chars, pular OCR completamente
const MIN_TEXT_LENGTH_FOR_OCR = 100; // Era 50
```

---

## Arquivos a Modificar

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/pdfCache.ts` | Desabilitar retry por padrão, aumentar batch size, reduzir escala |
| `src/hooks/useDocumentProcessor.ts` | Refatorar extração de comprovantes para usar batch OCR |
| `src/lib/ocrUtils.ts` | (Nenhuma mudança necessária - já está otimizado) |

---

## Impacto Esperado

| Métrica | Antes | Depois |
|---------|-------|--------|
| Tempo por página (comprovante) | ~4-8s | ~1.5-2s |
| Retries | 30-50% das páginas | 0% (manual) |
| Utilização de workers | 50-70% | 90-100% |
| Throughput geral | 1-2 páginas/s | 3-5 páginas/s |

---

## Resumo das Mudanças (Detalhes Técnicos)

### `src/lib/pdfCache.ts`:
1. Linha 104: `retryOnShortText: false` como padrão
2. Linha 202: `OCR_SCALE_HIGH = 1.8`
3. Linha 103: `MIN_TEXT_LENGTH_FOR_OCR = 100`
4. Linha 369: `OCR_BATCH_SIZE = getWorkerCount()`

### `src/hooks/useDocumentProcessor.ts`:
1. Refatorar `preExtractComprovante` para usar pipeline igual ao `processHolerite`:
   - Render loop + OCR loop em paralelo
   - Usar `extractTextBatch` em vez de `extractTextWithOCRResult`
   - Remover chamada individual por página

---

## Critérios de Aceite
1. Processamento de 70 páginas de comprovante: **< 2 minutos** (era ~5-10min)
2. Sem retry automático durante processamento normal
3. Botão "OCR Reforçado" continua funcionando para casos difíceis
4. UI responsiva durante todo o processo (já está OK)
