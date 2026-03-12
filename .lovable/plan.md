

## Diagnóstico

O log mostra claramente o problema:

```
[DEBUG] Ignorando - contém palavra inválida: FOLHA MENSAL MENSALISTA FEVEREIRO DE
[DEBUG] Ignorando - contém palavra inválida: SPACE ATIVIDADES DE LIMPEZA EIRELI
[DEBUG] Nenhum nome encontrado.
```

O nome "ALINE BIANCA KICHLER" está presente no texto (visível na linha 20 do log: `520 ALINE BIANCA KICHLER 514320`), mas a extração falha.

**Causa raiz**: Na função `extractEmployeeName` (pdfUtils.ts, linhas 351-385), cada padrão regex usa `normalizedText.match(pattern)` que retorna apenas a **primeira** ocorrência. Quando essa primeira ocorrência é rejeitada (palavra inválida), o `continue` pula para o **próximo padrão** em vez de tentar a **próxima ocorrência do mesmo padrão**.

Exemplo concreto:
1. Padrão 1 (`[A-Z0-9]{2,5} + nome + CBO`) faz match com `GERAL` como código e captura `FOLHA MENSAL MENSALISTA FEVEREIRO DE` com `2026` como CBO. Rejeitado (FOLHA é palavra inválida).
2. O match correto (`520 ALINE BIANCA KICHLER 514320`) é a **segunda** ocorrência do mesmo padrão, mas nunca é tentada.
3. Padrões seguintes também capturam lixo primeiro ("SPACE ATIVIDADES DE LIMPEZA EIRELI").

Isso explica por que funciona em alguns ambientes e não em outros: a ordenação do texto extraído pelo PDF.js varia entre sistemas, alterando qual match vem primeiro.

## Correção

### Arquivo: `src/lib/pdfUtils.ts`, função `extractEmployeeName` (linhas 351-385)

Trocar `normalizedText.match(pattern)` (retorna só o primeiro match) por um loop com `matchAll` que itera por **todas** as ocorrências de cada padrão até encontrar uma válida:

```typescript
for (const pattern of namePatterns) {
  // Criar versão global do regex para matchAll
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  
  for (const match of normalizedText.matchAll(globalPattern)) {
    if (!match[1]) continue;
    
    const name = match[1].trim().replace(/\s+/g, " ");
    const words = name.split(" ").filter((w) => w.length > 1);

    if (words.length < 2 || name.length < 5 || name.length > 60) continue;

    const hasVeryLongWord = words.some((w) => w.length > 15);
    if (hasVeryLongWord) {
      if (debug) console.log("[DEBUG] Ignorando - palavra OCR malformada:", name);
      continue; // Tenta próximo match do MESMO padrão
    }

    const hasInvalidWord = words.some((w) => invalidWords.includes(w));
    if (hasInvalidWord) {
      if (debug) console.log("[DEBUG] Ignorando - contém palavra inválida:", name);
      continue; // Tenta próximo match do MESMO padrão
    }

    if (debug) console.log("[DEBUG] Nome extraído:", name);
    return name;
  }
}
```

Com essa mudança, o padrão 1 vai:
1. Match 1: `GERAL → FOLHA MENSAL... → 2026` → rejeitado (FOLHA)
2. Match 2: `520 → ALINE BIANCA KICHLER → 514320` → aceito

## Impacto

- Correção cirúrgica: apenas a iteração interna muda, sem alterar padrões ou validações
- Resolve o problema no Windows porque agora todas as ocorrências de cada padrão são testadas
- Também melhora a robustez em qualquer ambiente onde a ordem do texto varie

## Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/pdfUtils.ts` | Trocar `.match()` por loop com `.matchAll()` na função `extractEmployeeName` |

