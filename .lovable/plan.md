
# Plano: Implementar OCR com Tesseract.js para PDFs Escaneados

## Diagnóstico Confirmado

Os holerites são **PDFs escaneados** (imagens), não têm texto selecionável. O PDF.js retorna string vazia ou lixo, por isso o `extractEmployeeName` falha. A solução é usar **Tesseract.js** (já instalado) para fazer OCR na imagem renderizada do PDF.

---

## Arquitetura da Solução

```text
┌─────────────────────────────────────────────────────────────────┐
│                    FLUXO DE EXTRAÇÃO DE NOME                     │
├─────────────────────────────────────────────────────────────────┤
│  1. Renderizar página 1 do PDF como imagem (canvas)             │
│                         ↓                                        │
│  2. Enviar imagem para Tesseract.js (OCR em português)          │
│                         ↓                                        │
│  3. Receber texto reconhecido                                   │
│                         ↓                                        │
│  4. Aplicar extractEmployeeName() no texto OCR                  │
│                         ↓                                        │
│  5. Retornar nome extraído                                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Mudanças a Implementar

### Mudança 1: Criar módulo de OCR (`src/lib/ocrUtils.ts`)

Criar um novo arquivo para encapsular toda a lógica do Tesseract.js:

**Funcionalidades:**
- Inicialização lazy do worker (só carrega quando necessário)
- Singleton do worker para reutilizar entre chamadas
- Função `extractTextWithOCR(imageDataUrl)` para processar imagem
- Callback de progresso para feedback visual
- Terminação do worker quando não mais necessário

**Configuração do Tesseract:**
```text
createWorker('por', 1, {
  workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
  corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-simd.wasm.js',
  langPath: 'https://tessdata.projectnaptha.com/4.0.0_best',
  logger: progressCallback
})
```

### Mudança 2: Criar função de renderização otimizada para OCR

**Arquivo:** `src/lib/pdfCache.ts`

Adicionar função `renderPageForOCR(file, pageNumber, scale)`:
- Renderiza a página do PDF em alta resolução (scale 2.0-3.0)
- Retorna canvas ou data URL para o Tesseract
- Usa escala maior que preview para melhor precisão de OCR

### Mudança 3: Modificar fluxo de extração de nomes

**Arquivo:** `src/hooks/useDocumentProcessor.ts`

Alterar `processHolerite` para:
1. Renderizar página 1 como imagem
2. Enviar para OCR (Tesseract)
3. Aplicar `extractEmployeeName` no texto OCR
4. Atualizar progresso durante OCR (0-100%)
5. Atualizar status com "Executando OCR..."

### Mudança 4: Atualizar interface de status

**Arquivo:** `src/types/document.ts`

Adicionar campo opcional para progresso do OCR:
```text
ocrProgress?: number; // 0-100 durante OCR
```

### Mudança 5: Exibir progresso do OCR na UI

**Arquivo:** `src/components/ProcessingStatus.tsx`

Mostrar barra de progresso secundária quando OCR estiver ativo.

---

## Detalhes Técnicos

### Novo arquivo: `src/lib/ocrUtils.ts`

```text
import { createWorker, Worker } from 'tesseract.js';

let ocrWorker: Worker | null = null;
let isInitializing = false;

type ProgressCallback = (progress: number) => void;

export async function initOcrWorker(onProgress?: ProgressCallback): Promise<Worker> {
  if (ocrWorker) return ocrWorker;
  
  if (isInitializing) {
    // Esperar inicialização em andamento
    while (isInitializing) {
      await new Promise(r => setTimeout(r, 100));
    }
    return ocrWorker!;
  }
  
  isInitializing = true;
  
  ocrWorker = await createWorker('por', 1, {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-simd.wasm.js',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0_best',
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });
  
  isInitializing = false;
  return ocrWorker;
}

export async function extractTextWithOCR(
  imageSource: string | HTMLCanvasElement,
  onProgress?: ProgressCallback
): Promise<string> {
  const worker = await initOcrWorker(onProgress);
  const result = await worker.recognize(imageSource);
  return result.data.text;
}

