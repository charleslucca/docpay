

# Correção: Match exclusivamente por Favorecido

## Problema

A função `findNameInPreparedPage` em `src/lib/pdfUtils.ts` usa 5 estratégias de matching em cascata:
0. Favorecido match (nome extraído do label FAVORECIDO/BENEFICIARIO)
1. Exact substring match (nome inteiro no texto)
2. First+Last name proximity (150 chars)
3. Fuzzy word match (Levenshtein)
4. Substring coverage (60%)

As estratégias 1-4 buscam o nome do funcionário em **qualquer lugar do texto** do comprovante, causando falsos positivos (ex: nome aparece em cabeçalho, rodapé, ou é substring de outro nome).

## Regra correta

Match deve acontecer **somente** entre:
- Nome do Favorecido extraído do **holerite** (já extraído por `extractEmployeeName`)
- Nome do Favorecido extraído do **comprovante** (já extraído por `extractFavorecidoNames` com labels FAVORECIDO, BENEFICIARIO, etc.)

Se `extractFavorecidoNames` não encontrar nenhum nome no comprovante, nenhum match deve ocorrer para aquela página.

## Correção

### Arquivo: `src/lib/pdfUtils.ts`

Na função `findNameInPreparedPage` (linhas 605-705): manter **apenas** a estratégia #0 (Favorecido match via `matchNameDirect`). Remover as estratégias 1-4 (exact substring, first+last proximity, fuzzy word, substring coverage).

```typescript
export function findNameInPreparedPage(page: PreparedPage, target: PreparedTarget): boolean {
  // Match ONLY against extracted FAVORECIDO/BENEFICIARIO names
  if (page.favorecidoNames.length > 0) {
    for (const favName of page.favorecidoNames) {
      if (matchNameDirect(target.normalized, favName)) {
        if (DEBUG_MATCH) console.log("[Match] Favorecido:", target.original, "↔", favName);
        return true;
      }
    }
  }
  return false;
}
```

### Arquivo: `src/hooks/useDocumentProcessor.ts`

Adicionar log diagnóstico após extração dos comprovantes para mostrar quantos nomes FAVORECIDO foram extraídos por página:

```typescript
console.log(`[UNIFICAÇÃO] Comprovante ${comprovante.id}: favorecidos extraídos:`, 
  preparedPages.map((p, i) => `pág${i+1}: ${p.favorecidoNames.length} [${p.favorecidoNames.join(', ')}]`));
```

## Impacto

- Match só acontece quando o comprovante tem label explícito (FAVORECIDO, BENEFICIARIO, etc.)
- Elimina falsos positivos de estratégias genéricas
- Se 0 nomes forem extraídos do comprovante → 0 matches (correto)
- Se 1 nome for extraído → busca esse 1 contra os 690 holerites

