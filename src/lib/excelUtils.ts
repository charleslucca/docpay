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
 * Detect if a line looks like a city (contains " - ITAU", " - SICREDI", " - PREFEITURA", etc.)
 */
function looksLikeCity(value: string): boolean {
  const cityPatterns = [
    /\s*-\s*ITAU/i,
    /\s*-\s*SICREDI/i,
    /\s*-\s*PREFEITURA/i,
    /\s*-\s*BRADESCO/i,
    /\s*-\s*CAIXA/i,
    /\s*-\s*BB\b/i,
    /\s*-\s*SANTANDER/i,
    /\s*-\s*BANRISUL/i,
    /\s*-\s*LIMPEZA/i,
    /\s*-\s*PORTEIRO/i,
    /\s*-\s*COZINHA/i,
    /\s*-\s*VIGILANCIA/i,
    /\s*-\s*MANUTENCAO/i,
  ];
  return cityPatterns.some((pattern) => pattern.test(value));
}

/**
 * Detect if a line is a known company name
 */
function looksLikeCompany(value: string): boolean {
  const normalized = value.trim().toUpperCase();
  return normalized.startsWith("B SERVICE") || normalized.startsWith("SPACE") || normalized === "B SERVICE" || normalized === "SPACE";
}

/**
 * Infer company from sheet name or context
 */
function inferCompany(sheetName: string, contextHint: string = ""): string {
  const normalized = normalizeForComparison(sheetName);
  const contextNorm = normalizeForComparison(contextHint);
  
  // SPACE company sheets typically have these names
  const spacePatterns = [
    /CANOAS\s*TEC/i,
    /CAPAO\s*DO\s*CIPO/i,
    /ELDORADO/i,
    /ESTEIO/i,
    /TUPANDI/i,
    /AJURICABA/i,
    /CARLOS\s*BARBOSA/i,
    /ERECHIM/i,
  ];
  
  if (spacePatterns.some((p) => p.test(sheetName)) || contextNorm.includes("SPACE")) {
    return "SPACE";
  }
  
  // Default to B SERVICE
  return "B SERVICE";
}

/**
 * Parse municipality sheets (one sheet per city)
 * Handles multiple structure types:
 * - Type A: Row 1 = Company (B SERVICE), Row 2 = City - Bank, Row 3+ = Employees
 * - Type B: Row 1 = "Colunas1", Row 2 = Company, Row 3 = City, Row 4 = "NOME", Row 5+ = Employees
 * - Type C: Row 1 = City - Bank (no company row), Row 2+ = Employees
 * - Type D: Row 1 = "Colunas1", Row 2 = City - Bank (no company), Row 3 = "NOME", Row 4+ = Employees
 */
