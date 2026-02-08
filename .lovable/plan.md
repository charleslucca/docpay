

# Correção: Recuperar Funcionários Perdidos (748 -> 1004)

## Problemas Identificados

Analisando os logs do console, encontrei **dois problemas principais**:

### Problema 1: Cidade "NOME" detectada como cidade válida

```
[Excel] Cities found: ..., NOME
```

O log mostra "NOME" como uma das 29 cidades detectadas. Isso indica que algumas abas têm uma linha extra de cabeçalho contendo "NOME" que está sendo interpretada como cidade, fazendo com que o parser comece a ler funcionários no lugar errado.

### Problema 2: Filtro de mínimo 2 palavras muito restritivo

Na linha 211-212 do código atual:
```typescript
const words = nomeLimpo.split(" ").filter((w) => w.length >= 2);
if (words.length < 2) continue;
```

Este filtro **descarta nomes com apenas 1 palavra** (ex: "ALINE", "MARIA") ou nomes onde uma das palavras tem menos de 2 caracteres.

### Problema 3: Detecção de offset incompleta

O offset atual só verifica a **primeira célula** da linha 1. Algumas abas podem ter estruturas diferentes:
- Linha 1 vazia mas com dados em colunas B, C...
- Linha 1 com texto parcial que não é "colunas1"

---

## Solução Proposta

### Mudança 1: Melhorar detecção de linhas de cabeçalho extra

Adicionar detecção para mais padrões de cabeçalho que devem ser ignorados:

```typescript
// Padrões adicionais para detectar como cabeçalho extra (offset)
const headerPatterns = [
  /^COLUNA[S]?\d*$/i,     // colunas1, Coluna1, etc
  /^COLUMN[S]?\d*$/i,     // Column1, etc
  /^[A-Z]$/i,             // Letra solta: A, B, C
];

// Também verificar se a linha parece ser um cabeçalho de tabela
const tableHeaderPatterns = [
  "NOME",
  "FUNCIONARIO", 
  "COLABORADOR",
  "MATRICULA",
  "CODIGO"
];
```

### Mudança 2: Detectar linhas de cabeçalho de tabela entre empresa/cidade e funcionários

Algumas abas podem ter:
- Linha 1: Empresa
- Linha 2: Cidade
- Linha 3: **NOME** (cabeçalho de coluna) <- IGNORAR
- Linha 4+: Funcionários

```typescript
// Verificar se a primeira linha de "funcionários" é na verdade um cabeçalho
const firstEmployeeRow = jsonData[startIndex] as unknown[];
const firstEmployeeValue = String(firstEmployeeRow?.[0] || "").trim().toUpperCase();

if (["NOME", "FUNCIONARIO", "COLABORADOR", "MATRICULA"].includes(firstEmployeeValue)) {
  startIndex++; // Pular linha de cabeçalho
}
```

### Mudança 3: Relaxar filtro de palavras mínimas

Permitir nomes com apenas 1 palavra, desde que tenha pelo menos 3 caracteres:

```typescript
// ANTES:
const words = nomeLimpo.split(" ").filter((w) => w.length >= 2);
if (words.length < 2) continue;

// DEPOIS:
// Nome válido: pelo menos 3 caracteres total
if (nomeLimpo.length < 3) continue;

// Se tiver múltiplas palavras, pelo menos 1 deve ter 2+ chars
const words = nomeLimpo.split(" ").filter((w) => w.length >= 2);
if (words.length === 0) continue;
```

### Mudança 4: Não adicionar "NOME" como cidade

Adicionar validação extra para cidade:

```typescript
// Validar que cidade não é um cabeçalho comum
const invalidCities = ["NOME", "FUNCIONARIO", "COLABORADOR", "EMPRESA", "CIDADE"];
if (invalidCities.includes(cidade.toUpperCase())) continue;
```

---

## Código Final para `parseMunicipalitySheets()`

