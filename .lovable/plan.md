
# Contagem Precisa de Funcionários por Tipo de Documento

## Problema Atual

A estimativa atual é baseada apenas no número de páginas:
```typescript
estimatedEmployees: pageCount > 10 ? pageCount - 1 : pageCount
```

Isso causa imprecisões porque não verifica se cada página realmente contém um funcionário.

## Solução Proposta

Implementar contagem **precisa** durante o upload, analisando o texto nativo de cada página para detectar:

| Tipo | Campo a Buscar | Regex |
|------|----------------|-------|
| **Comprovante** | "FAVORECIDO" | `/FAVORECIDO\s*:/gi` |
| **Holerite** | Nome do Funcionário | Padrões existentes em `extractEmployeeName` |

---

## Implementação

### 1. Nova função de contagem em `src/lib/pdfUtils.ts`

Criar funções para contar funcionários baseado no tipo de documento:

```typescript
/**
 * Conta páginas que contêm "FAVORECIDO" (para comprovantes)
 */
export async function countPagesWithFavorecido(
  file: File,
  cachedPdf?: PDFDocumentProxy
): Promise<number> {
  const pdf = cachedPdf || await getCachedPdf(file);
  let count = 0;
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const pageText = await extractTextFromPage(file, i, pdf);
    const normalizedText = pageText
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
    
    // Buscar por FAVORECIDO ou variações
    if (/FAVORECIDO\s*:?/.test(normalizedText)) {
      count++;
    }
  }
  
  return count;
}

/**
 * Conta páginas que contêm padrões de nome de funcionário (para holerites)
 * Usa regex simplificado que detecta labels de nome
 */
export async function countPagesWithEmployeeName(
  file: File,
  cachedPdf?: PDFDocumentProxy
): Promise<number> {
  const pdf = cachedPdf || await getCachedPdf(file);
  let count = 0;
  
  // Padrões que indicam presença de nome de funcionário
  const employeePatterns = [
    /(?:NOME|FUNCIONARIO|EMPREGADO|COLABORADOR|TRABALHADOR|TITULAR)\s*:/i,
    /RECIBO\s+DE\s+PAGAMENTO/i,
    /\b\d{3,5}\s+[A-Z][A-Z\s]{5,35}?\s+(?:COZINHEIRA|SERVENTE|AJUDANTE|AUXILIAR|\d{5,6})\b/,
  ];
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const pageText = await extractTextFromPage(file, i, pdf);
    const normalizedText = pageText
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
    
    // Verificar se algum padrão de funcionário é encontrado
    const hasEmployee = employeePatterns.some(pattern => pattern.test(normalizedText));
    if (hasEmployee) {
      count++;
    }
  }
  
  return count;
}

/**
 * Função unificada para contar funcionários por tipo
 */
export async function countEmployeesInDocument(
  file: File,
  type: 'holerite' | 'comprovante',
  cachedPdf?: PDFDocumentProxy
): Promise<number> {
  if (type === 'comprovante') {
    return countPagesWithFavorecido(file, cachedPdf);
  } else {
    return countPagesWithEmployeeName(file, cachedPdf);
  }
}
```

### 2. Atualizar `src/hooks/useDocumentProcessor.ts`

Modificar a função `addFiles` para usar a nova contagem:

```typescript
// Linha 251-270 - Substituir contagem simples por contagem precisa
const countPagePromises = newFiles.map(async (uploadedFile) => {
  try {
    const pdf = await getCachedPdf(uploadedFile.file);
    const pageCount = pdf.numPages;
    
    // Contagem precisa baseada no tipo de documento
    const employeeCount = await countEmployeesInDocument(
      uploadedFile.file,
      type,
      pdf
    );
    
    // Update with page count and precise employee count
    const setter = type === 'holerite' ? setHolerites : setComprovantes;
    setter((prev) => prev.map((f) => 
      f.id === uploadedFile.id 
        ? { ...f, pageCount, estimatedEmployees: employeeCount }
        : f
    ));
  } catch (error) {
    console.warn(`[PageCount] Error counting for ${uploadedFile.name}:`, error);
  }
});
```

### 3. Atualizar `src/components/FileDropzone.tsx`

Remover "(estimado)" do texto já que agora é contagem precisa:

```tsx
// Linha 153 - Mudar texto para indicar contagem real
{file.pageCount} {file.pageCount === 1 ? 'página' : 'páginas'} • {file.estimatedEmployees} funcionário(s)

// Linha 196 - Total também sem "(estimado)"
Total: {files.length} arquivo(s) • {totalEmployees} funcionário(s)
```

---

## Arquivos a Modificar

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/pdfUtils.ts` | Adicionar funções `countPagesWithFavorecido`, `countPagesWithEmployeeName`, `countEmployeesInDocument` |
| `src/hooks/useDocumentProcessor.ts` | Usar `countEmployeesInDocument` em vez de `pageCount` para a estimativa |
| `src/components/FileDropzone.tsx` | Remover "(estimado)" do texto de contagem |

---

## Fluxo de Execução

```text
┌─────────────────────────────────────────────────────────────────┐
│  Upload de Arquivo                                              │
├─────────────────────────────────────────────────────────────────┤
│  1. Carregar PDF (getCachedPdf)                                 │
│  2. Contar páginas (pdf.numPages)                               │
│  3. Para cada página:                                           │
│     - Extrair texto nativo (extractTextFromPage) ← RÁPIDO!      │
│     - Se comprovante: buscar "FAVORECIDO"                       │
│     - Se holerite: buscar padrões de nome                       │
│  4. Atualizar UI com contagem precisa                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Performance

A contagem usa apenas **texto nativo** do PDF (não OCR), então é muito rápida:
- ~50-100ms por página para extração de texto
- Para 70 páginas: ~3-7 segundos total
- Para 691 páginas: ~35-70 segundos total

Se for necessário ainda mais velocidade, podemos implementar amostragem (verificar cada 5ª página e multiplicar).

---

## Resultado Esperado

- **Comprovante com 70 páginas**: `70 páginas • 70 funcionário(s)` (se todas têm FAVORECIDO)
- **Holerite com 691 páginas**: `691 páginas • 690 funcionário(s)` (se 1 página é resumo)

A contagem agora reflete a realidade do documento, não uma estimativa baseada em páginas.
