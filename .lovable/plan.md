

# Diagnóstico e Correção: DENIZE BERNARDES BARCELLA sem match

## Análise dos PDFs

Ambos os documentos contêm o nome exato "DENIZE BERNARDES BARCELLA":
- **Recibo página 6**: Código 2214, nome na tabela de funcionários
- **Comprovante página 49**: `Favorecido: DENIZE BERNARDES BARCELLA`

Os nomes são **idênticos** — o score deveria ser 1.0. A falha ocorre ANTES do matching, provavelmente na extração de texto.

## Causas Prováveis

1. **PDF.js não extrai o texto da página 49 corretamente** — caracteres invisíveis, encoding especial, ou ordem de text items quebrada
2. **Regex de extração do FAVORECIDO falha** — o texto real do PDF.js pode ter formatação diferente do esperado (espaços extras, quebras de linha entre palavras)
3. **Conflito com DENISETE MESSAGGI BARCELLA** (páginas vizinhas 5/48) — ambas compartilham sobrenome BARCELLA

## Correção em 2 partes

### 1. Diagnóstico detalhado para nomes não correspondidos (`useDocumentProcessor.ts`)

No relatório de unprocessed, para cada funcionário sem match, adicionar:
- O texto bruto (primeiros 200 chars) da página do comprovante onde o nome DEVERIA estar (buscar pela substring do primeiro nome + sobrenome)
- Se o nome normalizado do holerite está presente como substring no texto normalizado de QUALQUER página do comprovante
- Log explícito: `"[DEBUG-UNMATCHED] DENIZE BERNARDES BARCELLA: encontrado em X páginas como substring, Y páginas como favorecido"`

Isso permitirá identificar se a falha está na extração de texto, na extração do FAVORECIDO, ou no matching.

### 2. Fallback de matching mais robusto — busca direta por primeiro+último nome (`pdfUtils.ts`)

Adicionar um **4o fallback** em `findNameInPreparedPage`, após o word-overlap:
- Se o primeiro nome E o último sobrenome do funcionário aparecem na mesma página, E estão próximos no texto (distância < 100 chars), considerar match com score 0.5
- Isso captura casos onde a extração do FAVORECIDO falha mas o nome está fragmentado no texto
- Score 0.5 garante que será perdido na conflict resolution se houver um match melhor

### 3. Regex de FAVORECIDO mais tolerante (`pdfUtils.ts`)

Na função `extractFavorecidoNames`, expandir o regex principal:
- Aceitar `\n` e `\r` entre as palavras do nome (PDF.js pode quebrar linhas no meio do nome)
- Aceitar até 3 espaços entre palavras (em vez de apenas `\s+`)
- No fallback de busca direta (linha 843-862), aceitar palavras de 1 letra (ex: preposições) entre as palavras do nome

## Arquivos Alterados

- `src/hooks/useDocumentProcessor.ts` — diagnóstico detalhado para unmatched
- `src/lib/pdfUtils.ts` — 4o fallback de matching + regex FAVORECIDO mais tolerante

## Resultado Esperado

Com o diagnóstico, saberemos exatamente onde a extração falha para DENIZE BERNARDES BARCELLA. Os fallbacks adicionais aumentam a resiliência sem risco de falsos positivos (scores baixos perdem em conflitos).

