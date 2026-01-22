
# Plano: Persistência de Processamento e Otimização de CPU

## Problemas Identificados

### Problema 1: Perda de Progresso ao Mudar de Página
Quando o usuário navega para outra página ou fecha a aba, todo o processamento OCR em andamento é perdido. Isso acontece porque:
- O processamento roda na thread principal do React
- Os Web Workers do Tesseract.js são encerrados quando o componente desmonta
- O estado (useState) é perdido na navegação

### Problema 2: CPU Elevado Durante Processamento em Lote
O processamento de 20 páginas simultâneas + 4 workers OCR causa picos de CPU porque:
- Todas as 20 páginas são renderizadas em paralelo (Promise.all)
- Cada canvas usa muita memória e CPU para criação
- Os 4 workers OCR trabalham a 100% continuamente

---

## Arquitetura da Solução

```text
┌─────────────────────────────────────────────────────────────────┐
│                     SOLUÇÃO PROPOSTA                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PROBLEMA 1: Persistência                                        │
│  ────────────────────────                                        │
│  ┌─────────────────┐     ┌─────────────────┐                    │
│  │ IndexedDB       │ ←── │ Estado do       │                    │
│  │ (Persistência)  │     │ Processamento   │                    │
│  └────────┬────────┘     └─────────────────┘                    │
│           │                                                      │
│           ▼                                                      │
│  ┌─────────────────────────────────────────┐                    │
│  │ Ao recarregar página:                   │                    │
│  │ 1. Verifica se há processamento salvo   │                    │
│  │ 2. Oferece opção de retomar             │                    │
│  │ 3. Continua de onde parou               │                    │
│  └─────────────────────────────────────────┘                    │
│                                                                  │
│  PROBLEMA 2: CPU Otimizado                                       │
│  ─────────────────────────                                       │
│  ┌─────────────────────────────────────────┐                    │
│  │ ANTES: 20 páginas + 4 workers = 100% CPU│                    │
│  │                                          │                    │
│  │ DEPOIS:                                  │                    │
│  │ - Batch de 4 páginas (= workers)        │                    │
│  │ - Pausa entre batches (requestIdleCallback)│                 │
│  │ - Workers ajustados: min(cores/2, 4)    │                    │
│  │ - Throttle opcional pelo usuário        │                    │
│  └─────────────────────────────────────────┘                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Parte 1: Persistência com IndexedDB

### Estratégia
Usar IndexedDB para salvar:
1. **Arquivos originais** (como Blobs) - para poder continuar sem re-upload
2. **Estado do processamento** - qual página/arquivo está sendo processado
3. **Resultados parciais** - nomes já extraídos, matches já encontrados

### Novo Arquivo: `src/lib/processingPersistence.ts`

```typescript
interface ProcessingState {
  id: string;
  startedAt: Date;
  status: 'extracting' | 'matching' | 'generating';
  
  // Arquivos originais (armazenados como Blob no IndexedDB)
  holeritesIds: string[];
  comprovantesIds: string[];
  
  // Progresso
  currentHoleriteIndex: number;
  currentPageNumber: number;
  
  // Resultados parciais
  extractedNames: Array<{
    holeriteId: string;
    name: string;
    pageNumber: number;
  }>;
  
  // Matches encontrados
  matchedPairs: Array<{
    employeeName: string;
    holeriteId: string;
    holeritePageNumber: number;
    comprovanteId: string;
    comprovantePageNumber: number;
  }>;
}

// Funções a implementar:
export async function saveProcessingState(state: ProcessingState): Promise<void>;
export async function loadProcessingState(): Promise<ProcessingState | null>;
export async function clearProcessingState(): Promise<void>;
export async function saveFileBlob(id: string, file: File): Promise<void>;
export async function loadFileBlob(id: string): Promise<File | null>;
```

### Fluxo de Retomada

```text
Usuário abre a página
         │
         ▼
┌─────────────────────────┐
│ Verificar IndexedDB:    │
│ Há processamento salvo? │
└───────────┬─────────────┘
            │
      ┌─────┴─────┐
      │           │
      ▼           ▼
   [SIM]       [NÃO]
      │           │
      ▼           ▼
┌─────────────┐  ┌─────────────┐
│ Modal:      │  │ Fluxo       │
│ "Retomar    │  │ normal      │
│ processo?"  │  │             │
└─────────────┘  └─────────────┘
      │
  ┌───┴───┐
  │       │
  ▼       ▼
[Sim]   [Não]
  │       │
  ▼       ▼
Carregar  Limpar DB
e         e começar
continuar novo
```

---

## Parte 2: Otimização de CPU

### Mudança 1: Reduzir Tamanho do Batch

**Problema Atual:**
```typescript
const PAGES_PER_BATCH = 20; // 20 páginas renderizadas de uma vez
```

**Solução:**
```typescript
// Alinhar batch com número de workers para máxima eficiência
const PAGES_PER_BATCH = Math.max(4, WORKER_COUNT); // 4-6 páginas por vez
```

### Mudança 2: Adicionar Pausas Entre Batches

**Problema:** CPU fica a 100% continuamente sem chance de outras tarefas.

**Solução:** Usar `requestIdleCallback` ou `setTimeout` entre batches:

```typescript
// Entre cada batch, dar uma pausa para o browser respirar
const pauseBetweenBatches = () => new Promise<void>(resolve => {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => resolve(), { timeout: 100 });
  } else {
    setTimeout(resolve, 50); // 50ms de pausa
  }
});

