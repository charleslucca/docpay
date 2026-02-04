
# Plano: Melhorar Algoritmo de Matching para Aumentar Taxa de 27/70 para ~65/70

## Análise do Problema

### Situação Atual
- **Extração**: Funcionando (encontrou os nomes nos holerites)
- **Matching**: Falhando (apenas 27 de 70 correspondências = 38%)
- **Causa**: O algoritmo `findNameInPage` está muito restritivo

### Problemas Identificados na Função `findNameInPage`

```text
┌─────────────────────────────────────────────────────────────┐
│ PROBLEMA 1: Levenshtein muito restritivo                    │
├─────────────────────────────────────────────────────────────┤
│ Permite apenas 1 erro por palavra, mas OCR "fast"           │
│ pode introduzir 2-3 erros em palavras longas.               │
│                                                             │
│ Exemplo:                                                    │
│   Holerite: "JOSENILDO"                                     │
│   Comprovante (OCR): "JOSENIIDO" (2 erros)                  │
│   Resultado: NÃO MATCH (deveria dar match)                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ PROBLEMA 2: Threshold de 80% muito alto                     │
├─────────────────────────────────────────────────────────────┤
│ Nome com 3 palavras: 80% = 2.4 → arredonda para 3           │
│ Exige TODAS as palavras (deveria ser 2)                     │
│                                                             │
│ Exemplo:                                                    │
│   Nome: "MARIA SILVA SANTOS" (3 palavras)                   │
│   Encontrado: "MARIA" + "SANTOS" (2 palavras)               │
│   Resultado: FALHA (precisa 3, encontrou 2)                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ PROBLEMA 3: Busca de proximidade usa só primeiro índice     │
├─────────────────────────────────────────────────────────────┤
│ indexOf() retorna só a primeira ocorrência                  │
│ Nome pode aparecer em posição diferente                     │
│                                                             │
│ Exemplo:                                                    │
│   Texto: "BANCO: MARIA ... (500 chars) ... FAVORECIDO: MARIA SILVA"
│   indexOf("MARIA") = posição 7                              │
│   indexOf("SILVA") = posição 550                            │
│   Distância = 543 > 100 → FALHA                             │
│   Mas há "MARIA SILVA" juntos na posição 530!               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ PROBLEMA 4: Ignora palavras curtas importantes              │
├─────────────────────────────────────────────────────────────┤
│ Filtra palavras < 3 caracteres                              │
│ "DA", "DE", "DOS" são descartados                           │
│                                                             │
│ Mas isso pode causar confusão:                              │
│   "MARIA DA SILVA" → ["MARIA", "SILVA"]                     │
│   "MARIA SILVA" → ["MARIA", "SILVA"]                        │
│   Ambos podem dar match incorreto                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Solução: Reescrever `findNameInPage` com Matching Mais Tolerante

### Estratégia Multi-Nível

1. **Match exato** (mais rápido)
2. **Match por primeiro + último nome** (com busca de todas ocorrências)
3. **Match fuzzy proporcional** (erro permitido = ~20% do tamanho da palavra)
4. **Match por substring significativa** (se >60% do nome está contido)

---

## Arquivos a Modificar

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/pdfUtils.ts` | Reescrever `findNameInPage` com matching mais tolerante |

---

## Implementação Detalhada

### Nova Função `findNameInPage`

