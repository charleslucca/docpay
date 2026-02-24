

# Corrigir Status Travado Apos Matching e Melhorar Visibilidade

## Problema

Apos o matching terminar com sucesso (65 correspondencias de 678 funcionarios), a interface continua mostrando o spinner e "Buscando correspondencias" porque o status permanece em `step: "matching"` indefinidamente. O sistema nunca transiciona para um estado visual de "concluido" ate o usuario clicar "Gerar PDFs".

Alem disso, a fase de extracao OCR dos comprovantes (que e a mais demorada) tem pouca visibilidade — o progresso vai de 40% a 60% durante toda essa fase.

## Alteracoes

### 1. Transicionar para "completed" apos matching com resultados

**Arquivo: `src/hooks/useDocumentProcessor.ts`**

Na linha ~1186, onde o status final do matching e definido: mudar `step: "matching"` para `step: "completed"` quando ha pares encontrados. Isso faz o spinner parar e o indicador "Concluido" acender.

```text
// De:
setStatus({ step: "matching", progress: 100, message: "65 correspondencia(s)..." })

// Para:
setStatus({ step: "completed", progress: 100, message: "65 correspondencia(s)..." })
```

Manter o `step: "matching"` com `progress: 100` apenas para o caso de 0 matches (ja tratado pelo painel diagnostico).

### 2. Melhorar visibilidade da fase de extracao de comprovantes

**Arquivo: `src/hooks/useDocumentProcessor.ts`**

Expandir a faixa de progresso da extracao de comprovantes de 40-60% para 40-85%, dando mais espaco visual para esta fase longa:

- Linha ~940: Mudar `40 + ((index + 1) / comprovanteList.length) * 20` para `40 + ((index + 1) / comprovanteList.length) * 45`
- Linha ~1050: Ajustar o matching para usar 85-95% em vez de 60-90%

Tambem atualizar a mensagem de status durante a extracao de comprovantes para incluir contagem de paginas processadas.

### 3. Adicionar sub-etapa visual para extracao de comprovantes

**Arquivo: `src/components/ProcessingStatus.tsx`**

Adicionar indicador visual quando o step e "matching" mas o progresso esta abaixo de 85% (fase de extracao de comprovantes vs fase de matching real):

- Mostrar "Extraindo texto dos comprovantes..." quando progress < 85
- Mostrar "Buscando correspondencias..." quando progress >= 85

Isso diferencia visualmente as duas sub-fases dentro do step "matching".

## Resumo das alteracoes

| Arquivo | Alteracao |
|---------|-----------|
| `src/hooks/useDocumentProcessor.ts` | Transicionar para `step: "completed"` apos matching; expandir faixa de progresso dos comprovantes |
| `src/components/ProcessingStatus.tsx` | Diferenciar sub-fases visuais dentro do matching; parar spinner quando concluido |

## Detalhes tecnicos

### Fluxo corrigido

```text
Extracao holerites:  0% - 40%  (step: "extracting")
Extracao comprovantes: 40% - 85%  (step: "matching", label dinamico: "Extraindo comprovantes...")
Matching em memoria: 85% - 95%  (step: "matching", label: "Buscando correspondencias...")
Concluido:          100%        (step: "completed" se matches > 0, "matching" se matches = 0)
```

### ProcessingStatus - label dinamico

No componente ProcessingStatus, quando `step === "matching"`:
- Se `progress < 85`: exibir "Extraindo texto dos comprovantes"
- Se `progress >= 85 && progress < 100`: exibir "Buscando correspondencias"
- Se `progress >= 100 && matchesFound > 0`: nao entra aqui (ja e "completed")
- Se `progress >= 100 && matchesFound === 0`: painel diagnostico (ja existente)