```typescript
function parseMunicipalitySheets(workbook: XLSX.WorkBook, fileName: string): SpreadsheetData {
  const records: EmployeeRecord[] = [];
  const empresasSet = new Set<string>();
  const cidadesSet = new Set<string>();

  // Headers that should be skipped
  const skipHeaders = ["NOME", "FUNCIONARIO", "COLABORADOR", "MATRICULA", "CODIGO"];

  for (const sheetName of workbook.SheetNames) {
    if (normalizeForComparison(sheetName) === "TODOS") continue;

    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

    if (jsonData.length < 3) continue;

    // Detect offset for "colunas1" or similar
    let offset = 0;
    const firstRow = jsonData[0] as unknown[];
    const firstCellValue = String(firstRow?.[0] || "").trim().toUpperCase();
    
    if (/^COLUNA[S]?\d*$/i.test(firstCellValue) || 
        /^COLUMN[S]?\d*$/i.test(firstCellValue) ||
        firstCellValue === "" ||
        /^[A-Z]$/i.test(firstCellValue)) {
      
      const secondRow = jsonData[1] as unknown[];
      const secondCellValue = String(secondRow?.[0] || "").trim();
      
      if (secondCellValue && secondCellValue.length >= 2 && !/^COLUNA/i.test(secondCellValue)) {
        offset = 1;
      }
    }

    if (jsonData.length < (3 + offset)) continue;

    const empresaRow = jsonData[offset] as unknown[];
    const cidadeRow = jsonData[offset + 1] as unknown[];

    const empresaRaw = String(empresaRow?.[0] || "").trim();
    const cidadeRaw = String(cidadeRow?.[0] || "").trim();

    const cidade = cidadeRaw.split(/\s*-\s*/)[0]?.trim() || "";
    const empresa = empresaRaw;

    if (!empresa || !cidade) continue;
    if (empresa.length < 2) continue;
    
    // NOVO: Skip if "cidade" is actually a header word
    if (skipHeaders.includes(cidade.toUpperCase())) continue;

    empresasSet.add(empresa);
    cidadesSet.add(cidade);

    let startIndex = offset + 2;
    
    // NOVO: Skip table header row if present (e.g., "NOME")
    const firstDataRow = jsonData[startIndex] as unknown[];
    const firstDataValue = normalizeForComparison(String(firstDataRow?.[0] || ""));
    if (skipHeaders.includes(firstDataValue)) {
      startIndex++;
    }

    for (let i = startIndex; i < jsonData.length; i++) {
      const row = jsonData[i] as unknown[];
      if (!row) continue;

      const colaborador = String(row[0] || "").trim();

      if (!colaborador) continue;
      
      const normColaborador = normalizeForComparison(colaborador);
      if (skipHeaders.includes(normColaborador)) continue;
      
      if (/^TOTAL/i.test(colaborador)) continue;
      if (/^SUBTOTAL/i.test(colaborador)) continue;
      if (/^SOMA/i.test(colaborador)) continue;
      if (/^COLUNA/i.test(colaborador)) continue;
      if (/^R\$\s*[\d.,]/i.test(colaborador)) continue;
      
      const nomeLimpo = colaborador
        .replace(/\s*-?\s*\d+\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (!nomeLimpo) continue;
      
      // NOVO: Mínimo 3 caracteres (permite nomes curtos)
      if (nomeLimpo.length < 3) continue;

      // NOVO: Pelo menos 1 palavra com 2+ caracteres
      const words = nomeLimpo.split(" ").filter((w) => w.length >= 2);
      if (words.length === 0) continue;

      records.push({
        empresa,
        cidade,
        contrato: sheetName,
        colaborador: nomeLimpo,
      });
    }
  }

  console.log(`[Excel] Parsed ${workbook.SheetNames.length - 1} sheets: ${records.length} employees, ${cidadesSet.size} cities`);
  console.log(`[Excel] Cities found: ${Array.from(cidadesSet).join(", ")}`);

  // Calculate employees per city
  const funcionariosPorCidade: Record<string, number> = {};
  for (const record of records) {
    funcionariosPorCidade[record.cidade] = (funcionariosPorCidade[record.cidade] || 0) + 1;
  }

  return {
    records,
    empresas: Array.from(empresasSet).sort(),
    cidades: Array.from(cidadesSet).sort(),
    funcionariosPorCidade,
    fileName,
  };
}
```

---

## Resumo das Mudanças

| Problema | Solução |
|----------|---------|
| "NOME" sendo detectado como cidade | Adicionar lista de palavras inválidas para cidade |
| Linha "NOME" sendo lida como funcionário | Detectar e pular linha de cabeçalho de tabela |
| Nomes de 1 palavra descartados | Relaxar filtro: mínimo 3 chars e 1 palavra válida |
| Empresas duplicadas (9 ao invés de menos) | Não é erro - offset correto revela mais abas válidas |

---

## Arquivo a Modificar

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/excelUtils.ts` | Melhorar validações e pular cabeçalhos de tabela |

---

## Resultado Esperado

- Antes: 748 funcionários, 29 cidades (incluindo "NOME")
- Depois: ~1004 funcionários, ~28 cidades (sem "NOME")
- Nomes curtos como "ALINE" serão incluídos
- Cabeçalhos de tabela serão ignorados corretamente

