
# Plano: Correção de Travamento com Arquivos Menores

## Problemas Identificados

### 1. Race Condition na Contagem de Páginas Processadas

O arquivo de amostra tem apenas 6 páginas. O problema é que quando páginas vêm do cache:

```text
┌─────────────────────────────────────────────────────────────┐
│ PROBLEMA: Contagem duplicada de pagesProcessed              │
├─────────────────────────────────────────────────────────────┤
│ renderLoop (linha 471-481):                                 │
│   if (cachedText !== undefined) {                           │
│     // Processa do cache                                    │
│     pagesProcessed++;  ← Incrementa aqui                    │
│     continue;          ← Não adiciona à queue               │
│   }                                                         │
│                                                             │
│ ocrLoop (linha 549):                                        │
│   pagesProcessed++;    ← Também incrementa aqui             │
│                                                             │
│ RESULTADO: pagesProcessed pode ser incrementado 2x!         │
│ OU: ocrLoop nunca incrementa se tudo veio do cache          │
└─────────────────────────────────────────────────────────────┘
```

### 2. IndexedDB Connection Closing

O erro "database connection is closing" ocorre porque:
- A variável `db` é compartilhada como singleton
- Quando o componente é desmontado/remontado rapidamente, o DB pode ser fechado enquanto transações estão pendentes

### 3. OCR "Fast" Model Produz Resultados Ruins

O console mostra:
```
[DEBUG] Nome extraído: DESNCAO OT RETRENCA
```
Que deveria ser um nome como "CARLOS HENRIQUE DA SILVA MARIANO". O modelo "fast" está falhando com a qualidade dos PDFs escaneados.

---

## Soluções

### Correção 1: Separar Contadores de Render vs OCR

Usar contadores separados para evitar race condition:

```typescript
// Em useDocumentProcessor.ts
let renderedPages = 0;      // Páginas que o renderLoop processou
let ocrProcessedPages = 0;  // Páginas que o ocrLoop processou
let cacheHitPages = 0;      // Páginas que vieram do cache

// renderLoop:
if (cachedText !== undefined) {
  cacheHitPages++;
  // Extrair nome diretamente, sem adicionar à queue
  continue;
}
renderedPages++; // Só incrementa se realmente renderizou

// ocrLoop termination check:
const totalProcessed = ocrProcessedPages + cacheHitPages;
if (renderingComplete && canvasQueue.length === 0 && totalProcessed >= totalPages) {
  break;
}
```

### Correção 2: IndexedDB Connection Handling

Reabrir conexão se estiver fechada:

```typescript
// Em processingPersistence.ts
async function openDatabase(): Promise<IDBDatabase> {
  // Se a conexão anterior foi fechada, limpar referência
  if (db && db.name === '') {
    db = null;
    dbPromise = null;
  }
  
  if (db) return db;
  // ... resto do código
}
```

### Correção 3: Timeout de Segurança no Loop OCR

Adicionar timeout máximo para evitar loops infinitos:

```typescript
// Timeout de 5 minutos para arquivos pequenos
const MAX_LOOP_WAIT_MS = 300000; // 5 minutos
const loopStartTime = Date.now();

while (!ocrComplete && !cancelledRef.current) {
  // Check timeout
  if (Date.now() - loopStartTime > MAX_LOOP_WAIT_MS) {
    console.error('[OCR] Loop timeout - forcing exit');
    break;
  }
  // ... resto do loop
}
```

---

## Arquivos a Modificar

| Arquivo | Alteração |
|---------|-----------|
| `src/hooks/useDocumentProcessor.ts` | Corrigir contadores e adicionar timeout |
| `src/lib/processingPersistence.ts` | Melhorar handling de conexão fechada |

---

## Detalhes da Implementação

### useDocumentProcessor.ts - Correção de Contadores

**Linhas ~452-620:**

Mudar a lógica para usar sinais mais claros:

```typescript
// ANTES: usando pagesProcessed compartilhado
let pagesProcessed = 0;

// DEPOIS: sinais separados
let cacheHits = 0;
let canvasesQueued = 0;
let ocrCompleted = 0;

// renderLoop agora só conta o que faz
const renderLoop = async () => {
  while (nextPageToRender <= totalPages && !cancelledRef.current) {
    const pageNum = nextPageToRender++;
    
    const cacheKey = getOcrCacheKey(...);
    const cachedText = getCachedOcrResult(cacheKey);
    
    if (cachedText !== undefined) {
      // Cache hit - process directly
      cacheHits++;
      const extractedName = extractEmployeeName(cachedText);
      if (extractedName) {
        entries.push({...});
      }
      continue; // Não adiciona à queue
    }
    
    // Cache miss - render and queue
    const canvas = await renderPageForOCR(...);
    canvasQueue.push({ pageNum, canvas });
    canvasesQueued++;
  }
  renderingComplete = true;
};

// ocrLoop só conta o que processa da queue
const ocrLoop = async () => {
  while (!cancelledRef.current) {
    // Collect batch
    const batch = [];
    while (batch.length < workerCount && canvasQueue.length > 0) {
      batch.push(canvasQueue.shift()!);
    }
    
    if (batch.length > 0) {
      // Process OCR...
      ocrCompleted += batch.length;
    }
    
    // Termination: render done + queue empty + all OCR done
    if (renderingComplete && canvasQueue.length === 0) {
      // Double check: all queued canvases were processed
      if (ocrCompleted >= canvasesQueued) {
        break;
      }
    }
    
    if (canvasQueue.length === 0) {
      await new Promise(r => setTimeout(r, 20));
    }
  }
};
```

### processingPersistence.ts - Conexão Robusta

**Linhas ~54-96:**

```typescript
let db: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

async function openDatabase(): Promise<IDBDatabase> {
  // Check if existing connection is still valid
  if (db) {
    try {
      // Test if connection is alive by checking objectStoreNames
      const _ = db.objectStoreNames;
      return db;
    } catch {
      // Connection closed, reset
      console.log('[Persistence] Connection was closed, reopening...');
      db = null;
      dbPromise = null;
    }
  }
  
  if (dbPromise) return dbPromise;
  
  dbPromise = new Promise((resolve, reject) => {
    // ... código existente
  });
  
  return dbPromise;
}

// Adicionar handler para conexão fechada inesperadamente
function setupConnectionHandler(database: IDBDatabase) {
  database.onclose = () => {
    console.log('[Persistence] Database connection closed unexpectedly');
    db = null;
    dbPromise = null;
  };
  
  database.onerror = (event) => {
    console.error('[Persistence] Database error:', event);
  };
}
```

---

## Resumo das Correções

| Problema | Solução |
|----------|---------|
| Contadores dessincronizados | Usar `cacheHits`, `canvasesQueued`, `ocrCompleted` separados |
| Loop infinito | Terminar quando `renderingComplete && ocrCompleted >= canvasesQueued` |
| IndexedDB fechado | Verificar conexão antes de usar, reabrir se necessário |
| Timeout de segurança | Adicionar MAX_LOOP_WAIT de 5 minutos |

---

## Resultado Esperado

- **Arquivos pequenos (6 páginas):** Processados em ~10-15 segundos sem travamento
- **IndexedDB:** Conexão resiliente a remontagens de componente
- **Fallback:** Timeout impede loop infinito mesmo em edge cases