function parseMunicipalitySheets(workbook: XLSX.WorkBook, fileName: string): SpreadsheetData {
  const records: EmployeeRecord[] = [];
  const empresasSet = new Set<string>();
  const cidadesSet = new Set<string>();
  const sheetStats: { name: string; employees: number; cidade: string; empresa: string }[] = [];

  // Headers that should be skipped (not valid cities or employee names)
  const skipHeaders = ["NOME", "FUNCIONARIO", "COLABORADOR", "MATRICULA", "CODIGO", "EMPRESA", "CIDADE"];

  for (const sheetName of workbook.SheetNames) {
    // Skip "Todos" sheet
    if (normalizeForComparison(sheetName) === "TODOS") continue;

    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

    if (jsonData.length < 2) continue;

    // Step 1: Detect offset for "colunas1" or similar header rows
    let offset = 0;
    const firstRow = jsonData[0] as unknown[];
    const firstCellValue = String(firstRow?.[0] || "").trim().toUpperCase();
    
    if (/^COLUNA[S]?\d*$/i.test(firstCellValue) || 
        /^COLUMN[S]?\d*$/i.test(firstCellValue) ||
        firstCellValue === "" ||
        /^[A-Z]$/i.test(firstCellValue)) {
      offset = 1;
    }

    // Ensure enough rows after offset
    if (jsonData.length < (2 + offset)) continue;

    // Step 2: Read the first two meaningful rows
    const row1 = jsonData[offset] as unknown[];
    const row2 = jsonData[offset + 1] as unknown[];
    
    const value1 = String(row1?.[0] || "").trim();
    const value2 = String(row2?.[0] || "").trim();

    let empresa = "";
    let cidade = "";
    let startIndex = offset;

    // Step 3: Detect structure type
    if (looksLikeCompany(value1)) {
      // Type A/B: Row 1 is Company
      empresa = value1;
      
      if (looksLikeCity(value2) || value2.includes(" - ")) {
        // City is in row 2
        cidade = value2.split(/\s*-\s*/)[0]?.trim() || "";
        startIndex = offset + 2;
      } else if (skipHeaders.includes(normalizeForComparison(value2))) {
        // Row 2 is a header like "NOME", check row 3 for city
        const row3 = jsonData[offset + 2] as unknown[];
        const value3 = String(row3?.[0] || "").trim();
        if (looksLikeCity(value3) || value3.includes(" - ")) {
          cidade = value3.split(/\s*-\s*/)[0]?.trim() || "";
          startIndex = offset + 3;
        }
      }
    } else if (looksLikeCity(value1) || value1.includes(" - ")) {
      // Type C/D: Row 1 is City directly (no company row)
      cidade = value1.split(/\s*-\s*/)[0]?.trim() || "";
      empresa = inferCompany(sheetName, value1);
      startIndex = offset + 1;
    } else if (looksLikeCity(value2) || value2.includes(" - ")) {
      // Type D variant: Row 1 might be noise, Row 2 is City
      cidade = value2.split(/\s*-\s*/)[0]?.trim() || "";
      empresa = inferCompany(sheetName, value2);
      startIndex = offset + 2;
    } else {
      // Fallback: try to use value1 as city, infer company
      cidade = value1.split(/\s*-\s*/)[0]?.trim() || value1;
      empresa = inferCompany(sheetName, value1);
      startIndex = offset + 1;
    }

    // Validate extracted data
    if (!cidade || cidade.length < 2) continue;
    if (!empresa) empresa = inferCompany(sheetName);
    
    // Skip if "cidade" is actually a header word
    if (skipHeaders.includes(cidade.toUpperCase())) continue;

    empresasSet.add(empresa);
    cidadesSet.add(cidade);

    // Step 4: Skip table header rows if present (e.g., "NOME", "FUNCIONARIO")
    while (startIndex < jsonData.length) {
      const checkRow = jsonData[startIndex] as unknown[];
      const checkValue = normalizeForComparison(String(checkRow?.[0] || ""));
      if (skipHeaders.includes(checkValue)) {
        startIndex++;
      } else {
        break;
      }
    }

    // Step 5: Extract employees
    let sheetEmployeeCount = 0;
    
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
      
      // Skip if it looks like a city line (shouldn't be in employee list)
      if (looksLikeCity(colaborador)) continue;
      
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
      sheetEmployeeCount++;
    }
    
    sheetStats.push({ name: sheetName, employees: sheetEmployeeCount, cidade, empresa });
  }

  // Log detailed stats
  console.log(`[Excel] Parsed ${workbook.SheetNames.length - 1} sheets: ${records.length} employees, ${cidadesSet.size} cities, ${empresasSet.size} companies`);
  console.log(`[Excel] Cities found: ${Array.from(cidadesSet).join(", ")}`);
  console.log(`[Excel] Companies found: ${Array.from(empresasSet).join(", ")}`);
  
  // Log sheets with employees for debugging
  const nonEmptySheets = sheetStats.filter(s => s.employees > 0);
  console.log(`[Excel] Sheets with employees (${nonEmptySheets.length}):`);
  nonEmptySheets.forEach(s => console.log(`  - ${s.name}: ${s.employees} (${s.cidade} / ${s.empresa})`));

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
