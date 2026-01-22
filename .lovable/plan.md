
# Correção: Suporte a PDFs Multi-Página e OCR nos Comprovantes

## Problemas Identificados

### Problema 1: Só extrai 1 nome de 4
O arquivo "RECIBO B SERVICE - Amostra2.pdf" contém **4 funcionários em páginas diferentes**, mas o sistema atual:
- Faz OCR **apenas na página 1** (`renderPageForOCR(holerite.file, 1, 2.5)`)
- Extrai um único nome por arquivo
- Ignora as páginas 2, 3, 4...

### Problema 2: Busca nos comprovantes não funciona
Os comprovantes também são **PDFs escaneados**, mas a função `getCachedPageTexts` usa extração de texto nativa (PDF.js), que retorna texto vazio para imagens. Por isso:
- O `pageTexts` array contém strings vazias
- A busca por nome nunca encontra correspondência
- O processo demora porque está tentando extrair texto de imagens (sem sucesso)

---

## Arquitetura da Solução

```text
┌─────────────────────────────────────────────────────────────────┐
│          NOVO FLUXO: HOLERITES MULTI-PÁGINA                      │
├─────────────────────────────────────────────────────────────────┤
│  1. Detectar número de páginas no PDF                           │
│                         ↓                                        │
│  2. Para CADA PÁGINA do PDF:                                     │
│      a. Renderizar página como imagem                           │
│      b. Executar OCR                                            │
│      c. Extrair nome do funcionário                             │
│      d. Criar "holerite virtual" com pageNumber                 │
│                         ↓                                        │
│  3. Retornar array de nomes (um por página com funcionário)     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│          NOVO FLUXO: COMPROVANTES COM OCR                        │
├─────────────────────────────────────────────────────────────────┤
│  1. Tentar extração de texto nativa (PDF.js)                    │
│                         ↓                                        │
│  2. Se texto vazio/pequeno → usar OCR no comprovante           │
│                         ↓                                        │
│  3. Cachear resultado (texto OCR ou nativo)                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Mudanças a Implementar

### Mudança 1: Processar Todas as Páginas do Holerite

**Arquivo:** `src/hooks/useDocumentProcessor.ts`

Modificar `processHolerite` para:
1. Obter número total de páginas do PDF
2. Iterar sobre cada página
3. Para cada página:
   - Renderizar + OCR
   - Extrair nome
   - Se encontrou nome, criar entrada separada
4. Retornar múltiplos "holerites virtuais" (um por funcionário encontrado)

**Pseudo-código:**
```text
const pdf = await getCachedPdf(file);
const totalPages = pdf.numPages;

for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
  const canvas = await renderPageForOCR(file, pageNum, 2.5);
  const ocrText = await extractTextWithOCR(canvas);
  const name = extractEmployeeName(ocrText);
  
  if (name) {
    // Criar holerite virtual para esta página
    extractedNames.push({ name, pageNumber: pageNum });
  }
}
```

### Mudança 2: OCR Fallback nos Comprovantes

**Arquivo:** `src/lib/pdfCache.ts`

Adicionar função `getCachedPageTextsWithOCR`:
1. Primeiro, tenta extração nativa (rápida)
2. Se texto extraído for muito curto (< 50 caracteres), usa OCR
3. Cacheia o resultado

**Nova função:**
```text
export async function getCachedPageTextsWithOCR(
  file: File,
  ocrExtractor: (canvas: HTMLCanvasElement) => Promise<string>,
  shouldCancel?: () => boolean
): Promise<string[]>
```

### Mudança 3: Atualizar Estrutura de Dados

**Arquivo:** `src/types/document.ts`

Adicionar campo `sourceFile` para holerites virtuais que vieram de um PDF multi-página:

```text
export interface UploadedFile {
  // ... campos existentes
  sourcePageNumber?: number;  // Página de origem (para PDFs multi-página)
  sourceFileName?: string;    // Nome do arquivo original
}
```

### Mudança 4: Atualizar UI para Mostrar Página

**Arquivo:** `src/components/MatchedPairCard.tsx` (se existir)

Mostrar "Página X de Y" quando o holerite vier de um PDF multi-página.

---

## Arquivos a Modificar

| Arquivo | Alteração |
|---------|-----------|
| `src/hooks/useDocumentProcessor.ts` | Processar todas as páginas, criar holerites virtuais |
| `src/lib/pdfCache.ts` | Adicionar `getCachedPageTextsWithOCR` com fallback OCR |
| `src/types/document.ts` | Adicionar campos `sourcePageNumber` e `sourceFileName` |
| `src/lib/ocrUtils.ts` | Nenhuma mudança necessária (já funciona) |

---

## Fluxo Atualizado de Processamento

```text
ANTES:                               DEPOIS:
┌─────────────────┐                  ┌─────────────────┐
│ 1 arquivo PDF   │                  │ 1 arquivo PDF   │
│ com 4 páginas   │                  │ com 4 páginas   │
└────────┬────────┘                  └────────┬────────┘
         │                                    │
         ▼                                    ▼
