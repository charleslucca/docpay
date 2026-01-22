
# Plano de Otimização Avançada de Performance

## Diagnóstico do Problema

Após análise detalhada, identifiquei os seguintes gargalos que ainda estão causando lentidão:

### Problemas Atuais

1. **Matching O(n x m x p)**: Para cada comprovante, o sistema itera por TODOS os holerites e TODAS as páginas do comprovante
   - Se há 50 holerites e 1 comprovante com 50 páginas = 2.500 verificações
   
2. **Falta de pré-indexação**: O script Python provavelmente extrai todos os textos primeiro e depois faz o matching em memória. O sistema atual faz extração + matching intercalados.

3. **Loop sequencial nos comprovantes**: Linha 161-225 do `useDocumentProcessor.ts` processa comprovantes um por um (sequencial), não em paralelo.

4. **Extração redundante**: `extractTextFromPage` é chamado múltiplas vezes para a mesma página do mesmo comprovante ao verificar diferentes nomes.

---

## Estratégia do Script Python (como deveria funcionar)

```text
SCRIPT PYTHON (Eficiente):
┌──────────────────────────────────────────────────────────┐
│  1. EXTRAÇÃO EM LOTE (paralelo)                          │
│     Holerites → extrair todos os nomes de uma vez        │
│     Comprovantes → extrair todo o texto de uma vez       │
├──────────────────────────────────────────────────────────┤
│  2. MATCHING EM MEMÓRIA (instantâneo)                    │
│     Para cada nome: buscar em strings já extraídas       │
│     Não há I/O, apenas comparação de strings             │
├──────────────────────────────────────────────────────────┤
│  3. GERAÇÃO (paralelo)                                   │
│     Apenas para pares matched                            │
└──────────────────────────────────────────────────────────┘

IMPLEMENTAÇÃO ATUAL (Lenta):
┌──────────────────────────────────────────────────────────┐
│  1. Extrair nome do holerite 1                           │
│  2. Extrair nome do holerite 2...                        │
│  3. Para comprovante 1:                                  │
│     → Ler página 1, buscar nome 1                        │
│     → Ler página 1, buscar nome 2... (LEITURA REPETIDA!) │
│     → Ler página 2, buscar nome 1...                     │
└──────────────────────────────────────────────────────────┘
```

---

## Mudanças a Implementar

### Etapa 1: Pré-extrair texto de TODOS os comprovantes

Antes do matching, extrair e cachear todo o texto de cada página de cada comprovante.

**Arquivo:** `src/hooks/useDocumentProcessor.ts`

- Após processar holerites, adicionar fase de pré-extração de comprovantes
- Criar estrutura `Map<comprovanteId, pageTexts[]>` com texto de todas as páginas
- Isso elimina leituras repetidas durante o matching

### Etapa 2: Matching puramente em memória

Substituir chamadas a `findNameInPdfWithEarlyExit` (que lê do PDF) por busca em strings já extraídas.

**Arquivo:** `src/hooks/useDocumentProcessor.ts`

- Criar função `findNameInExtractedTexts(pageTexts: string[], targetName: string)`
- Loop O(n x m) em strings, não em arquivos

### Etapa 3: Processar comprovantes em paralelo

O loop atual é sequencial. Paralelizar a fase de pré-extração.

**Arquivo:** `src/hooks/useDocumentProcessor.ts`

- Usar `processInBatches` também para comprovantes
- Extrair texto de 5 comprovantes simultaneamente

### Etapa 4: Cache de texto por página

Criar cache separado para texto extraído.

**Arquivo:** `src/lib/pdfCache.ts`

- Adicionar `pageTextCache: Map<string, string[]>` 
- Função `getCachedPageTexts(file: File): Promise<string[]>`

---

## Fluxo Otimizado

```text
NOVO FLUXO (Rápido):

Fase 1 - Extração Paralela (I/O intensivo)
├── Holerites (batch 5): extrair nomes
└── Comprovantes (batch 5): extrair TODOS os textos de todas as páginas

Fase 2 - Matching em Memória (CPU, instantâneo)
├── Para cada nome de holerite:
│   └── Buscar em pageTexts[] de cada comprovante (strings em RAM)
└── Nenhum acesso a arquivo!

Fase 3 - Geração (paralelo)
└── Apenas para pares matched
```

---

## Estimativa de Ganho

| Operação | Antes | Depois | Ganho |
|----------|-------|--------|-------|
| Leitura de páginas durante matching | O(n×m×p) leituras | 0 leituras | ~80% |
| Comprovantes | Sequencial | Paralelo (5x) | ~70% |
| Strings normalizadas | Recalculadas cada vez | Cacheadas | ~20% |

**Total estimado: 3-5x mais rápido**

---

## Arquivos a Modificar

1. **`src/lib/pdfCache.ts`** - Adicionar cache de texto por página
2. **`src/hooks/useDocumentProcessor.ts`** - Reestruturar fluxo com pré-extração

---

## Detalhes Técnicos

### Nova estrutura do cache (pdfCache.ts)

```text
┌─────────────────────────────────────────────────────────┐
│                   pdfCache.ts                            │
├─────────────────────────────────────────────────────────┤
│  pdfDocumentCache: Map<string, PDFDocumentProxy>        │
│  arrayBufferCache: Map<string, ArrayBuffer>             │
│  pageTextCache: Map<string, string[]>  ← NOVO           │
├─────────────────────────────────────────────────────────┤
│  getCachedPageTexts(file) → Promise<string[]>  ← NOVO   │
│  - Retorna texto de TODAS as páginas de uma vez         │
│  - Cacheia para reutilização                            │
└─────────────────────────────────────────────────────────┘
```

### Novo fluxo do processamento (useDocumentProcessor.ts)

```text
processDocuments():
│
├─1→ Extrair nomes dos holerites (paralelo, já existe)
│
├─2→ PRÉ-EXTRAIR textos dos comprovantes (paralelo) ← NOVO
│    for each comprovante in batches:
│      pageTexts = await getCachedPageTexts(comprovante.file)
│      store in comprovanteTextsMap
│
└─3→ Matching em memória (CPU only) ← REFATORAR
     for each holerite.name:
       for each (comprovanteId, pageTexts) in map:
         for (pageIdx, text) in pageTexts:
           if findNameInPage(text, name):
             → match found, break
```

---

## Considerações

### Memória
A pré-extração de texto aumenta o uso de memória, mas texto é muito mais leve que objetos PDF. Para 100 PDFs de 10 páginas cada: ~5-10MB de texto vs. ~100-500MB de objetos PDF.

### Compatibilidade
A interface do usuário não muda. Apenas o processamento interno fica mais rápido.
