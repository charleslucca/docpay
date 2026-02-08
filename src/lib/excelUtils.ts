import * as XLSX from "xlsx";

export interface EmployeeRecord {
  empresa: string;
  cidade: string;
  contrato: string;
  colaborador: string;
}

export interface SpreadsheetData {
  records: EmployeeRecord[];
  empresas: string[];
  cidades: string[];
  funcionariosPorCidade: Record<string, number>;
  fileName: string;
}

/**
 * Normalize a string for comparison: remove accents, convert to uppercase, trim
 */
export function normalizeForComparison(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Parse the "Todos" sheet with tabular structure (EMPRESA, CIDADE, COLABORADOR columns)
 */
function parseTodosSheet(workbook: XLSX.WorkBook, sheetName: string, fileName: string): SpreadsheetData {
  const sheet = workbook.Sheets[sheetName];
  const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

  // Find header row (look for EMPRESA, CIDADE, COLABORADOR)
  let headerRowIndex = -1;
  let empresaCol = -1;
  let cidadeCol = -1;
  let contratoCol = -1;
  let colaboradorCol = -1;

  for (let i = 0; i < Math.min(10, jsonData.length); i++) {
    const row = jsonData[i] as unknown[];
    if (!row) continue;

    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j] || "")
        .toUpperCase()
        .trim();
      if (cell === "EMPRESA") empresaCol = j;
      if (cell === "CIDADE") cidadeCol = j;
      if (cell === "CONTRATO") contratoCol = j;
      if (cell === "COLABORADOR") colaboradorCol = j;
    }

    if (empresaCol >= 0 && cidadeCol >= 0 && colaboradorCol >= 0) {
      headerRowIndex = i;
      break;
    }
  }

  // If required columns not found, return empty result
  if (headerRowIndex < 0 || colaboradorCol < 0) {
    return {
      records: [],
      empresas: [],
      cidades: [],
      funcionariosPorCidade: {},
      fileName,
    };
  }

  const records: EmployeeRecord[] = [];
  const empresasSet = new Set<string>();
  const cidadesSet = new Set<string>();

  // Parse data rows
  for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
    const row = jsonData[i] as unknown[];
    if (!row) continue;

    const colaborador = String(row[colaboradorCol] || "").trim();
    if (!colaborador) continue;

    const empresa = String(row[empresaCol] || "").trim();
    const cidade = String(row[cidadeCol] || "").trim();
    const contrato = contratoCol >= 0 ? String(row[contratoCol] || "").trim() : "";

    records.push({
      empresa,
      cidade,
      contrato,
      colaborador,
    });

    if (empresa) empresasSet.add(empresa);
    if (cidade) cidadesSet.add(cidade);
  }

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

/**
 * Parse municipality sheets (one sheet per city)
 * Structure: Row 1 = Company name, Row 2 = City + Bank, Row 3+ = Employee names
 */
function parseMunicipalitySheets(workbook: XLSX.WorkBook, fileName: string): SpreadsheetData {
  const records: EmployeeRecord[] = [];
  const empresasSet = new Set<string>();
  const cidadesSet = new Set<string>();

  // Headers that should be skipped (not valid cities or employee names)
  const skipHeaders = ["NOME", "FUNCIONARIO", "COLABORADOR", "MATRICULA", "CODIGO", "EMPRESA", "CIDADE"];

  for (const sheetName of workbook.SheetNames) {
    // Skip "Todos" sheet
    if (normalizeForComparison(sheetName) === "TODOS") continue;

    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

    if (jsonData.length < 3) continue;

    // Detect offset: skip "colunas1" or similar header rows
    let offset = 0;
    const firstRow = jsonData[0] as unknown[];
    const firstCellValue = String(firstRow?.[0] || "").trim().toUpperCase();
    
    // Check if first cell is "colunas*", empty, or single letter
    if (/^COLUNA[S]?\d*$/i.test(firstCellValue) || 
        /^COLUMN[S]?\d*$/i.test(firstCellValue) ||
        firstCellValue === "" ||
        /^[A-Z]$/i.test(firstCellValue)) {
      
      // Verify next row looks like a company name (not empty, not header)
      const secondRow = jsonData[1] as unknown[];
      const secondCellValue = String(secondRow?.[0] || "").trim();
      
      if (secondCellValue && secondCellValue.length >= 2 && !/^COLUNA/i.test(secondCellValue)) {
        offset = 1;
        console.log(`[Excel] Sheet "${sheetName}": detected header offset, skipping row with "${firstCellValue}"`);
      }
    }

    // Ensure enough rows after offset
    if (jsonData.length < (3 + offset)) continue;

    // Use offset to get company and city
    const empresaRow = jsonData[offset] as unknown[];
    const cidadeRow = jsonData[offset + 1] as unknown[];

    const empresaRaw = String(empresaRow?.[0] || "").trim();
    const cidadeRaw = String(cidadeRow?.[0] || "").trim();

    // Extract municipality (before first hyphen)
    const cidade = cidadeRaw.split(/\s*-\s*/)[0]?.trim() || "";
    const empresa = empresaRaw;

    // Validate: city must exist, company can have numbers/hyphens
    if (!empresa || !cidade) continue;
    if (empresa.length < 2) continue;
    
    // Skip if "cidade" is actually a header word (e.g., "NOME")
    if (skipHeaders.includes(cidade.toUpperCase())) continue;

    empresasSet.add(empresa);
    cidadesSet.add(cidade);

    // Employees start after company + city + offset
    let startIndex = offset + 2;
    
    // Skip table header row if present (e.g., "NOME", "FUNCIONARIO")
    const firstDataRow = jsonData[startIndex] as unknown[];
    const firstDataValue = normalizeForComparison(String(firstDataRow?.[0] || ""));
    if (skipHeaders.includes(firstDataValue)) {
      startIndex++;
    }

    for (let i = startIndex; i < jsonData.length; i++) {
      const row = jsonData[i] as unknown[];
      if (!row) continue;

      const colaborador = String(row[0] || "").trim();

      // Validation filters
      if (!colaborador) continue;
      
      // Skip headers
      const normColaborador = normalizeForComparison(colaborador);
      if (skipHeaders.includes(normColaborador)) continue;
      
      // Skip summary/total rows
      if (/^TOTAL/i.test(colaborador)) continue;
      if (/^SUBTOTAL/i.test(colaborador)) continue;
      if (/^SOMA/i.test(colaborador)) continue;
      if (/^COLUNA/i.test(colaborador)) continue;
      
      // Skip currency values
      if (/^R\$\s*[\d.,]/i.test(colaborador)) continue;
      
      // Clean name: remove trailing codes/numbers
      const nomeLimpo = colaborador
        .replace(/\s*-?\s*\d+\s*$/, '') // Remove " - 123" or " 123" from end
        .replace(/\s+/g, ' ')
        .trim();
      
      if (!nomeLimpo) continue;
      
      // Minimum 3 characters (allows short names like "ANA")
      if (nomeLimpo.length < 3) continue;

      // At least 1 word with 2+ characters (relaxed from requiring 2 words)
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

/**
 * Parse an Excel file and extract employee records
 * Strategy: First try "Todos" tab, fallback to individual municipality sheets
 */
export async function parseExcelFile(file: File): Promise<SpreadsheetData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });

        if (workbook.SheetNames.length === 0) {
          throw new Error("Nenhuma aba encontrada na planilha");
        }

        // 1. Prefer municipality sheets (row 1 company, row 2 city)
        const result = parseMunicipalitySheets(workbook, file.name);

        if (result.records.length === 0) {
          // 2. Fallback: try "Todos" sheet (tabular structure)
          const todosSheet = workbook.SheetNames.find((name) => normalizeForComparison(name) === "TODOS");

          if (todosSheet) {
            const todosResult = parseTodosSheet(workbook, todosSheet, file.name);
            if (todosResult.records.length > 0) {
              console.log(`[Excel] Using "Todos" sheet with ${todosResult.records.length} records`);
              resolve(todosResult);
              return;
            }
          }

          throw new Error("Nenhum funcionário encontrado na planilha");
        }

        resolve(result);
      } catch (error) {
        console.error("[Excel] Parse error:", error);
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(new Error("Erro ao ler arquivo Excel"));
    };

    reader.readAsArrayBuffer(file);
  });
}

