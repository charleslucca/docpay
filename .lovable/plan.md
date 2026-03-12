

## Diagnóstico

### Análise do Log

O log mostra claramente que a **extração de nomes** está falhando:

```
[DEBUG] Ignorando - contém palavra inválida: FOLHA MENSAL MENSALISTA FEVEREIRO DE
[DEBUG] Ignorando - contém palavra inválida: SPACE ATIVIDADES DE LIMPEZA EIRELI
[DEBUG] Nenhum nome encontrado.
```

O nome `ALINE BIANCA KICHLER` está presente no texto (posição `520 ALINE BIANCA KICHLER 514320`), mas a extração retorna null. Resultado: **0 funcionários extraídos → 0 matches**.

### Causa Raiz 1: matchAll (já corrigido, mas não testado pelo usuário)

A correção de `.match()` → `.matchAll()` em `extractEmployeeName` já foi aplicada na sessão anterior. O log fornecido foi capturado **antes** dessa correção ser testada. Com o matchAll ativo, o padrão 7 (`\b([A-Z]{3,15}(?:\s+[A-Z]{2,15}){1,4})\b`) encontraria `ALINE BIANCA KICHLER` após rejeitar os matches com palavras inválidas.

### Causa Raiz 2: Bloqueio de fallback no matching (NÃO corrigido)

Em `findNameInPreparedPage` (pdfUtils.ts, linha 887-889):

```typescript
// If FAVORECIDO names were extracted but none matched, don't fallback
// (page has structured data, trust it)
return { found: false, method: "" };
```

Quando `extractFavorecidoNames` extrai nomes de uma página do comprovante mas **nenhum bate** com o funcionário (por ruído de OCR, truncamento, ou extração imperfeita), o sistema **recusa fazer fallback** para substring ou word-overlap. Isso descarta matches legítimos onde o nome DO funcionário está no texto da página mas a extração de FAVORECIDO foi ruidosa.

**Impacto estimado**: Em um arquivo com ~65 funcionários, se ~25% das páginas de comprovante têm FAVORECIDO extraído mas com erro (nome truncado, OCR ruim, nome errado capturado), esses ~17 funcionários são perdidos. Isso explica 48 vs 65+.

### Cenário real de perda

```
Página do comprovante: "FAVORECIDO: MARI DA SILVA" (OCR errou MARIA → MARI)
extractFavorecidoNames → ["MARI DA SILVA"]
matchNameDirect("MARIA DA SILVA", "MARI DA SILVA") → score 0.82 < 0.85 → falha
→ RETURN FALSE (sem tentar substring "MARIA DA SILVA" no texto da página)
```

## Correção

### Arquivo: `src/lib/pdfUtils.ts`, função `findNameInPreparedPage` (linhas 886-889)

Remover o `return { found: false }` que bloqueia o fallback. Se FAVORECIDO não matchou, continuar para substring e word-overlap:

```typescript
// Antes:
if (page.favorecidoNames.length > 0) {
  for (const favName of page.favorecidoNames) {
    if (matchNameDirect(target.normalized, favName)) {
      return { found: true, method: "favorecido" };
    }
  }
  return { found: false, method: "" }; // ← BLOQUEIA FALLBACK
}

// Depois:
if (page.favorecidoNames.length > 0) {
  for (const favName of page.favorecidoNames) {
    if (matchNameDirect(target.normalized, favName)) {
      return { found: true, method: "favorecido" };
    }
  }
  // NÃO retornar aqui — continuar para substring e word-overlap
}
```

### Por que é seguro remover o bloqueio

O fallback de substring exige match exato do nome completo normalizado (≥8 chars). O fallback de word-overlap exige primeiro nome + último nome + 70% das palavras + proximidade no texto (regex). Ambos são suficientemente restritivos para evitar falsos positivos.

## Resumo

| Etapa | Problema | Status |
|-------|----------|--------|
| Extração (matchAll) | `.match()` retorna só 1ª ocorrência | ✅ Já corrigido |
| Matching (fallback) | `return false` bloqueia substring/word-overlap | ❌ Corrigir agora |

## Arquivo alterado

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/pdfUtils.ts` | Remover `return { found: false }` na linha 889 de `findNameInPreparedPage` |

