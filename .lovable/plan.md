

# Plano de Feedback Visual com Tempo Estimado e Alertas

## Objetivo
1. Mostrar tempo estimado de conclusão durante o processamento
2. Exibir alerta quando a extração de um nome demorar mais de 10 segundos
3. Melhorar o feedback visual para que o usuário saiba que o sistema está trabalhando

---

## Mudanças a Implementar

### Mudança 1: Expandir o tipo ProcessingStatus

Adicionar campos para rastrear tempo e alertas no tipo de status.

**Arquivo:** `src/types/document.ts`

Modificar a interface `ProcessingStatus` para incluir:
- `startTime?: number` - Timestamp de início do processamento
- `currentItemStartTime?: number` - Timestamp de início do item atual
- `estimatedTimeRemaining?: number` - Tempo estimado restante em segundos
- `currentItem?: string` - Nome do arquivo sendo processado
- `totalItems?: number` - Total de itens a processar
- `processedItems?: number` - Itens já processados
- `isSlowOperation?: boolean` - Flag para operação lenta

### Mudança 2: Rastrear tempo no processamento

Adicionar lógica de tempo no hook de processamento.

**Arquivo:** `src/hooks/useDocumentProcessor.ts`

Modificações:
- Criar ref `slowOperationTimerRef` para rastrear operações lentas
- Ao iniciar processamento de cada arquivo, registrar `currentItemStartTime`
- Usar `setInterval` para verificar se ultrapassou 10 segundos
- Calcular tempo estimado baseado na média de tempo por item processado
- Chamar `toast()` com alerta quando operação demorar > 10 segundos
- Atualizar status com informações de tempo em tempo real

### Mudança 3: Atualizar componente ProcessingStatus

Exibir tempo estimado e informações detalhadas do progresso.

**Arquivo:** `src/components/ProcessingStatus.tsx`

Adicionar:
- Exibição do tempo decorrido (cronômetro em tempo real)
- Exibição do tempo estimado restante (calculado dinamicamente)
- Indicador visual de operação lenta (alerta amarelo/vermelho)
- Nome do arquivo sendo processado atualmente
- Contador "X de Y arquivos"

---

## Detalhes Técnicos

### Nova estrutura do ProcessingStatus

```text
interface ProcessingStatus {
  step: 'idle' | 'uploading' | 'extracting' | 'matching' | 'generating' | 'completed';
  progress: number;
  message: string;
  
  // NOVOS CAMPOS:
  startTime?: number;              // Date.now() quando iniciou
  currentItemStartTime?: number;   // Date.now() quando começou item atual
  estimatedTimeRemaining?: number; // Segundos estimados
  currentItem?: string;            // "documento_001.pdf"
  totalItems?: number;             // 50
  processedItems?: number;         // 12
  isSlowOperation?: boolean;       // true se > 10s no item atual
}
```

### Lógica de cálculo de tempo estimado

```text
tempoMedioPorItem = (Date.now() - startTime) / processedItems
itensRestantes = totalItems - processedItems
tempoEstimado = tempoMedioPorItem * itensRestantes / 1000 // em segundos
```

### Componente visual atualizado

```text
┌──────────────────────────────────────────────────────────┐
│  🔄 Extraindo nomes                                       │
│  Processando: documento_funcionario_001.pdf               │
│  12 de 50 arquivos                                        │
├──────────────────────────────────────────────────────────┤
│  [██████████░░░░░░░░░░░░░░░░░░░░] 24%                     │
│                                                           │
│  ⏱️ Tempo decorrido: 1m 32s                               │
│  ⏳ Tempo estimado: ~4m 48s                               │
├──────────────────────────────────────────────────────────┤
│  ⚠️ ATENÇÃO: Extração lenta detectada (>10s)              │  ← Alerta visual
│     Isso pode indicar PDF escaneado sem texto            │
└──────────────────────────────────────────────────────────┘
```

### Fluxo de alerta para operação lenta

```text
1. Usuário inicia processamento
2. Para cada arquivo:
   a. Registrar currentItemStartTime = Date.now()
   b. Iniciar timer de 10 segundos
   c. Se timer disparar antes de concluir:
      - Exibir toast de alerta
      - Marcar isSlowOperation = true
   d. Ao concluir arquivo, cancelar timer
3. Continuar para próximo arquivo
```

---

## Arquivos a Modificar

1. **`src/types/document.ts`** - Expandir interface ProcessingStatus
2. **`src/hooks/useDocumentProcessor.ts`** - Adicionar rastreamento de tempo e alertas
3. **`src/components/ProcessingStatus.tsx`** - Exibir tempo e alertas visuais

---

## Implementação do Alerta Toast

O sistema usará o toast existente (`@/hooks/use-toast`) para exibir alertas:

```text
toast({
  title: "⚠️ Operação lenta detectada",
  description: `A extração de "${fileName}" está demorando mais de 10 segundos. 
                O documento pode estar escaneado ou muito grande.`,
  variant: "destructive",
});
```

---

## Cronômetro em Tempo Real

Para atualizar o tempo decorrido em tempo real, o componente `ProcessingStatus` usará um `useEffect` com `setInterval` de 1 segundo para atualizar a exibição do tempo enquanto `isActive` for true.

---

## Resultado Esperado

Após as implementações:
- O usuário verá tempo decorrido e estimativa de conclusão em tempo real
- Receberá alerta visual e toast quando uma extração demorar > 10 segundos
- Saberá qual arquivo está sendo processado no momento
- Terá feedback visual claro de que o sistema está trabalhando, mesmo em operações lentas

