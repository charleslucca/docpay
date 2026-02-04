
## O que está acontecendo (com base no print)
Pelo print, não parece que o app “travou” no matching; ele **concluiu o matching com 0 correspondências**:

- Título da etapa: “Buscando correspondências” (rótulo fixo da etapa `matching`)
- Mensagem logo abaixo: “0 correspondência(s) encontrada(s)”
- Barra em 100%

Hoje, quando dá **0 matches**, o fluxo fica “sem saída” porque:
- não aparece o botão “Gerar PDFs” (depende de `matchedPairs.length > 0`)
- o status permanece em `matching` com `progress: 100`
Isso passa a impressão de travamento, mas na prática é “processo terminou e não achou ninguém”.

O problema real, então, é: **o texto extraído do comprovante (OCR/nativo) não está trazendo nomes utilizáveis** ou o matching não está conseguindo localizar os nomes no texto extraído.

---

## Objetivo
1) Parar de deixar o usuário “preso” quando o resultado é 0 matches (UX/feedback).  
2) Adicionar diagnóstico simples e confiável para confirmar se o OCR está vindo vazio/fraco.  
3) Melhorar a robustez do OCR para comprovantes: **auto-retry** em páginas com texto muito curto + opção de “OCR reforçado” (maior escala/timeout) sem precisar recomeçar do zero.

---

## Diagnóstico técnico provável
### A) OCR “termina”, mas retorna texto vazio em várias páginas
Atualmente `extractTextWithOCR()` faz timeout em 30s e, em erro, **retorna string vazia** (`''`) silenciosamente.  
Isso permite o pipeline seguir normalmente, mas o matching não acha nada.

### B) O comprovante é “difícil” (texto pequeno/baixa qualidade)
O comprovante usa `OCR_SCALE_HIGH = 2.0`. Em alguns PDFs escaneados com fonte pequena, isso pode produzir OCR fraco.  
Sem retry, várias páginas podem ficar com texto curto.

---

## Solução (implementação)
### 1) Adicionar “Resumo de qualidade do OCR” e sinalização quando 0 matches
**Mudanças:**
- Estender `ProcessingStatus` (type) com métricas do comprovante, por exemplo:
  - `ocrPagesTotal?: number`
  - `ocrPagesNeedingOcr?: number`
  - `ocrPagesEmptyOrShort?: number` (ex.: texto < 30–50 chars)
  - `ocrTimeoutCount?: number`
  - `ocrRetryCount?: number`
- Exibir no UI (em `ProcessingStatus.tsx`) um bloco informativo quando `status.step === 'matching' && status.progress === 100 && matchesFound === 0`:
  - “Nenhuma correspondência encontrada. Isso normalmente acontece quando o OCR retornou pouco texto ou quando os nomes não aparecem no comprovante.”
  - Mostrar métricas: “OCR: X/Y páginas | Páginas com texto curto: Z | Timeouts: W | Retries: R”
  - Mostrar CTA: **“Reprocessar comprovante com OCR reforçado”** e **“Reiniciar”**.

**Arquivos:**
- `src/types/document.ts`
- `src/components/ProcessingStatus.tsx`
- `src/pages/Index.tsx` (para exibir botões/ações extras quando 0 matches, se necessário)

**Critério de aceite:**
- Ao terminar com 0 matches, o usuário vê claramente que “terminou, mas não encontrou”, e vê o porquê provável + ação de correção.

---

### 2) Tornar OCR observável: retornar metadados (timeout/retry/len)
Hoje `extractTextWithOCR` retorna só `string`. Vamos mudar para **retornar também o status** (sem expor conteúdo sensível; apenas métricas).

**Proposta:**
- Criar um tipo:
  ```ts
  export type OcrPageResult = {
    text: string;
    timedOut: boolean;
    durationMs: number;
    confidence?: number;
  };
  ```
- `extractTextWithOCR(...)` passa a retornar `OcrPageResult` (ou criar uma nova função `extractTextWithOCRResult` e manter a antiga para compatibilidade).

**Arquivos:**
- `src/lib/ocrUtils.ts`

**Critério de aceite:**
- Conseguimos contar timeouts e medir duração real de OCR por página.