┌─────────────────┐                  ┌─────────────────┐
│ OCR página 1    │                  │ OCR página 1    │──▶ Nome 1
└────────┬────────┘                  ├─────────────────┤
         │                           │ OCR página 2    │──▶ Nome 2
         ▼                           ├─────────────────┤
┌─────────────────┐                  │ OCR página 3    │──▶ Nome 3
│ 1 nome extraído │                  ├─────────────────┤
└─────────────────┘                  │ OCR página 4    │──▶ Nome 4
                                     └─────────────────┘
                                              │
                                              ▼
                                     ┌─────────────────┐
                                     │ 4 nomes         │
                                     │ extraídos       │
                                     └─────────────────┘
```

---

## Detalhes Técnicos

### Processamento Multi-Página (useDocumentProcessor.ts)

A função `processHolerite` será refatorada para retornar um **array de holerites**:

```typescript
// Novo tipo para resultado do processamento
interface ProcessedHoleriteResult {
  originalFile: UploadedFile;
  extractedEntries: Array<{
    name: string;
    pageNumber: number;
  }>;
}

const processHolerite = async (
  holerite: UploadedFile, 
  index: number
): Promise<ProcessedHoleriteResult> => {
  const pdf = await getCachedPdf(holerite.file);
  const totalPages = pdf.numPages;
  const extractedEntries: Array<{ name: string; pageNumber: number }> = [];
  
  console.log(`[OCR] Processando ${holerite.name}: ${totalPages} página(s)`);
  
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    if (cancelledRef.current) break;
    
    setStatus(prev => ({
      ...prev,
      message: `OCR em ${holerite.name} (pág. ${pageNum}/${totalPages})...`,
    }));
    
    const canvas = await renderPageForOCR(holerite.file, pageNum, 2.5);
    const ocrText = await extractTextWithOCR(canvas, (progress) => {
      setStatus(prev => ({ ...prev, ocrProgress: progress }));
    });
    
    const extractedName = extractEmployeeName(ocrText);
    
    if (extractedName) {
      console.log(`[OCR] Página ${pageNum}: "${extractedName}"`);
      extractedEntries.push({ name: extractedName, pageNumber: pageNum });
    }
  }
  
  return { originalFile: holerite, extractedEntries };
};
```

### OCR Fallback nos Comprovantes (pdfCache.ts)

```typescript
// Constante para detectar texto vazio/ruim
const MIN_TEXT_LENGTH = 50;

export async function getCachedPageTextsWithOCR(
  file: File,
  ocrExtractor: (canvas: HTMLCanvasElement) => Promise<string>,
  shouldCancel?: () => boolean
): Promise<string[]> {
  const key = getFileKey(file);
  
  // Verificar cache
  const cachedTexts = pageTextCache.get(key);
  if (cachedTexts) {
    updateAccessOrder(key);
    return cachedTexts;
  }
  
  const pdf = await getCachedPdf(file);
  const pageTexts: string[] = [];
  
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    if (shouldCancel?.()) break;
    
    // 1. Tentar extração nativa primeiro
    let text = await extractSinglePageText(pdf, pageNum);
    
    // 2. Se texto muito curto, usar OCR
    if (text.trim().length < MIN_TEXT_LENGTH) {
      console.log(`[Comprovante] Página ${pageNum}: texto nativo muito curto, usando OCR...`);
      const canvas = await renderPageForOCR(file, pageNum, 2.0); // escala menor para comprovantes
      text = await ocrExtractor(canvas);
    }
    
    pageTexts.push(text);
  }
  
  // Cachear resultado
  if (!shouldCancel?.()) {
    pageTextCache.set(key, pageTexts);
  }
  
  updateAccessOrder(key);
  return pageTexts;
}
```

---

## Estimativa de Performance

| Cenário | Tempo Estimado |
|---------|----------------|
| Holerite 4 páginas (OCR) | ~8-16 segundos |
| Comprovante 10 páginas (OCR fallback) | ~20-40 segundos |
| Total para 4 funcionários | ~30-60 segundos |

---

## Mensagens de Feedback Atualizadas

Durante o processamento, o usuário verá:

```text
"OCR em RECIBO B SERVICE.pdf (pág. 1/4)..."
"OCR em RECIBO B SERVICE.pdf (pág. 2/4)..."
"OCR em RECIBO B SERVICE.pdf (pág. 3/4)..."
"OCR em RECIBO B SERVICE.pdf (pág. 4/4)..."
"4 funcionários encontrados no holerite"

"Extraindo texto do comprovante SICREDI.pdf..."
"Página 3: texto vazio, usando OCR..."
"Buscando correspondências..."
"4 correspondência(s) encontrada(s)"
```

---

## Resultado Esperado

Após implementação:
1. Um PDF com 4 funcionários gerará 4 entradas de holerite (uma por página)
2. Os comprovantes escaneados serão processados com OCR quando necessário
3. A busca encontrará correspondências corretamente
4. O progresso mostrará página atual / total
5. Todos os 4 nomes aparecerão como matches