/**
 * Find an employee record in the spreadsheet by name
 * Uses flexible matching: exact, partial (first+last name), and similarity
 */
export function findEmployeeInSpreadsheet(name: string, records: EmployeeRecord[]): EmployeeRecord | null {
  if (!name || records.length === 0) return null;

  const normalizedName = normalizeForComparison(name);
  const nameWords = normalizedName.split(" ").filter((w) => w.length >= 2);

  if (nameWords.length === 0) return null;

  // 1. Exact match
  const exact = records.find((r) => normalizeForComparison(r.colaborador) === normalizedName);
  if (exact) return exact;

  // 2. First and last name match
  const firstName = nameWords[0];
  const lastName = nameWords[nameWords.length - 1];

  const firstLastMatch = records.find((r) => {
    const rNorm = normalizeForComparison(r.colaborador);
    const rWords = rNorm.split(" ").filter((w) => w.length >= 2);
    if (rWords.length < 2) return false;

    const rFirst = rWords[0];
    const rLast = rWords[rWords.length - 1];

    return rFirst === firstName && rLast === lastName;
  });
  if (firstLastMatch) return firstLastMatch;

  // 3. High word overlap (60%+ of words match)
  const overlapMatch = records.find((r) => {
    const rNorm = normalizeForComparison(r.colaborador);
    const rWords = rNorm.split(" ").filter((w) => w.length >= 2);

    const sharedWords = nameWords.filter((w) => rWords.includes(w));
    const minWords = Math.min(nameWords.length, rWords.length);

    return sharedWords.length >= 2 && sharedWords.length >= Math.ceil(minWords * 0.6);
  });
  if (overlapMatch) return overlapMatch;

  // 4. First name + partial last name (handles abbreviations)
  const partialMatch = records.find((r) => {
    const rNorm = normalizeForComparison(r.colaborador);
    const rWords = rNorm.split(" ").filter((w) => w.length >= 2);
    if (rWords.length === 0) return false;

    const rFirst = rWords[0];
    const rLast = rWords[rWords.length - 1];

    // First name must match
    if (rFirst !== firstName) return false;

    // Last name should start with same 3 chars
    if (lastName.length >= 3 && rLast.length >= 3) {
      return rLast.substring(0, 3) === lastName.substring(0, 3);
    }

    return false;
  });

  return partialMatch || null;
}

/**
 * Enrich a list of names with company and city info from spreadsheet
 */
export function enrichNamesWithSpreadsheet(
  names: string[],
  records: EmployeeRecord[],
): Map<string, { empresa: string; cidade: string } | null> {
  const result = new Map<string, { empresa: string; cidade: string } | null>();

  for (const name of names) {
    const match = findEmployeeInSpreadsheet(name, records);
    if (match) {
      result.set(name, { empresa: match.empresa, cidade: match.cidade });
    } else {
      result.set(name, null);
    }
  }

  return result;
}
