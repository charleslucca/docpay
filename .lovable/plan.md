
# Plano de Otimização da Extração de PDF

## Diagnóstico do Problema

Identifiquei as principais causas da lentidão comparado ao script Python:

### Problema 1: Worker sendo carregado via CDN
```typescript
// Código atual (lento)
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js`;
```

**Impacto:** Cada vez que o PDF.js inicializa, ele precisa baixar o worker da internet. Isso adiciona latência de rede (100-500ms) antes de qualquer processamento começar. O Python usa bibliotecas locais sem essa sobrecarga.

### Problema 2: Falta de CMaps e fontes padrão
PDFs brasileiros frequentemente usam codificações especiais de caracteres. Sem os CMaps configurados, o PDF.js pode ter dificuldades para extrair texto corretamente e fazer mais tentativas.

### Problema 3: Processamento sequencial de páginas
No loop atual (`getCachedPageTexts`), cada página é processada uma a uma com `await`:
```typescript
for (let i = 1; i <= pdf.numPages; i++) {
  const page = await pdf.getPage(i);  // Espera cada página
  const textContent = await page.getTextContent();
  // ...
}
```

O Python provavelmente processa páginas em paralelo ou tem acesso mais direto ao conteúdo.

### Problema 4: Vazamento de memória nas páginas
O PDF.js requer que você chame `page.cleanup()` após usar cada página para liberar memória. Sem isso, o Garbage Collector fica sobrecarregado.

---

## Correções a Implementar

### Correção 1: Servir o PDF Worker localmente

**Arquivo:** `public/` (novo arquivo)

Copiar o worker do PDF.js para o projeto para eliminar latência de rede.

**Arquivo:** `src/lib/pdfCache.ts`

```text
// ANTES:
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js`;

// DEPOIS:
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
```

### Correção 2: Configurar CMaps e Standard Fonts

**Arquivo:** `src/lib/pdfCache.ts`

Adicionar configuração ao carregar PDFs:
```text
const pdf = await pdfjs.getDocument({
  data: buffer.slice(0),
  cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/standard_fonts/',
}).promise;
```

### Correção 3: Processar páginas em paralelo (batches)

**Arquivo:** `src/lib/pdfCache.ts`

Mudar o loop sequencial para processamento paralelo em lotes:
```text
// ANTES (sequencial):
for (let i = 1; i <= pdf.numPages; i++) {
  const page = await pdf.getPage(i);
  // ...
}

// DEPOIS (paralelo em batches de 5):
const PAGE_BATCH_SIZE = 5;
for (let start = 1; start <= pdf.numPages; start += PAGE_BATCH_SIZE) {
  const end = Math.min(start + PAGE_BATCH_SIZE, pdf.numPages + 1);
  const pagePromises = [];
  
  for (let i = start; i < end; i++) {
    pagePromises.push(extractPageText(pdf, i));
  }
  
  const batchResults = await Promise.all(pagePromises);
  pageTexts.push(...batchResults);
}
```

### Correção 4: Limpar páginas após uso

**Arquivo:** `src/lib/pdfCache.ts`

Adicionar `page.cleanup()` após extrair texto de cada página para liberar memória:
```text
const page = await pdf.getPage(i);
const textContent = await page.getTextContent();
const text = textContent.items.map((item: any) => item.str).join(' ');
page.cleanup(); // Liberar memória!
```

### Correção 5: Extrair apenas primeira página dos holerites

**Arquivo:** `src/hooks/useDocumentProcessor.ts`

Os holerites geralmente têm o nome do funcionário na primeira página. Extrair apenas a primeira página em vez de todas:
```text
// ANTES:
const { text } = await extractTextFromPdf(holerite.file, cachedPdf);

// DEPOIS:
const page = await cachedPdf.getPage(1);
const textContent = await page.getTextContent();
const text = textContent.items.map((item: any) => item.str).join(' ');
page.cleanup();
```

---

## Arquivos a Modificar

1. **`src/lib/pdfCache.ts`** - Otimizar configuração do PDF.js e processar páginas em paralelo
2. **`src/hooks/useDocumentProcessor.ts`** - Extrair apenas primeira página dos holerites
3. **`vite.config.ts`** - Configurar para copiar o worker para public (opcional, usar CDN local como fallback)

---

## Comparação de Performance

| Operação | Antes | Depois |
|----------|-------|--------|
| Carregamento do worker | 100-500ms (rede) | ~5ms (local) |
| Extração de 10 páginas | ~10s (sequencial) | ~2s (paralelo) |
| Vazamento de memória | Sim | Não (cleanup) |
| CMaps | Não configurado | Configurado |

**Ganho estimado: 5-10x mais rápido**

---

## Detalhes Técnicos

### Nova estrutura do getCachedPageTexts

```text
export async function getCachedPageTexts(
  file: File,
  shouldCancel?: () => boolean
): Promise<string[]> {
  const key = getFileKey(file);
  
  let pageTexts = pageTextCache.get(key);
  if (pageTexts) {
    return pageTexts; // Cache hit - retorno imediato
  }
  
  const pdf = await getCachedPdf(file);
  pageTexts = [];
  
  const PAGE_BATCH_SIZE = 5;
  
  // Processar em batches paralelos
  for (let start = 1; start <= pdf.numPages; start += PAGE_BATCH_SIZE) {
    if (shouldCancel?.()) break;
    
    const end = Math.min(start + PAGE_BATCH_SIZE, pdf.numPages + 1);
    const pagePromises: Promise<string>[] = [];
    
    for (let i = start; i < end; i++) {
      pagePromises.push(extractSinglePageText(pdf, i));
    }
    
    const batchResults = await Promise.all(pagePromises);
    pageTexts.push(...batchResults);
  }
  
  if (!shouldCancel?.()) {
    pageTextCache.set(key, pageTexts);
  }
  
  return pageTexts;
}

async function extractSinglePageText(pdf: PDFDocumentProxy, pageNum: number): Promise<string> {
  const page = await pdf.getPage(pageNum);
  const textContent = await page.getTextContent();
  const text = textContent.items.map((item: any) => item.str).join(' ');
  page.cleanup(); // Liberar memória!
  return text;
}
```

### Extração otimizada de holerites (apenas página 1)

```text
// Em processHolerite:
const cachedPdf = await getCachedPdf(holerite.file);

// Extrair apenas primeira página (onde está o nome)
const page = await cachedPdf.getPage(1);
const textContent = await page.getTextContent();
const text = textContent.items.map((item: any) => item.str).join(' ');
page.cleanup();

const extractedName = extractEmployeeName(text);
```

---

## Fallback para Worker

Se não conseguir servir localmente, usar CDN com fallback:
```text
// Tentar local primeiro, fallback para CDN
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

// Se falhar, o PDF.js irá degradar graciosamente para modo sem worker
// Alternativamente, usar jsDelivr que é geralmente mais rápido:
// 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs'
```

---

## Resultado Esperado

Após as otimizações:
- Extração de nomes de 50 holerites: de ~60s para ~5-10s
- Pré-extração de comprovantes: de ~120s para ~15-20s
- Total para 50 funcionários: de ~3 minutos para ~30 segundos
- Performance comparável ao script Python
