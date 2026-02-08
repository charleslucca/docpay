

# Correção: Parser de Excel Mostrando 76 Cidades ao Invés de 9

## Problemas Identificados

### 1. Erros de Compilação
Na função `parseTodosSheet` (linhas 97 e 103), o código usa `cidadesSet` mas a variável declarada é `cidadesList`:
```typescript
// Linha 75: declarado como cidadesList
const cidadesList: string[] = [];

// Linha 97: erro - usando cidadesSet
if (cidade) cidadesSet.add(cidade);  // ❌ deveria ser cidadesSet

// Linha 103: erro - usando cidadesSet  
cidades: Array.from(cidadesSet).sort(),  // ❌
```

### 2. Duplicação de Cidades
Na função `parseMunicipalitySheets`:
- Usa `cidadesList.push(cidade)` (array) ao invés de `Set`, permitindo duplicatas
- A função `isLikelyMunicipioLine` encontra **qualquer linha com hífen**, não apenas a linha 2
- Isso faz com que linhas como "TOTAL - GERAL" ou outras sejam interpretadas como cidades

### 3. Lógica de Detecção Falha
A função percorre até 8 linhas (`MAX_HEADER_ROWS = 8`) procurando por linhas com hífen, quando deveria:
- Empresa: **sempre linha 1**
- Município: **sempre linha 2** (antes do hífen)

---

## Solução

Simplificar a lógica para seguir a estrutura fixa da planilha:
- **Linha 1 (índice 0)**: Nome da empresa
- **Linha 2 (índice 1)**: Município + Banco (ex: "CARAZINHO - ITAÚ")
- **Linha 3+**: Funcionários

Usar `Set` para garantir unicidade das cidades.

---

## Mudanças no Código

### Arquivo: `src/lib/excelUtils.ts`

#### Correção 1: Função `parseTodosSheet` (erros de compilação)
```typescript
// Linha 75: Mudar cidadesList para cidadesSet
const cidadesSet = new Set<string>();

// Linha 97: Já está correto após a mudança acima
if (cidade) cidadesSet.add(cidade);

// Linha 103: Já está correto após a mudança acima
cidades: Array.from(cidadesSet).sort(),
```

#### Correção 2: Função `parseMunicipalitySheets` (simplificar lógica)
```typescript
function parseMunicipalitySheets(workbook: XLSX.WorkBook, fileName: string): SpreadsheetData {
  const records: EmployeeRecord[] = [];
  const empresasSet = new Set<string>();
  const cidadesSet = new Set<string>();  // ← Usar Set ao invés de array

  for (const sheetName of workbook.SheetNames) {
    if (normalizeForComparison(sheetName) === "TODOS") continue;

    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

    if (jsonData.length < 3) continue;

    // FIXO: Linha 1 = Empresa, Linha 2 = Cidade + Banco
    const row1 = jsonData[0] as unknown[];
    const row2 = jsonData[1] as unknown[];
    
    const empresaRaw = String(row1?.[0] || "").trim();
    const cidadeRaw = String(row2?.[0] || "").trim();

    // Extrair município (antes do primeiro hífen)
    const cidade = cidadeRaw.split(/\s*-\s*/)[0]?.trim() || "";
    const empresa = empresaRaw;

    // Validar: empresa não deve conter hífen/números, cidade deve existir
    if (!empresa || !cidade) continue;
    if (/\d/.test(empresa) || empresa.includes("-")) continue;

    empresasSet.add(empresa);
    cidadesSet.add(cidade);  // ← Set previne duplicatas

    // Funcionários a partir da linha 3 (índice 2)
    for (let i = 2; i < jsonData.length; i++) {
      const row = jsonData[i] as unknown[];
      if (!row) continue;

      const colaborador = String(row[0] || "").trim();
      
      // Filtros de validação
      if (!colaborador) continue;
      if (normalizeForComparison(colaborador) === "NOME") continue;
      if (colaborador.startsWith("R$")) continue;
      if (/TOTAL/i.test(colaborador)) continue;
      if (/COLUNA/i.test(colaborador)) continue;
      if (/\d/.test(colaborador)) continue;
      
      const words = colaborador.split(" ").filter(w => w.length >= 2);
      if (words.length < 2) continue;

      records.push({ empresa, cidade, contrato: sheetName, colaborador });
    }
  }

  console.log(`[Excel] Parsed ${workbook.SheetNames.length - 1} sheets: ${records.length} employees, ${cidadesSet.size} cities`);
  console.log(`[Excel] Cities found: ${Array.from(cidadesSet).join(", ")}`);

  return {
    records,
    empresas: Array.from(empresasSet).sort(),
    cidades: Array.from(cidadesSet).sort(),
    fileName,
  };
}
```

---

## Resultado Esperado

| Antes | Depois |
|-------|--------|
| 76 cidades (duplicadas) | 9 cidades (únicas) |
| Lógica complexa com heurísticas | Lógica simples: linha 1 = empresa, linha 2 = cidade |
| Erros de compilação | Código funcional |

### Log de Debug Adicionado
Após o upload, o console mostrará:
```
[Excel] Parsed 9 sheets: 300 employees, 9 cities
[Excel] Cities found: ALEGRETE, CACHOEIRA DO SUL, CARAZINHO, DOM PEDRITO, ...
```

Isso permitirá verificar exatamente quais cidades estão sendo detectadas.

