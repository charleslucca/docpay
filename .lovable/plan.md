

# Corrigir Cancelamento Infinito e Extracao de Nomes

## Problema 1: Cancelamento fica "calculando infinitamente"

Ao cancelar, o sistema marca `cancelledRef.current = true`, mas os workers OCR (Tesseract.js) continuam processando as paginas ja enfileiradas. O `extractTextBatch` usa `Promise.all` internamente e nao pode ser interrompido. O resultado e que o status fica em "Cancelando..." ate todos os jobs OCR pendentes terminarem (cada um pode levar ate 30 segundos).

### Solucao

1. Chamar `terminateOcrWorker()` dentro de `cancelProcessing` para forcar a terminacao imediata de todos os workers OCR
2. Adicionar tratamento de erro no `ocrLoop` para capturar a excecao gerada pela terminacao forcada
3. Garantir que o status volta para "idle" imediatamente apos a terminacao

### Alteracao em `src/hooks/useDocumentProcessor.ts`

Na funcao `cancelProcessing` (linha ~329):
- Adicionar chamada `terminateOcrWorker()` para encerrar imediatamente os workers
- Adicionar `clearSlowOperationTimer()` para limpar timers pendentes
- Limpar o estado de persistencia com `clearProcessingState()`

No `ocrLoop` (linha ~595):
- Envolver o `extractTextBatch` em try/catch para tratar a excecao de terminacao
- Verificar `cancelledRef.current` apos o catch para sair do loop graciosamente

---

## Problema 2: Extracao nao encontra os 690 funcionarios

O texto OCR destes holerites B SERVICE tem este formato tipico:

```text
B SERVICE PRESTADORA DE SERVICOS EIRELI
CNPJ: 29.639.536/0001 33  CC: GERAL
FOLHA MENSAL MENSALISTA AGOSTO DE 2025
S0 CAMILLO ALVES PELZER S14320 1 1
FISCAL DE LIMPEZA ADMISSAO: 06/08/2020
```

O padrao 1 (B SERVICE) espera `\d{3,5}` antes do nome, mas o OCR le o codigo como "S0", "83", "86", etc. - as vezes com letras misturadas. Alem disso, o padrao 7 (generico maiusculas) captura "SERVICE PRESTADORA DE SERVICOS EIRELI" primeiro, que e rejeitado por conter palavras invalidas, e entao nenhum outro padrao consegue extrair o nome real.

### Solucao

Adicionar um padrao especifico para o formato B SERVICE com OCR ruidoso:

1. Novo padrao regex que busca o nome entre a linha do cabecalho (apos "AGOSTO DE 2025" ou similar) e antes de um cargo conhecido ou codigo CBO:
   - Formato: `[MES] DE \d{4}\s+(?:\S+\s+)?([A-Z][A-Z\s]{5,40}?)\s+(?:S?\d{4,6}|\d{5,6})`
   - Isto captura o nome mesmo quando o codigo do funcionario esta corrompido pelo OCR

2. Adicionar padrao que reconhece a estrutura especifica destas folhas:
   - Apos "MENSALISTA [MES] DE [ANO]", pular possiveis codigos (com ou sem letras), capturar sequencia de nomes ate encontrar codigo CBO ou cargo

3. Posicionar estes novos padroes ANTES do padrao 7 (generico) para que tenham prioridade

### Alteracao em `src/lib/pdfUtils.ts`

Na funcao `extractEmployeeName` (linha ~286), adicionar novos padroes na lista `namePatterns`:

```text
// Novo padrao para B SERVICE (OCR): nome apos mes/ano, antes de codigo CBO
// Ex: "AGOSTO DE 2025 S0 CAMILLO ALVES PELZER S14320" -> "CAMILLO ALVES PELZER"
// Ex: "AGOSTO DE 2025 83 CLEUSA CORREA DA SILVA 514215" -> "CLEUSA CORREA DA SILVA"
```

Regex proposta (inserir como padrao 1.5, entre o padrao 1 e o padrao 2):

```
/(?:JANEIRO|FEVEREIRO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)\s+DE\s+\d{4}\s+(?:\S{1,6}\s+)?([A-Z][A-Z\s]{5,40}?)\s+(?:S?\d{4,6})\s/
```

Tambem ajustar o padrao 1 original para aceitar codigos com letras misturadas (OCR):

```
// De: /\b\d{3,5}\s+([A-Z...
// Para: /\b[A-Z0-9]{2,5}\s+([A-Z...
```

---

## Resumo das alteracoes

| Arquivo | Alteracao |
|---------|-----------|
| `src/hooks/useDocumentProcessor.ts` | Cancelamento chama `terminateOcrWorker()` + try/catch no ocrLoop |
| `src/lib/pdfUtils.ts` | Novos padroes regex para formato B SERVICE com OCR ruidoso |

## Detalhes tecnicos

### Fluxo de cancelamento corrigido

```text
Usuario clica Cancelar
  -> cancelledRef.current = true
  -> terminateOcrWorker() [NOVO] -> mata todos workers imediatamente
  -> extractTextBatch lanca excecao (scheduler terminado)
  -> ocrLoop captura excecao, verifica cancelledRef, sai do loop
  -> Promise.all resolve (renderLoop + ocrLoop terminam)
  -> status volta para "idle" imediatamente
```

### Padroes de extracao corrigidos

O texto OCR tipico:
```text
...MENSALISTA AGOSTO DE 2025 S0 CAMILLO ALVES PELZER S14320 1 1 FISCAL DE LIMPEZA...
```

Novo padrao captura "CAMILLO ALVES PELZER" entre o codigo do funcionario (que pode ter letras misturadas) e o codigo CBO/cargo.

