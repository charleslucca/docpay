
## Objetivo
Destravar a etapa **“match / Buscando correspondências em memória…”** após o OCR do recibo, evitando que o navegador fique “congelado” e reduzindo drasticamente o tempo de matching.

---

## Diagnóstico (causa mais provável)
Hoje o matching faz um “triplo loop” totalmente **CPU-bound** (sem `await` dentro):

- Para cada **comprovante**  
  - Para cada **funcionário extraído dos holerites**  
    - Para cada **página do comprovante (70 páginas)**  
      - chama `findNameInPage(pageText, entry.name)`

E `findNameInPage` atualmente:
- normaliza **o texto inteiro da página** (`normalize(pageText)`) *toda vez*  
- faz `split` em palavras *toda vez*  
- pode calcular Levenshtein em vários pares de palavras

Isso explode o custo (ex.: 1 comprovante * 70 funcionários * 70 páginas = 4900 chamadas), e como é tudo síncrono no main-thread, a UI aparenta travada no “match”.

---

## Correção proposta (alto impacto, baixo risco)
### A) Pré-processar os textos do comprovante (uma única vez por página)
Em vez de normalizar e tokenizar a mesma página 70 vezes, vamos preparar cada página 1x:

- `normalizedPage` (string normalizada)
- `pageWords` (lista de palavras)
- `pageWordSet` (Set para match exato)
- `pageWordsByLength` (Map para reduzir candidatos no fuzzy)

Isso reduz o trabalho de “normalização de página” de **4900x** para **70x**.

### B) Pré-processar os nomes dos holerites (uma única vez por funcionário)
Preparar `normalizedTarget`, `targetWords`, `firstName`, `lastName` uma única vez por entrada.

### C) Fazer o loop de matching “cooperativo” (não travar UI)
Adicionar “yields” no matching (ex.: a cada 200–500 comparações):
- `await pauseBetweenBatches()` (já existe e usa `requestIdleCallback` quando possível)

Além disso, atualizar o status de forma **throttled** (ex.: no máximo 4x/seg) para não gerar re-render excessivo.

### D) Reduzir logs no match
Os `console.log('[Match] ...')` dentro de `findNameInPage` podem gerar volume alto em caso de falso positivo. Vamos colocar logs atrás de um `DEBUG_MATCH = false` (ou remover logs).

---

## Mudanças de código (arquivos)
### 1) `src/lib/pdfUtils.ts` — separar “preparo” e “match”
Adicionar:
- `normalizeForMatch(text: string): string`
- `preparePageForMatch(pageText: string): PreparedPage`
- `prepareTargetNameForMatch(name: string): PreparedTarget`
- `findNameInPreparedPage(preparedPage, preparedTarget): boolean`

Manter `findNameInPage(pageText, targetName)` como wrapper para compatibilidade (chamando as funções novas), mas o matching principal vai usar as versões “prepared”.

**Otimizações dentro do fuzzy:**
- usar `pageWordSet` para match exato sem loop
- buscar candidatos só em buckets de tamanho `len ± maxErrors` antes de calcular Levenshtein
- early-exit: se já atingiu `requiredMatches`, retorna; se não há como atingir (restante insuficiente), encerra

### 2) `src/hooks/useDocumentProcessor.ts` — refatorar etapa “Step 3: matching”
Alterar o mapa `comprovanteTextsMap` para armazenar também o pré-processado:
- `pageTexts` (opcional, para debug)
- `preparedPages: PreparedPage[]`

Fluxo:
1. Após `getCachedPageTextsWithOCR`, construir `preparedPages = pageTexts.map(preparePageForMatch)`
2. Preparar todas as entradas de holerite uma vez:
   - `preparedEntries = allHoleriteEntries.map(e => ({...e, prepared: prepareTargetNameForMatch(e.name)}))`
3. Matching usando `findNameInPreparedPage(preparedPages[pageIdx], entry.prepared)`

**Não travar UI:**
- adicionar contador `comparisons`
- a cada `YIELD_EVERY = 250` comparações: `await pauseBetweenBatches()`
- atualizar status com throttle:
  - mensagem: `Matching comprovante X/Y - funcionário A/B - página p/q`
  - progresso: de 60 → 90 baseado em `(comprovanteIndex + entryIndex/entriesTotal) / comprovantesTotal`

**Atalho opcional simples (sem mudar a regra de negócio):**
- se `matchedEntryKeys.size === allHoleriteEntries.length`, parar o matching (já achou todos)

### 3) (Opcional) Timeout de segurança do matching
Assim como no OCR, adicionar um limite (ex.: 5 minutos) para evitar loop “parecendo infinito” em edge cases:
- se exceder: abortar matching e mostrar toast/erro com instrução “tente novamente / reduza lote / verifique OCR”.

---

## Critérios de aceite (o que deve melhorar)
1. Ao entrar em “Buscando correspondências…”, a UI **continua atualizando** (mensagem e barra de progresso se movem).
2. Para 70 páginas, o matching deixa de “congelar” e passa a:
   - concluir em tempo significativamente menor (normalmente segundos a dezenas de segundos, dependendo do texto)
   - permitir cancelar imediatamente (botão de cancelar responde)
3. Sem spam de logs de match.

---

## Plano de implementação (passo a passo)
1. Ler e ajustar `findNameInPage` em `pdfUtils.ts` para extrair normalização/tokenização e criar as funções “prepare”.
2. Implementar `findNameInPreparedPage` com as mesmas 4 camadas (exato / primeiro+último / fuzzy / substring), mas usando dados pré-processados e buckets.
3. Refatorar a etapa de matching em `useDocumentProcessor.ts` para:
   - preparar páginas do comprovante 1x
   - preparar nomes 1x
   - inserir `await pauseBetweenBatches()` periodicamente
   - inserir updates de status throttled
4. Testar com:
   - comprovante 70 páginas (escaneado)
   - lote pequeno (poucos holerites) para garantir que não “pare” no match
5. Se ainda estiver lento: avaliar “indexação” por tokens (map de palavra → lista de entries) ou mover matching para Web Worker (plano B).

---

## Riscos / trade-offs
- Pré-processar páginas cria estruturas em memória (Set/Map). Para ~70 páginas é aceitável; para centenas, pode crescer. Vamos manter estruturas enxutas e, se necessário, usar apenas `normalizedPage` + `pageWordsByLength`.
- Throttle de status evita re-render excessivo; sem throttle pode ficar mais lento do que o ganho do matching.

