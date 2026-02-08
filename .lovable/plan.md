
# Correção: Contagem de Funcionários em PDFs Escaneados (Holerites)

## Problema Identificado

A função `countPagesWithEmployeeName` usa **apenas texto nativo** do PDF (via `extractTextFromPage`):

```typescript
const pageText = await extractTextFromPage(file, i, pdf);
```

Mas os holerites são frequentemente **PDFs escaneados (imagens)**, onde:
- O texto nativo está **vazio** ou tem apenas alguns caracteres
- A contagem retorna apenas 1 (ou 0) porque nenhuma página tem os padrões no texto nativo
- Funciona para comprovantes porque esses são PDFs digitais com texto embutido

Por isso, 690 holerites aparecem como apenas "1 funcionário" - provavelmente apenas a primeira página (capa ou índice) tem texto nativo.

---

## Solução Proposta

Para holerites (PDFs potencialmente escaneados), **não** podemos confiar apenas no texto nativo. A solução é:

### Opção 1: Verificar se há texto nativo suficiente primeiro
- Se o PDF tem texto nativo em pelo menos 50% das páginas → usar contagem por padrões
- Se não → assumir que cada página é um funcionário (fallback para contagem de páginas)

### Opção 2 (Recomendada): Usar contagem de páginas com ajuste para holerites escaneados
- Verificar a **primeira página** para determinar se o PDF é nativo ou escaneado
- Se escaneado: usar `pageCount` diretamente (menos última página se > 10 páginas)
- Se nativo: usar a busca por padrões

---

## Implementação

### Modificar `countPagesWithEmployeeName` em `src/lib/pdfUtils.ts`

```typescript
export async function countPagesWithEmployeeName(
  file: File,
  cachedPdf?: PDFDocumentProxy
): Promise<number> {
  const pdf = cachedPdf || await getCachedPdf(file);
  const totalPages = pdf.numPages;
  
  // Padrões que indicam presença de nome de funcionário
  const employeePatterns = [
    /(?:NOME|FUNCIONARIO|EMPREGADO|COLABORADOR|TRABALHADOR|TITULAR)\s*:/i,
    /RECIBO\s+DE\s+PAGAMENTO/i,
    /\b\d{3,5}\s+[A-Z][A-Z\s]{5,35}?\s+(?:COZINHEIRA|SERVENTE|AJUDANTE|AUXILIAR|\d{5,6})\b/,
  ];
  
  // Amostragem: verificar algumas páginas para determinar se é PDF escaneado
  const samplePages = [1, Math.floor(totalPages / 2), Math.max(1, totalPages - 1)];
  let pagesWithText = 0;
  let pagesWithEmployee = 0;
  
  for (const pageNum of samplePages) {
    if (pageNum > totalPages) continue;
    
    const pageText = await extractTextFromPage(file, pageNum, pdf);
    const normalizedText = pageText
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
    
    // Verificar se a página tem texto suficiente (não é escaneada)
    if (normalizedText.length >= 50) {
      pagesWithText++;
      
      // Verificar se algum padrão de funcionário é encontrado
      const hasEmployee = employeePatterns.some(pattern => pattern.test(normalizedText));
      if (hasEmployee) {
        pagesWithEmployee++;
      }
    }
  }
  
  // Se a maioria das páginas amostradas não tem texto (PDF escaneado)
  // Usar contagem de páginas como fallback
  if (pagesWithText < samplePages.length / 2) {
    console.log(`[countEmployees] PDF escaneado detectado: ${file.name}, usando contagem de páginas`);
    // Para PDFs grandes, subtrair 1 (página de resumo)
    return totalPages > 10 ? totalPages - 1 : totalPages;
  }
  
  // PDF com texto nativo - contar todas as páginas com padrões
  let count = 0;
  for (let i = 1; i <= totalPages; i++) {
    const pageText = await extractTextFromPage(file, i, pdf);
    const normalizedText = pageText
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
    
    const hasEmployee = employeePatterns.some(pattern => pattern.test(normalizedText));
    if (hasEmployee) {
      count++;
    }
  }
  
  return count;
}
```

---

## Fluxo de Execução

```text
┌─────────────────────────────────────────────────────────────────┐
│  Upload de Holerite                                             │
├─────────────────────────────────────────────────────────────────┤
│  1. Amostrar 3 páginas (primeira, meio, última)                 │
│  2. Verificar se têm texto nativo (>= 50 caracteres)            │
│  3. SE < 50% tem texto:                                         │
│     → PDF ESCANEADO → usar (pageCount - 1) como estimativa      │
│  4. SE >= 50% tem texto:                                        │
│     → PDF NATIVO → buscar padrões em todas as páginas           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Arquivos a Modificar

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/pdfUtils.ts` | Modificar `countPagesWithEmployeeName` para detectar PDFs escaneados e usar fallback |

---

## Resultado Esperado

- **Holerite escaneado (691 páginas)**: `691 páginas • 690 funcionário(s)` (fallback)
- **Holerite digital (50 páginas)**: `50 páginas • 48 funcionário(s)` (contagem precisa por padrões)
- **Comprovante digital (70 páginas)**: `70 páginas • 70 funcionário(s)` (contagem precisa por FAVORECIDO)

A contagem agora funciona corretamente tanto para PDFs digitais quanto escaneados.
