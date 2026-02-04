
# Plano: Correção de Loop Infinito e Matching Incompleto

## Problemas Identificados

### 1. Loop Infinito no Pipeline OCR
O sistema trava em "Buscando correspondências" porque o loop de OCR nunca termina:

```text
┌─────────────────────────────────────────────────────────────┐
│ PROBLEMA: Condição de término desincronizada               │
├─────────────────────────────────────────────────────────────┤
│ renderLoop:                                                 │
│   - Processa páginas do cache                               │
│   - Incrementa pagesProcessed                               │
│   - Não adiciona à canvasQueue (já tem texto)               │
│                                                             │
│ ocrLoop:                                                    │
│   - Espera canvases na queue                                │
│   - Queue está vazia (páginas vieram do cache)              │
│   - Verifica: pagesProcessed >= totalPages                  │
│   - MAS pagesProcessed foi incrementado no outro loop!      │
│   - Resultado: LOOP INFINITO esperando por canvases         │
└─────────────────────────────────────────────────────────────┘
```

### 2. Extração Incompleta (319 de 344 nomes)
O modelo OCR `fast` pode produzir texto menos preciso, fazendo alguns nomes falharem na regex.

### 3. Matching Parcial (24 de 70 correspondências)
A função `findNameInPage` exige que o nome extraído do holerite exista exatamente no comprovante. Variações de OCR impedem o match.

---

## Soluções

### Correção 1: Sincronização do Loop de OCR

Modificar a lógica para:
1. Usar contador separado para páginas que precisam de OCR
2. O `ocrLoop` deve verificar se `renderingComplete` e não há mais trabalho

```typescript
// ANTES (bugado)
if (renderingComplete && canvasQueue.length === 0 && pagesProcessed >= totalPages) {
  ocrComplete = true;
}

// DEPOIS (correto)
// Quando render termina E queue está vazia E não há mais páginas a processar
if (renderingComplete && canvasQueue.length === 0) {
  ocrComplete = true;
}
```

### Correção 2: Matching Fuzzy para Nomes

Melhorar a função `findNameInPage` para tolerar:
- Espaços extras/faltantes
- Caracteres OCR incorretos
- Partes do nome

```typescript
export function findNameInPage(pageText: string, targetName: string): boolean {
  const normalize = (s: string) => s
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove acentos
    .replace(/[^A-Z\s]/g, '')         // Remove números/símbolos
    .replace(/\s+/g, ' ')             // Normaliza espaços
    .trim();
  
  const normalizedTarget = normalize(targetName);
  const normalizedPage = normalize(pageText);
  
  // Match exato
  if (normalizedPage.includes(normalizedTarget)) {
    return true;
  }
  
  // Match por partes do nome (primeiro + último nome)
  const nameParts = normalizedTarget.split(' ').filter(p => p.length > 2);
  if (nameParts.length >= 2) {
    const firstName = nameParts[0];
    const lastName = nameParts[nameParts.length - 1];
    
    // Ambas partes precisam estar presentes
    if (normalizedPage.includes(firstName) && normalizedPage.includes(lastName)) {
      // Verificar se estão próximas (dentro de 100 caracteres)
      const firstIdx = normalizedPage.indexOf(firstName);
      const lastIdx = normalizedPage.indexOf(lastName);
      if (Math.abs(firstIdx - lastIdx) < 100) {
        return true;
      }
    }
  }
  
  return false;
}
```

### Correção 3: Regex de Extração Mais Robusta

Adicionar padrões extras para capturar mais formatos de nomes:

```typescript
// Adicionar ao array namePatterns:

// Padrão para nomes em maiúscula isolados (2-4 palavras)
/\b([A-Z]{3,}\s+[A-Z]{3,}(?:\s+[A-Z]{3,})?(?:\s+[A-Z]{3,})?)\b/,

// Padrão para "FAVORECIDO: NOME" (comum em comprovantes bancários)
/FAVORECIDO\s*:?\s*([A-Z][A-Z\s]{5,40}?)(?=\s*(?:CPF|CNPJ|AGENCIA|CONTA|\d))/i,
```

---

## Arquivos a Modificar

| Arquivo | Alteração |
|---------|-----------|
| `src/hooks/useDocumentProcessor.ts` | Corrigir condição de término do loop OCR |
| `src/lib/pdfUtils.ts` | Melhorar matching fuzzy e regex de extração |

---

## Mudanças Detalhadas

### `useDocumentProcessor.ts` - Correção do Loop

**Localização:** Linhas 445-556 (função ocrLoop)

