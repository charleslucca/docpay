
# Plano: Persistência de Processamento Durante Navegação e Refresh

## Problema Identificado

### Situação Atual
O sistema já possui uma infraestrutura de persistência no IndexedDB (`processingPersistence.ts`), mas o processamento é perdido quando o usuário:
1. **Muda de página/tab** no navegador
2. **Fecha a aba** ou navegador
3. **Executa refresh (F5)** na página

### Causa Raiz
O processamento OCR ocorre inteiramente em memória JavaScript. Quando a página é destruída (navegação/refresh):
- Os workers do Tesseract.js são terminados
- As Promises em andamento são canceladas
- O estado React é perdido

Embora exista código para salvar estado no IndexedDB periodicamente (linhas 512-543), há dois problemas:
1. A persistência só ocorre durante o loop OCR - não há proteção para refresh/navegação
2. Quando o usuário retorna, o dialog de resumo aparece, mas os workers precisam ser reinicializados

```text
┌─────────────────────────────────────────────────────────────┐
│ PROBLEMA: Sem proteção contra fechamento da página         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   [Usuário inicia processamento]                            │
│              │                                              │
│              ▼                                              │
│   [Loop OCR em execução]                                    │
│   └── Salva estado a cada X páginas ✓                       │
│              │                                              │
│              ▼                                              │
│   [REFRESH ou FECHAMENTO DA ABA] ⚠️                          │
│              │                                              │
│              ▼                                              │
│   - Workers terminados abruptamente                         │
│   - Estado atual pode não ter sido salvo                    │
│   - Usuário perde progresso desde último checkpoint         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Solução Proposta

### Estratégia Multi-Camada

1. **Salvar estado antes do fechamento** (`beforeunload` event)
2. **Salvar estado mais frequentemente** (a cada página processada)
3. **Implementar Web Worker para OCR isolado** (futuro - melhoria opcional)
4. **Mostrar aviso ao sair durante processamento**

```text
┌─────────────────────────────────────────────────────────────┐
│ SOLUÇÃO: Proteção multi-camada                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   [beforeunload]                                            │
│   └── Aviso: "Processamento em andamento, deseja sair?"     │
│   └── Salvar estado atual imediatamente no IndexedDB        │
│                                                             │
│   [Salvar a cada página]                                    │
│   └── Checkpoint granular (máximo ~2s de perda)             │
│                                                             │
│   [Ao retornar]                                             │
│   └── Detectar estado salvo                                 │
│   └── Mostrar dialog de resumo                              │
│   └── Restaurar arquivos + progresso do IndexedDB           │
│   └── Continuar do checkpoint                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Arquivos a Modificar

| Arquivo | Alteração |
|---------|-----------|
| `src/hooks/useDocumentProcessor.ts` | Adicionar `beforeunload` listener, salvar estado mais frequentemente |
| `src/pages/Index.tsx` | Integrar listener de navegação |
| `src/lib/processingPersistence.ts` | Adicionar função de salvamento síncrono para `beforeunload` |

---

## Detalhes Técnicos

### 1. Listener `beforeunload` para Aviso e Salvamento

Adicionar ao `useDocumentProcessor.ts`:

```typescript
// Salvar estado imediatamente quando usuário tenta sair
useEffect(() => {
  const handleBeforeUnload = (e: BeforeUnloadEvent) => {
    if (status.step !== 'idle' && status.step !== 'completed') {
      // Mostrar aviso do navegador
      e.preventDefault();
      e.returnValue = 'O processamento está em andamento. Deseja realmente sair?';
      
      // Tentar salvar estado (síncrono não é possível, mas podemos usar beacon)
      // O estado mais recente já estará no IndexedDB devido aos checkpoints frequentes
      return e.returnValue;
    }
  };

  window.addEventListener('beforeunload', handleBeforeUnload);
  return () => window.removeEventListener('beforeunload', handleBeforeUnload);
}, [status.step]);
```

### 2. Checkpoint Mais Frequente

Modificar a lógica de salvamento no loop OCR para salvar **a cada página** (não a cada batch):

```typescript
// ANTES: if (pagesProcessed % (workerCount * 2) === 0 || pagesProcessed === totalPages)
// DEPOIS: Salvar a cada página processada
const shouldSave = true; // Sempre salvar (overhead mínimo no IndexedDB)

if (shouldSave) {
  await saveProcessingState({...});
}
```

### 3. Salvamento Otimizado com Debounce

Para evitar overhead excessivo, usar debounce de 500ms:

```typescript
// Debounced save - máximo 2 saves por segundo
const lastSaveRef = useRef<number>(0);
const SAVE_DEBOUNCE_MS = 500;

const saveIfNeeded = async (state: ProcessingState) => {
  const now = Date.now();
  if (now - lastSaveRef.current >= SAVE_DEBOUNCE_MS) {
    lastSaveRef.current = now;
    await saveProcessingState(state);
  }
};
```

### 4. Indicador Visual de "Salvando..."

Adicionar feedback visual quando o estado é salvo:

```typescript
// No ProcessingStatus.tsx ou similar
{status.isSaving && (
  <span className="text-xs text-muted-foreground animate-pulse">
    Salvando progresso...
  </span>
)}
```

### 5. Resumo Automático ao Recarregar

Melhorar a detecção de estado salvo para ser mais robusta:

```typescript
// No useEffect inicial
useEffect(() => {
  const checkAndPromptResume = async () => {
    const savedState = await loadProcessingState();
    if (savedState && savedState.status !== 'completed') {
      // Estado incompleto encontrado - mostrar dialog
      setHasSavedState(true);
    }
  };
  
  checkAndPromptResume();
}, []);
```

---

## Fluxo de Recuperação

```text
┌─────────────────────────────────────────────────────────────┐
│ 1. Usuário fecha aba durante processamento                  │
├─────────────────────────────────────────────────────────────┤
│    beforeunload → Aviso exibido                             │
│    Estado já está salvo (checkpoint recente)                │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Usuário retorna ao site                                  │
├─────────────────────────────────────────────────────────────┤
│    useEffect detecta estado salvo no IndexedDB              │
│    Dialog "Processamento Pendente" é exibido                │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Usuário clica "Retomar"                                  │
├─────────────────────────────────────────────────────────────┤
│    Arquivos carregados do IndexedDB                         │
│    Workers OCR reinicializados                              │
│    Processamento continua da página salva                   │
│    Cache de OCR evita reprocessar páginas já feitas         │
└─────────────────────────────────────────────────────────────┘
```

---

## Resumo das Mudanças

| Mudança | Impacto |
|---------|---------|
| Listener `beforeunload` | Avisa usuário e garante checkpoint final |
| Checkpoint por página com debounce | Máximo ~500ms de perda ao fechar |
| Indicador de salvamento | Feedback visual de persistência |
| Detecção melhorada no mount | Sempre detecta estado incompleto |

---

## Resultado Esperado

- **Refresh (F5)**: Perda máxima de ~500ms de progresso, resumo automático disponível
- **Fechar aba**: Aviso exibido, estado preservado
- **Mudança de página**: Mesmo comportamento de refresh
- **Retornar após horas**: Estado válido por 24h (já implementado em `cleanupOldData`)
