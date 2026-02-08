
# Correção: Ignorar linha "colunas1" no topo das abas

## Problema Identificado

O parser atual assume que:
- **Linha 1 (índice 0)** = Nome da Empresa
- **Linha 2 (índice 1)** = Cidade - Banco
- **Linha 3+ (índice 2+)** = Funcionários

Porém, algumas abas têm uma linha extra no topo contendo "colunas1" (ou "Coluna1", "COLUNA1", etc.) que deve ser ignorada. Quando isso acontece:
- O parser interpreta "colunas1" como o nome da empresa
- A validação falha (empresa muito curta ou inválida)
- Todos os funcionários dessa aba são ignorados

**Resultado**: 931 funcionários detectados ao invés de 1004 (faltando ~73).

---

## Solução

Adicionar detecção dinâmica do "offset" de linhas no início de cada aba:

1. Verificar se a linha 1 contém "colunas1" (ou variações)
2. Se sim, usar offset de 1 linha:
   - Linha 2 = Empresa
   - Linha 3 = Cidade
   - Linha 4+ = Funcionários
3. Se não, manter o comportamento atual (offset 0)

---

## Mudanças em `src/lib/excelUtils.ts`

### Função `parseMunicipalitySheets()` - linhas 121-214

Adicionar lógica de detecção de offset antes de extrair empresa/cidade:

```typescript
function parseMunicipalitySheets(workbook: XLSX.WorkBook, fileName: string): SpreadsheetData {
  const records: EmployeeRecord[] = [];
  const empresasSet = new Set<string>();
  const cidadesSet = new Set<string>();

  for (const sheetName of workbook.SheetNames) {
    if (normalizeForComparison(sheetName) === "TODOS") continue;

    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

    if (jsonData.length < 3) continue;

    // NOVO: Detectar offset se linha 1 contém "colunas1" ou similar
    let offset = 0;
    const firstRow = jsonData[0] as unknown[];
    const firstCellValue = String(firstRow?.[0] || "").trim().toUpperCase();
    
    // Verificar se primeira célula é "colunas*" ou similar
    if (/^COLUNA[S]?\d*$/i.test(firstCellValue) || 
        /^COLUMN[S]?\d*$/i.test(firstCellValue) ||
        firstCellValue === "" ||
        /^[A-Z]$/i.test(firstCellValue)) { // Letra solta como "A", "B"
      
      // Verificar se a próxima linha parece ser a empresa (não vazia, não numérica)
      const secondRow = jsonData[1] as unknown[];
      const secondCellValue = String(secondRow?.[0] || "").trim();
      
      if (secondCellValue && secondCellValue.length >= 2 && !/^COLUNA/i.test(secondCellValue)) {
        offset = 1;
      }
    }

    // Garantir que temos linhas suficientes após o offset
    if (jsonData.length < (3 + offset)) continue;

    // Usar offset para pegar empresa e cidade
    const empresaRow = jsonData[offset] as unknown[];
    const cidadeRow = jsonData[offset + 1] as unknown[];

    const empresaRaw = String(empresaRow?.[0] || "").trim();
    const cidadeRaw = String(cidadeRow?.[0] || "").trim();

    const cidade = cidadeRaw.split(/\s*-\s*/)[0]?.trim() || "";
    const empresa = empresaRaw;

    if (!empresa || !cidade) continue;
    if (empresa.length < 2) continue;

    empresasSet.add(empresa);
    cidadesSet.add(cidade);

    // Funcionários começam após empresa + cidade + offset
    const startIndex = offset + 2;
    
    for (let i = startIndex; i < jsonData.length; i++) {
      // ... resto da lógica de parsing de funcionários (sem alteração)
    }
  }
  
  // Log com informação de offset para debug
  console.log(`[Excel] Parsed ${workbook.SheetNames.length - 1} sheets: ${records.length} employees, ${cidadesSet.size} cities`);
  
  // ... resto igual
}
```

---

## Padrões Detectados para Offset

A linha será considerada "cabeçalho extra" e ignorada se:

| Padrão | Exemplo | Ação |
|--------|---------|------|
| `COLUNA` + número | "colunas1", "Coluna1", "COLUNA2" | Offset +1 |
| `COLUMN` + número | "Column1", "COLUMNS1" | Offset +1 |
| Célula vazia | "" | Offset +1 (se próxima linha parece empresa) |
| Letra solta | "A", "B", "C" | Offset +1 |

---

## Verificação de Segurança

Para evitar falsos positivos, após detectar potencial offset:
1. Verificar se a linha seguinte (potencial empresa) não está vazia
2. Verificar se a linha seguinte tem pelo menos 2 caracteres
3. Verificar se a linha seguinte não é outro padrão de cabeçalho

---

## Arquivo a Modificar

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/excelUtils.ts` | Adicionar lógica de offset dinâmico na função `parseMunicipalitySheets()` |

---

## Resultado Esperado

- Antes: 931 funcionários (abas com "colunas1" ignoradas)
- Depois: 1004 funcionários (todas as abas processadas corretamente)
- Log mostrará detecção de offset quando aplicável