// Dentro do loop:
for (let batchStart = 1; batchStart <= totalPages; batchStart += PAGES_PER_BATCH) {
  // ... processar batch ...
  
  // Pausar antes do próximo batch
  await pauseBetweenBatches();
}
```

### Mudança 3: Renderização Sequencial com OCR Paralelo

**Problema:** `Promise.all` para renderizar 20 canvas sobrecarrega a GPU/CPU.

**Solução:** Renderizar canvas um de cada vez, mas manter OCR paralelo:

```typescript
// ANTES (sobrecarrega):
const canvases = await Promise.all(
  pageNumbers.map(pageNum => renderPageForOCR(file, pageNum, 2.5))
);

// DEPOIS (mais suave):
const canvases: HTMLCanvasElement[] = [];
for (const pageNum of pageNumbers) {
  if (cancelledRef.current) break;
  const canvas = await renderPageForOCR(file, pageNum, 2.5);
  canvases.push(canvas);
}
// OCR continua paralelo via scheduler
const texts = await extractTextBatch(canvases);
```

### Mudança 4: Configuração de Workers Dinâmica

Adicionar opção para usuário escolher intensidade:

```typescript
type ProcessingMode = 'fast' | 'balanced' | 'efficient';

const getWorkerCount = (mode: ProcessingMode): number => {
  const cores = navigator.hardwareConcurrency || 4;
  switch (mode) {
    case 'fast': return Math.min(6, cores);
    case 'balanced': return Math.min(4, Math.floor(cores / 2));
    case 'efficient': return 2;
  }
};
```

---

## Arquivos a Criar/Modificar

| Arquivo | Ação | Descrição |
|---------|------|-----------|
| `src/lib/processingPersistence.ts` | **CRIAR** | Funções para salvar/carregar estado no IndexedDB |
| `src/hooks/useDocumentProcessor.ts` | MODIFICAR | Integrar persistência + otimizar batches |
| `src/lib/ocrUtils.ts` | MODIFICAR | Adicionar modo de intensidade configurável |
| `src/components/ResumeProcessingDialog.tsx` | **CRIAR** | Modal para retomar processamento |
| `src/pages/Index.tsx` | MODIFICAR | Verificar processamento salvo ao montar |

---

## Detalhes Técnicos

### IndexedDB Schema

```typescript
// Database: 'documerge-processing'
// Object Stores:

// 1. 'files' - Armazena os arquivos originais
{
  id: string,           // UUID
  file: Blob,           // O arquivo PDF
  name: string,         // Nome original
  type: 'holerite' | 'comprovante',
  uploadedAt: Date,
}

// 2. 'processing-state' - Estado do processamento
{
  id: 'current',        // Sempre 'current' (singleton)
  state: ProcessingState,
  updatedAt: Date,
}
```

### Frequência de Salvamento

Para não sobrecarregar o IndexedDB:
- Salvar estado a cada **batch completado** (não a cada página)
- Usar debounce de 1 segundo para updates frequentes
- Limpar DB automaticamente após processamento concluído

### Limitações

1. **Tamanho do IndexedDB**: Navegadores geralmente permitem 50-100MB. Arquivos grandes podem exceder.
2. **Tempo de vida**: Dados podem ser limpos pelo browser se armazenamento ficar baixo.
3. **Não é background real**: Se a aba fechar, o processamento para. Só persiste para retomada.

---

## Fluxo de Uso Atualizado

```text
1. Usuário faz upload de arquivos
2. Clica em "Iniciar Processamento"
3. Sistema salva arquivos no IndexedDB
4. Processamento começa com batches otimizados
5. A cada batch, estado é salvo
6. Se usuário mudar de página ou fechar:
   - Processamento pausa
   - Estado fica salvo
7. Ao retornar à página:
   - Modal pergunta "Retomar processamento?"
   - Se sim: carrega arquivos e continua
   - Se não: limpa DB e permite novo upload
```

---

## Interface do Modal de Retomada

```text
┌─────────────────────────────────────────────────────┐
│  ⚠️  Processamento Pendente Encontrado              │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Encontramos um processamento que foi interrompido: │
│                                                      │
│  📄 Arquivo: RECIBO B SERVICE 08 AGOSTO 2025.pdf    │
│  📊 Progresso: 380 de 691 páginas (55%)             │
│  ⏱️  Iniciado: há 15 minutos                         │
│                                                      │
│  Deseja continuar de onde parou?                    │
│                                                      │
│  ┌──────────────┐    ┌──────────────┐              │
│  │   Retomar    │    │ Novo Upload  │              │
│  └──────────────┘    └──────────────┘              │
│                                                      │
└─────────────────────────────────────────────────────┘
```

---

## Estimativa de Performance

### CPU
| Cenário | Antes | Depois |
|---------|-------|--------|
| Pico de CPU | 100% constante | ~60-80% com pausas |
| Responsividade UI | Travamentos | Fluida |

### Memória
| Cenário | Antes | Depois |
|---------|-------|--------|
| Canvas simultâneos | 20 | 4-6 |
| Pico de RAM | ~800MB | ~300-400MB |

---

## Considerações

1. **IndexedDB vs localStorage**: IndexedDB suporta blobs/arquivos grandes, localStorage só strings.

2. **Background real**: Para processamento que continue mesmo com aba fechada, seria necessário um Service Worker com Background Sync API - mais complexo e com limitações de browser.

3. **Limpar dados antigos**: Implementar limpeza automática de processamentos > 24h.

4. **Feedback visual**: Mostrar indicador de "salvando..." quando estado é persistido.
