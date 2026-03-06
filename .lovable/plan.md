

# Correção da Correspondência entre Holerite e Comprovante

## Causa Raiz Identificada

Após análise detalhada, identifiquei **3 problemas** que juntos explicam por que apenas 1 de 690 funcionários é correspondido:

### Problema 1: Normalização inconsistente entre holerite e comprovante

A função `normalizeForMatch` (usada para comparar nomes) remove dígitos com `.replace(/[^A-Z\s]/g, "")`, mas NÃO aplica as mesmas correções de OCR que `extractEmployeeName` aplica (0→O, 1→I, 5→S). Resultado: se o comprovante tem um nome com ruído OCR como "D0S" (zero), vira "DS" em vez de "DOS".

### Problema 2: Sem estratégia de extração direta do nome no comprovante

O sistema busca o nome do holerite como substring no texto INTEIRO da página do comprovante. Se a página tiver ruído, espaçamento irregular, ou texto fragmentado pelo extrator de PDF, a busca falha. Uma estratégia mais eficaz seria **extrair o nome do FAVORECIDO** do comprovante e comparar nome-a-nome.

### Problema 3: Sem diagnóstico do matching

Quando falha, não há logs mostrando o que foi encontrado nos comprovantes nem quais nomes falharam. Impossível diagnosticar.

## Correções

### 1. `src/lib/pdfUtils.ts`

**a) Melhorar `normalizeForMatch`**: Aplicar correções OCR (0→O, 1→I, 5→S entre letras) ANTES de remover caracteres não-alfabéticos.

**b) Nova função `extractFavorecidoNames`**: Extrai TODOS os nomes após "FAVORECIDO" de uma página de comprovante. Retorna array de nomes normalizados (um comprovante SICREDI pode ter um favorecido por página).

**c) Nova função `matchNameDirect`**: Compara dois nomes normalizados usando Levenshtein proporcional e cobertura de palavras. Mais robusto que buscar substring no texto inteiro.

**d) Atualizar `findNameInPreparedPage`**: Adicionar como **primeiro check** (antes do exact match): se a página contém "FAVORECIDO", extrair o nome e fazer match direto com o target. Isso é mais preciso que buscar substring.

### 2. `src/hooks/useDocumentProcessor.ts`

**a) Log de diagnóstico pós-matching**: Após o loop de matching, logar:
- Total de funcionários do holerite
- Total de páginas de comprovante processadas
- Quantas páginas tinham texto não-vazio (>50 chars)
- Primeiros 5 nomes não correspondidos
- Amostra do texto normalizado de 3 páginas de comprovante (primeiros 200 chars)
- Total de nomes "FAVORECIDO" encontrados nos comprovantes

**b) Toast com detalhes**: Se matches < 50% do total, exibir toast com informação adicional sobre quantas páginas do comprovante tinham texto legível.

### 3. Interface `PreparedPage` (em pdfUtils.ts)

Adicionar campo `favorecidoNames: string[]` para armazenar nomes extraídos do label "FAVORECIDO" durante a preparação da página (feito 1 vez, reutilizado para todos os 690 comparisons).

## Fluxo corrigido

```text
Comprovante página → normalizeForMatch → PreparedPage
                                          ├── normalized (texto completo)
                                          ├── wordSet / wordsByLength
                                          └── favorecidoNames[] ← NOVO

Para cada funcionário do holerite:
  1. FAVORECIDO MATCH (NOVO): comparar nome do holerite diretamente
     com cada favorecidoNames[] usando fuzzy name matching
  2. EXACT MATCH: page.normalized.includes(target.normalized)
  3. FIRST+LAST proximity
  4. FUZZY word matching
  5. SUBSTRING coverage
```

## Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/pdfUtils.ts` | OCR corrections em normalizeForMatch, extractFavorecidoNames, matchNameDirect, favorecidoNames em PreparedPage |
| `src/hooks/useDocumentProcessor.ts` | Logs de diagnóstico após matching, toast informativo |

