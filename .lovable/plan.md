

# Correção: Extração de nomes FAVORECIDO falhando no comprovante

## Diagnóstico

O matching via `matchNameDirect` **já suporta** o typo "FERNANDDES" vs "FERNANDES" (Levenshtein = 1, threshold = 2). O problema real é que `extractFavorecidoNames` **não está extraindo o nome** do comprovante.

A regex na linha 474 exige um **lookahead** após o nome — precisa encontrar CPF, CNPJ, CONTA, dígitos de CPF, etc. imediatamente após o nome. Se o formato do PDF Sicredi não tem essas âncoras logo após o nome (ex: tem uma quebra de linha, ou campo diferente), o regex falha silenciosamente e retorna 0 nomes.

## Correção

### Arquivo: `src/lib/pdfUtils.ts`

**1. Adicionar fallback de extração manual** em `extractFavorecidoNames` (após o regex, linhas 489-495):

Quando o regex retorna 0 nomes, fazer busca direta:
- Localizar cada label ("FAVORECIDO", "BENEFICIARIO", etc.) no texto
- Após o label + `:`, capturar palavras consecutivas em maiúscula (A-Z) até encontrar uma stop-word, dígito isolado, ou fim de texto
- Validar: mínimo 2 palavras, 5+ caracteres

```typescript
// Fallback: busca direta quando regex falha
if (names.length === 0) {
  const labelsList = ["NOME DO FAVORECIDO", "NOME DO BENEFICIARIO", "NOME FAVORECIDO", 
                       "NOME BENEFICIARIO", "FAVORECIDO", "BENEFICIARIO", "DESTINATARIO"];
  const stopWords = new Set(["CPF", "CNPJ", "AGENCIA", "CONTA", "BANCO", "VALOR", 
    "COOPERATIVA", "DATA", "MODALIDADE", "CODIGO", "NUMERO", "TIPO", "CREDITO", 
    "DEBITO", "PAGAMENTO", "TRANSFERENCIA", "PIX", "TED", "DOC", "CHAVE", "INSTITUICAO"]);
  
  for (const label of labelsList) {
    const idx = text.indexOf(label);
    if (idx === -1) continue;
    
    let afterLabel = text.substring(idx + label.length).replace(/^\s*:?\s*/, "");
    // Extrair palavras até stop-word ou dígito
    const words: string[] = [];
    for (const word of afterLabel.split(/\s+/)) {
      if (stopWords.has(word) || /^\d/.test(word) || word.length === 0) break;
      if (/^[A-Z]{2,}$/.test(word)) words.push(word);
      else break;
    }
    if (words.length >= 2) {
      const normalized = normalizeForMatch(words.join(" "));
      if (!names.includes(normalized)) names.push(normalized);
      break; // Usar primeiro label encontrado
    }
  }
}
```

**2. Adicionar log diagnóstico** quando 0 nomes são encontrados (mesmo após fallback):

```typescript
if (names.length === 0) {
  const hasLabel = labels.some(l => text.includes(l));
  console.warn(`[FavorecidoExtract] 0 nomes extraídos. Label encontrado: ${hasLabel}. Texto (200 chars):`, text.substring(0, 200));
}
```

**3. Ativar `DEBUG_MATCH = true`** temporariamente para diagnóstico.

## Impacto

- Se o regex principal funciona, nada muda
- Se o regex falha por falta de lookahead anchor, o fallback extrai o nome por busca direta
- O matching com typo (FERNANDDES ↔ FERNANDES) já funciona via Levenshtein — só precisa que o nome seja extraído
- Sem risco de falsos positivos: exige label explícito + nome com 2+ palavras uppercase

## Arquivo alterado

| Arquivo | Alteração |
|---|---|
| `src/lib/pdfUtils.ts` | Fallback de extração manual em `extractFavorecidoNames` + log diagnóstico + DEBUG_MATCH=true |