---

### 3) Auto-retry no comprovante quando OCR vier “curto”
No `getCachedPageTextsWithOCR` (comprovantes), implementar:
- após OCR de uma página, se `text.trim().length < MIN_ACCEPTABLE_OCR_TEXT` (ex.: 40):
  - **retry 1x** com:
    - escala maior (ex.: 2.6 ou 3.0)
    - (opcional) timeout maior (ex.: 45s)
    - possivelmente sem grayscale (em alguns casos ajuda, mas é trade-off; podemos manter grayscale no 1º e desativar só no retry)

Isso melhora muito casos onde escala 2.0 não basta.

**Como encaixar sem quebrar o fluxo:**
- Ajustar `getCachedPageTextsWithOCR` para aceitar um objeto de opções, por exemplo:
  ```ts
  type OcrOptions = {
    minAcceptableTextLen?: number;
    scalePrimary?: number;
    scaleRetry?: number;
    timeoutPrimaryMs?: number;
    timeoutRetryMs?: number;
    retryOnceIfShort?: boolean;
  };
  ```
- Na extração de comprovantes (em `useDocumentProcessor`), quando estiver processando comprovantes grandes ou quando o usuário clicar “OCR reforçado”, usar opções mais agressivas.

**Arquivos:**
- `src/lib/pdfCache.ts`
- `src/hooks/useDocumentProcessor.ts`

**Critério de aceite:**
- PDFs escaneados com texto pequeno passam a produzir texto suficiente para matching em mais páginas (reduz “0 matches” falsos).
- Métricas refletem “retries”.

---

### 4) Botão “Reprocessar comprovante com OCR reforçado” (sem precisar reupar)
Adicionar uma ação no hook:
- `reprocessComprovantesEnhancedOcr()`:
  - limpar caches relevantes:
    - `clearCache()` (pdfCache) e `clearOcrCache()` (ocrUtils)
    - opcional: `terminateOcrWorker()` para recriar pool “limpo”
  - rodar novamente o pipeline (pelo menos comprovantes + matching; ou tudo, mas mantendo holerites já carregados)
  - setar um flag interno `enhancedOcrMode` para usar `scaleRetry/timeoutRetry` mais altos

**Arquivos:**
- `src/hooks/useDocumentProcessor.ts`
- `src/lib/pdfCache.ts`
- `src/lib/ocrUtils.ts`
- `src/pages/Index.tsx` / `src/components/ProcessingStatus.tsx` (botão)

**Critério de aceite:**
- Após 0 matches, um clique reprocessa com OCR mais forte e tenta novamente achar correspondências.

---

## Observações de performance e segurança (privacy)
- Continuamos 100% client-side (sem serviços externos de OCR além de baixar os assets do Tesseract, como já ocorre hoje).
- O retry só acontece em páginas “curtas”, evitando explosão de tempo.
- Mantemos cancelamento funcionando (checar `cancelledRef.current` também durante retries).

---

## Plano de testes (manual)
1) Reproduzir com o mesmo PDF de comprovante (70 páginas):
   - confirmar que, se der 0 matches, aparece o painel “Nenhuma correspondência” + métricas + botão de reprocessar.
2) Clicar “Reprocessar com OCR reforçado”:
   - verificar que o processamento reinicia e a UI atualiza progresso.
3) Validar que o matching passa a encontrar matches (se o comprovante realmente contiver os mesmos funcionários dos holerites).
4) Testar cancelamento durante OCR e durante retry (não deve travar).
5) Testar em PC mais fraco (2–4 cores) para garantir que o retry não derruba o navegador.

---

## Arquivos que serão alterados
- `src/types/document.ts` (novas métricas de OCR no status)
- `src/lib/ocrUtils.ts` (retornar metadados e permitir timeout configurável)
- `src/lib/pdfCache.ts` (retry de OCR quando texto curto + opções)
- `src/hooks/useDocumentProcessor.ts` (coletar métricas, ligar enhanced mode, ação de reprocessar)
- `src/components/ProcessingStatus.tsx` (mostrar métricas + CTA quando 0 matches)
- (se necessário) `src/pages/Index.tsx` (expor o botão de reprocesso em local apropriado)