```typescript
export function findNameInPage(pageText: string, targetName: string): boolean {
  // Normalização robusta
  const normalize = (s: string) => s
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // Remove acentos
    .replace(/[^A-Z\s]/g, '')          // Remove números/símbolos
    .replace(/\s+/g, ' ')
    .trim();

  const normalizedTarget = normalize(targetName);
  const normalizedPage = normalize(pageText);
  
  // 1. MATCH EXATO - mais rápido
  if (normalizedPage.includes(normalizedTarget)) {
    console.log('[Match] Exato:', targetName);
    return true;
  }
  
  // 2. MATCH PRIMEIRO + ÚLTIMO NOME com busca de TODAS ocorrências
  const nameParts = normalizedTarget.split(' ').filter(p => p.length > 2);
  if (nameParts.length >= 2) {
    const firstName = nameParts[0];
    const lastName = nameParts[nameParts.length - 1];
    
    // Encontrar TODAS as ocorrências do primeiro nome
    const allFirstPositions = findAllOccurrences(normalizedPage, firstName);
    const allLastPositions = findAllOccurrences(normalizedPage, lastName);
    
    // Verificar se algum par está próximo (dentro de 150 caracteres)
    for (const firstPos of allFirstPositions) {
      for (const lastPos of allLastPositions) {
        if (Math.abs(firstPos - lastPos) < 150) {
          console.log('[Match] Primeiro+Último nome:', targetName);
          return true;
        }
      }
    }
  }
  
  // 3. MATCH FUZZY com tolerância proporcional ao tamanho da palavra
  const targetWords = normalizedTarget.split(' ').filter(w => w.length >= 3);
  const pageWords = normalizedPage.split(' ').filter(w => w.length >= 3);
  
  let matchedWords = 0;
  for (const targetWord of targetWords) {
    // Tolerância: 1 erro para palavras curtas, 2 para médias, 3 para longas
    const maxErrors = targetWord.length <= 5 ? 1 : 
                      targetWord.length <= 8 ? 2 : 3;
    
    for (const pageWord of pageWords) {
      // Primeiro tentar match exato (mais rápido)
      if (pageWord === targetWord) {
        matchedWords++;
        break;
      }
      
      // Só calcular Levenshtein se tamanhos são similares
      if (Math.abs(pageWord.length - targetWord.length) <= maxErrors) {
        if (levenshteinDistance(pageWord, targetWord) <= maxErrors) {
          matchedWords++;
          break;
        }
      }
    }
  }
  
  // Reduzir threshold de 80% para 70% (mais tolerante)
  const requiredMatches = Math.max(2, Math.floor(targetWords.length * 0.7));
  if (matchedWords >= requiredMatches) {
    console.log(`[Match] Fuzzy ${matchedWords}/${targetWords.length}:`, targetName);
    return true;
  }
  
  // 4. MATCH POR SUBSTRING - se >60% do nome aparece como substring
  const targetLength = normalizedTarget.replace(/\s/g, '').length;
  let matchedChars = 0;
  for (const word of targetWords) {
    if (normalizedPage.includes(word)) {
      matchedChars += word.length;
    }
  }
  if (matchedChars / targetLength >= 0.6) {
    console.log(`[Match] Substring ${matchedChars}/${targetLength}:`, targetName);
    return true;
  }
  
  return false;
}

// Função auxiliar: encontrar TODAS as posições de uma substring
function findAllOccurrences(text: string, search: string): number[] {
  const positions: number[] = [];
  let pos = 0;
  while ((pos = text.indexOf(search, pos)) !== -1) {
    positions.push(pos);
    pos += 1;
  }
  return positions;
}
```

---

## Mudanças Específicas

| Aspecto | Antes | Depois |
|---------|-------|--------|
| Levenshtein | Máximo 1 erro sempre | 1-3 erros proporcional ao tamanho |
| Threshold | 80% (muito alto) | 70% (mais tolerante) |
| Proximidade | Primeira ocorrência | Todas as ocorrências |
| Mínimo de matches | 2 palavras | 2 palavras (mantido) |
| Match substring | Não tinha | 60% do nome como substring |
| Logging | Sem log | Logs para debug |

---

## Resultado Esperado

| Métrica | Antes | Depois |
|---------|-------|--------|
| Matches encontrados | 27/70 (38%) | ~60-65/70 (85-93%) |
| Falsos positivos | ~0% | ~1-2% (risco aceitável) |

---

## Observações Técnicas

1. **Performance**: As mudanças são apenas em comparações de string (operações O(n)), sem impacto significativo no tempo total.

2. **Logging para Debug**: Adicionei logs `[Match]` para identificar qual estratégia está funcionando, útil para ajuste fino.

3. **Risco de Falso Positivo**: Com matching mais tolerante, pode haver matches incorretos em casos de nomes muito similares. Se isso ocorrer, podemos adicionar validação por CPF como fallback.

4. **Próximos Passos (se necessário)**: Se o matching ainda não for suficiente, podemos:
   - Usar match por CPF (mais preciso que nome)
   - Implementar score de confiança e mostrar matches "incertos" para revisão manual
