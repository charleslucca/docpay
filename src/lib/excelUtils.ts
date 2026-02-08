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
      fileName,
    };
  }

  const records: EmployeeRecord[] = [];
  const empresasSet = new Set<string>();
  const cidadesList: string[] = [];

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

  return {
    records,
    empresas: Array.from(empresasSet).sort(),
    cidades: Array.from(cidadesSet).sort(),
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
  const cidadesList: string[] = [];
  const MAX_HEADER_ROWS = 8;

  const getFirstCellText = (row: unknown[] | undefined): string => {
    if (!row) return "";
    for (const cell of row) {
      const value = String(cell ?? "").trim();
      if (value) return value;
    }
    return "";
  };

  const extractMunicipio = (raw: string): string => {
    if (!raw) return "";
    // Use the text before the first hyphen (supports " - " or "-")
    const parts = raw.split(/\s*-\s*/);
    return parts[0]?.trim() ?? "";
  };

  const isLikelyCompany = (text: string): boolean => {
    if (!text) return false;
    const norm = normalizeForComparison(text);
    if (!norm) return false;
    if (norm.includes("COLUNA") || norm.includes("TOTAL")) return false;
    if (/\d/.test(text)) return false;
    if (text.includes("-")) return false;
    return true;
  };

  const isLikelyMunicipioLine = (text: string): boolean => {
    if (!text) return false;
    const norm = normalizeForComparison(text);
    if (!text.includes("-")) return false;
    if (norm.includes("TOTAL")) return false;
    return true;
  };

  for (const sheetName of workbook.SheetNames) {
    // Skip "Todos" sheet
    if (normalizeForComparison(sheetName) === "TODOS") continue;

    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

    if (jsonData.length < 3) continue;

    let empresa = "";
    let cidade = "";
    let municipioRowIndex = -1;

    for (let i = 0; i < Math.min(MAX_HEADER_ROWS, jsonData.length); i++) {
      const rowText = getFirstCellText(jsonData[i] as unknown[]);
      if (!rowText) continue;
      if (!empresa && isLikelyCompany(rowText)) {
        empresa = rowText;
      }
      if (!cidade && isLikelyMunicipioLine(rowText)) {
        cidade = extractMunicipio(rowText);
        municipioRowIndex = i;
      }
    }

    if (!cidade && sheetName.includes("-")) {
      cidade = extractMunicipio(sheetName);
    }

    if (!empresa || !cidade) continue;

    empresasSet.add(empresa);
    cidadesList.push(cidade);

    // Row after municipality line: Employee names (skip header row "NOME")
    const startRow = municipioRowIndex >= 0 ? municipioRowIndex + 1 : 2;
    for (let i = startRow; i < jsonData.length; i++) {
      const row = jsonData[i] as unknown[];
      if (!row) continue;

      const colaborador = String(row[0] || "").trim();

      // Skip empty rows, headers and totals
      if (!colaborador) continue;
      if (normalizeForComparison(colaborador) === "NOME") continue;
      if (colaborador.startsWith("R$")) continue;
      if (colaborador.toUpperCase().includes("TOTAL")) continue;
      if (normalizeForComparison(colaborador).includes("COLUNA")) continue;

      // Check if it looks like a name (at least 2 words, no monetary values)
      const words = colaborador.split(" ").filter((w) => w.length >= 2);
      if (words.length < 2) continue;

      // Skip if contains numbers (likely a value, not a name)
      if (/\d/.test(colaborador)) continue;

      records.push({
        empresa,
        cidade,
        contrato: sheetName, // Use sheet name as contract
        colaborador,
      });
    }
  }

  console.log(`[Excel] Parsed ${workbook.SheetNames.length - 1} municipality sheets with ${records.length} employees`);

  return {
    records,
    empresas: Array.from(empresasSet).sort(),
    cidades: cidadesList,
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