export async function terminateOcrWorker(): Promise<void> {
  if (ocrWorker) {
    await ocrWorker.terminate();
    ocrWorker = null;
  }
}
```

### Nova função em `src/lib/pdfCache.ts`

```text
export async function renderPageForOCR(
  file: File,
  pageNumber: number = 1,
  scale: number = 2.5
): Promise<HTMLCanvasElement> {
  const pdf = await getCachedPdf(file);
  const page = await pdf.getPage(pageNumber);
  
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  
  await page.render({
    canvasContext: context,
    viewport: viewport,
  }).promise;
  
  page.cleanup();
  return canvas;
}
```

### Modificação em `useDocumentProcessor.ts`

```text
// Importar novas funções
import { extractTextWithOCR, terminateOcrWorker } from '@/lib/ocrUtils';
import { renderPageForOCR } from '@/lib/pdfCache';

// Dentro de processHolerite:
const processHolerite = async (holerite: UploadedFile, index: number): Promise<UploadedFile> => {
  // ... setup inicial ...
  
  setStatus(prev => ({
    ...prev,
    message: `Executando OCR em ${holerite.name}...`,
    currentItem: holerite.name,
  }));

  try {
    // 1. Renderizar página 1 para OCR
    const canvas = await renderPageForOCR(holerite.file, 1, 2.5);
    
    // 2. Executar OCR com callback de progresso
    const ocrText = await extractTextWithOCR(canvas, (progress) => {
      setStatus(prev => ({
        ...prev,
        ocrProgress: progress,
      }));
    });
    
    console.log('=== TEXTO OCR ===');
    console.log('Arquivo:', holerite.name);
    console.log('Texto (500 chars):', ocrText.substring(0, 500));
    console.log('=================');
    
    // 3. Extrair nome do texto OCR
    const extractedName = extractEmployeeName(ocrText);
    
    // ... resto do processamento ...
  }
  // ...
};
```

---

## Arquivos a Criar/Modificar

1. **`src/lib/ocrUtils.ts`** (NOVO) - Módulo de OCR com Tesseract.js
2. **`src/lib/pdfCache.ts`** - Adicionar `renderPageForOCR()`
3. **`src/hooks/useDocumentProcessor.ts`** - Usar OCR em vez de extração de texto
4. **`src/types/document.ts`** - Adicionar `ocrProgress?` ao ProcessingStatus
5. **`src/components/ProcessingStatus.tsx`** - Exibir progresso do OCR

---

## Fluxo de Inicialização do Worker

```text
┌──────────────────────────────────────────────────────────────────┐
│                  INICIALIZAÇÃO DO TESSERACT                       │
├──────────────────────────────────────────────────────────────────┤
│  1ª chamada:                                                      │
│    ├─ Baixa worker.min.js (~500KB)                               │
│    ├─ Baixa tesseract-core-simd.wasm.js (~5MB)                   │
│    ├─ Baixa por.traineddata.gz (~10MB)                           │
│    └─ ~10-30 segundos (primeira vez)                             │
│                                                                   │
│  Chamadas subsequentes:                                           │
│    └─ Reutiliza worker em memória (~1-3s por página)             │
└──────────────────────────────────────────────────────────────────┘
```

---

## Considerações de Performance

| Operação | Tempo Estimado |
|----------|----------------|
| Primeira inicialização OCR | 10-30s (download) |
| OCR por página (após init) | 2-5s |
| Processamento de 50 holerites | ~3-4 minutos |

**Otimizações aplicadas:**
- Worker singleton (reutilizado entre arquivos)
- Escala 2.5x para boa precisão sem exagerar
- Apenas página 1 é processada
- Progresso visual para feedback ao usuário

---

## Mensagens de Feedback

Durante o processamento, o usuário verá:

```text
"Inicializando OCR (primeira vez pode demorar)..."  → Download inicial
"Executando OCR em documento_001.pdf..."           → Durante OCR
"OCR: 45% concluído"                               → Progresso
"Nome extraído: CARLOS HENRIQUE DA SILVA MARIANO"  → Sucesso
```

---

## Resultado Esperado

Após implementação:
- PDFs escaneados terão nomes extraídos corretamente via OCR
- Primeira execução demora mais (download do modelo)
- Execuções seguintes são mais rápidas (worker reutilizado)
- Feedback visual claro do progresso do OCR
- Nome "CARLOS HENRIQUE DA SILVA MARIANO" será extraído do exemplo
