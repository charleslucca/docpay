
# Diagnóstico: Falha na Extração de Nomes

## Problema Identificado

A função `extractEmployeeName` está falhando porque os **padrões regex são muito restritivos** e não cobrem os formatos de texto comuns nos PDFs brasileiros de holerites e comprovantes.

### Causas Principais

1. **Padrões de labels limitados**: O código atual só reconhece `Nome`, `Funcionário`, `Empregado`, mas muitos documentos usam:
   - `Colaborador`
   - `Nome do Segurado`
   - `Trabalhador`
   - `Titular`
   - Ou simplesmente o nome aparece em posição fixa sem label

2. **Regex muito rígida para nomes**: O padrão exige que o nome comece com letra maiúscula acentuada específica, mas:
   - PDFs podem extrair texto em ordem inesperada
   - Acentos podem vir separados do caractere base
   - Espaços extras podem quebrar o match

3. **Falta de debug**: Não há log para saber **o que está sendo extraído** do PDF, impossibilitando diagnóstico

4. **Ordem de extração não preservada**: O PDF.js extrai texto item por item, mas a ordem pode não refletir a ordem visual do documento

---

## Correções a Implementar

### Correção 1: Adicionar console.log para debug (temporário)

**Arquivo:** `src/hooks/useDocumentProcessor.ts`

Adicionar log do texto extraído para identificar exatamente o que está vindo do PDF:

```text
const text = await extractFirstPageText(holerite.file);
console.log('=== TEXTO EXTRAÍDO ===');
console.log('Arquivo:', holerite.name);
console.log('Texto:', text.substring(0, 500)); // Primeiros 500 caracteres
console.log('======================');
const extractedName = extractEmployeeName(text);
```

### Correção 2: Melhorar os padrões de extração de nome

**Arquivo:** `src/lib/pdfUtils.ts`

Expandir a lista de padrões para cobrir mais formatos brasileiros:

```text
export function extractEmployeeName(text: string): string | null {
  // Normalizar texto antes de processar
  const normalizedText = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remover acentos
    .toUpperCase();

  const namePatterns = [
    // Padrões com labels explícitos (mais comum)
    /(?:NOME|FUNCIONARIO|EMPREGADO|COLABORADOR|TRABALHADOR|TITULAR|SEGURADO|BENEFICIARIO)[:\s]*([A-Z][A-Z\s]{4,50})/i,
    
    // Padrão específico de recibo de salário
    /RECIBO DE PAGAMENTO[^]*?([A-Z][A-Z\s]{5,40})(?:\s*(?:CPF|CARGO|FUNCAO|ADMISSAO))/i,
    
    // Nome seguido de CPF (padrão muito comum)
    /([A-Z][A-Z\s]{5,40})\s*(?:\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2})/,
    
    // Linha que parece ser só um nome completo (fallback)
    /^([A-Z][A-Z\s]{8,40})$/m,
  ];

  for (const pattern of namePatterns) {
    const match = normalizedText.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim().replace(/\s+/g, ' '); // Normalizar espaços
      const words = name.split(' ').filter(w => w.length > 1);
      if (words.length >= 2 && name.length >= 5 && name.length <= 60) {
        return name;
      }
    }
  }

  return null;
}
```

### Correção 3: Melhorar a extração de texto preservando ordem

**Arquivo:** `src/lib/pdfCache.ts`

O PDF.js pode retornar itens em ordem de renderização, não de leitura. Ordenar por posição Y (vertical) e X (horizontal):

```text
async function extractSinglePageText(pdf: PDFDocumentProxy, pageNum: number): Promise<string> {
  const page = await pdf.getPage(pageNum);
  const textContent = await page.getTextContent();
  
  // Ordenar itens por posição Y (topo para baixo) e X (esquerda para direita)
  const sortedItems = textContent.items
    .filter((item: any) => item.str && item.str.trim())
    .sort((a: any, b: any) => {
      // Inverter Y porque PDF usa coordenadas de baixo para cima
      const yDiff = b.transform[5] - a.transform[5];
      if (Math.abs(yDiff) > 5) return yDiff; // Linhas diferentes
      return a.transform[4] - b.transform[4]; // Mesma linha, ordenar por X
    });
  
  const text = sortedItems.map((item: any) => item.str).join(' ');
  page.cleanup();
  return text;
}
```

### Correção 4: Adicionar estratégia de fallback com CPF

**Arquivo:** `src/lib/pdfUtils.ts`

Se não encontrar nome, tentar extrair CPF como identificador alternativo:

```text
export function extractIdentifier(text: string): { name: string | null; cpf: string | null } {
  const name = extractEmployeeName(text);
  const cpf = extractCPF(text);
  
  return { name, cpf };
}
```

---

## Arquivos a Modificar

1. **`src/lib/pdfUtils.ts`** - Melhorar padrões regex e normalização
2. **`src/lib/pdfCache.ts`** - Ordenar texto por posição para preservar ordem de leitura
3. **`src/hooks/useDocumentProcessor.ts`** - Adicionar logs de debug

---

## Nova Lógica de extractEmployeeName

A função completa atualizada:

```text
export function extractEmployeeName(text: string): string | null {
  // Normalizar texto: remover acentos e converter para maiúscula
  const normalizedText = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' '); // Normalizar espaços múltiplos

  // Padrões ordenados do mais específico ao mais genérico
  const namePatterns = [
    // 1. Labels explícitos brasileiros
    /(?:NOME|FUNCIONARIO|EMPREGADO|COLABORADOR|TRABALHADOR|TITULAR|SEGURADO|BENEFICIARIO)\s*:?\s*([A-Z][A-Z\s]{4,50}?)(?=\s*(?:CPF|CARGO|FUNCAO|ADMISSAO|CNPJ|MATRICULA|\d{3}\.\d{3}|$))/,
    
    // 2. Recibo de pagamento padrão
    /RECIBO\s+DE\s+PAGAMENTO[^A-Z]*([A-Z][A-Z\s]{5,40}?)(?=\s*(?:CPF|CARGO))/,
    
    // 3. Nome imediatamente antes de CPF
    /([A-Z][A-Z\s]{5,40}?)\s*\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}/,
    
    // 4. Linha com nome completo isolado
    /^([A-Z][A-Z\s]{8,40})$/m,
  ];

  for (const pattern of namePatterns) {
    const match = normalizedText.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim().replace(/\s+/g, ' ');
      const words = name.split(' ').filter(w => w.length > 1);
      
      // Validar: pelo menos 2 palavras, tamanho razoável
      if (words.length >= 2 && name.length >= 5 && name.length <= 60) {
        // Remover palavras que claramente não são nomes
        const invalidWords = ['CNPJ', 'CPF', 'CARGO', 'FUNCAO', 'ADMISSAO', 'SALARIO'];
        const hasInvalidWord = words.some(w => invalidWords.includes(w));
        if (!hasInvalidWord) {
          return name;
        }
      }
    }
  }

  return null;
}
```

---

## Resultado Esperado

Após as correções:
- Debug mostrará exatamente o texto extraído para identificar problemas
- Padrões mais flexíveis reconhecerão mais formatos de documentos
- Ordenação por posição preservará a leitura natural do documento
- Taxa de sucesso na extração de nomes deve aumentar significativamente