```typescript
// OCR loop: process batches as canvases become available
const ocrLoop = async () => {
  while (!cancelledRef.current) {
    // Collect batch up to worker count
    const batch: { pageNum: number; canvas: HTMLCanvasElement }[] = [];
    
    while (batch.length < workerCount && canvasQueue.length > 0) {
      batch.push(canvasQueue.shift()!);
    }
    
    if (batch.length > 0) {
      // ... processo de OCR existente ...
    }
    
    // CORRIGIDO: Verificar término de forma mais simples
    // Se o render terminou E não há mais canvases na queue, terminamos
    if (renderingComplete && canvasQueue.length === 0) {
      break; // Sair do loop em vez de usar flag
    }
    
    // Se não há canvases mas render ainda está rodando, aguardar
    if (canvasQueue.length === 0) {
      await new Promise(r => setTimeout(r, 20));
    }
  }
};
```

### `pdfUtils.ts` - Matching Fuzzy Melhorado

**Localização:** Função `findNameInPage` (linha 201)

```typescript
export function findNameInPage(pageText: string, targetName: string): boolean {
  // Normalização robusta
  const normalize = (s: string) => s
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z\s]/g, '') // Remove tudo exceto letras e espaços
    .replace(/\s+/g, ' ')
    .trim();

  const normalizedTarget = normalize(targetName);
  const normalizedPage = normalize(pageText);
  
  // 1. Match exato
  if (normalizedPage.includes(normalizedTarget)) {
    return true;
  }
  
  // 2. Match por primeiro + último nome
  const nameParts = normalizedTarget.split(' ').filter(p => p.length > 2);
  if (nameParts.length >= 2) {
    const firstName = nameParts[0];
    const lastName = nameParts[nameParts.length - 1];
    
    if (normalizedPage.includes(firstName) && normalizedPage.includes(lastName)) {
      // Verificar proximidade (nome + sobrenome devem estar próximos)
      const firstIdx = normalizedPage.indexOf(firstName);
      const lastIdx = normalizedPage.indexOf(lastName);
      if (Math.abs(firstIdx - lastIdx) < 100) {
        return true;
      }
    }
  }
  
  // 3. Match com tolerância a erro de 1 caractere (OCR incorreto)
  // Comparar palavra por palavra permitindo 1 erro por palavra
  const targetWords = normalizedTarget.split(' ');
  const pageWords = normalizedPage.split(' ');
  
  let matchedWords = 0;
  for (const targetWord of targetWords) {
    if (targetWord.length < 3) continue;
    for (const pageWord of pageWords) {
      if (pageWord.length < 3) continue;
      // Match exato ou diferença de 1 caractere
      if (pageWord === targetWord || 
          (Math.abs(pageWord.length - targetWord.length) <= 1 && 
           levenshteinDistance(pageWord, targetWord) <= 1)) {
        matchedWords++;
        break;
      }
    }
  }
  
  // Se 80% das palavras do nome foram encontradas, considerar match
  const requiredMatches = Math.ceil(targetWords.length * 0.8);
  if (matchedWords >= requiredMatches && matchedWords >= 2) {
    return true;
  }
  
  return false;
}

// Função auxiliar para calcular distância de Levenshtein
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
  
  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
  
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + indicator
      );
    }
  }
  
  return matrix[b.length][a.length];
}
```

### `pdfUtils.ts` - Regex Adicional

**Localização:** Array `namePatterns` (linha 120)

Adicionar novos padrões:

```typescript
// Adicionar antes do padrão genérico (padrão 6):

// Padrão para "FAVORECIDO" em comprovantes bancários
/FAVORECIDO\s*:?\s*([A-Z][A-Z\s]{5,40}?)(?=\s*(?:CPF|CNPJ|AG|AGENCIA|CONTA|\d{3}))/,

// Padrão para nomes completos em maiúscula (2-5 palavras, 8-50 chars)
/\b([A-Z]{3,15}(?:\s+[A-Z]{2,15}){1,4})\b/,
```

---

## Resumo das Correções

| Problema | Correção |
|----------|----------|
| Loop infinito no OCR | Simplificar condição de término: `if (renderingComplete && canvasQueue.length === 0) break;` |
| 319/344 nomes extraídos | Adicionar padrões regex mais abrangentes |
| 24/70 correspondências | Implementar matching fuzzy com tolerância a erros de OCR |

---

## Resultado Esperado

- **Loop OCR:** Termina corretamente após processar todas as páginas
- **Extração:** Capturar ~95% dos nomes (330+ de 344)
- **Matching:** Encontrar ~90% das correspondências (63+ de 70)
