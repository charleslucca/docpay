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
  const knownCompanies = ["B SERVICE", "SPACE", "FORTCLEAN", "INTERCLEAN"];
  return knownCompanies.some(c => normalized.startsWith(c) || normalized === c);
}

/**
 * Extract city from a municipality line in format:
 * "[CITY] - [FUNCTION] - [BANK]" or "[PREFIX] - [CITY] - [BANK]"
 * 
 * Examples:
 * - "GRAMADO - PORTEIROS - ITAÚ" → "GRAMADO" (city in 1st position)
 * - "IPAM - CAXIAS DO SUL - ITAÚ" → "CAXIAS DO SUL" (city in 2nd position, IPAM is prefix)
 */
function extractCityFromLine(line: string): string {
  const parts = line.split(/\s*-\s*/);
  
  if (parts.length < 2) {
    return parts[0]?.trim() || "";
  }
  
  const firstPart = normalizeForComparison(parts[0] || "");
  const secondPart = parts[1]?.trim() || "";
  
  // Known prefixes (NOT cities) - when first part matches, city is in second part
  const knownPrefixes = [
    "IPAM",
    "IFRS",
    "SESI",
    "MIN AGRIC",
    "MINISTERIO",
    "FARMACIA",
    "METROPOLITANA",
    "SS CAI",
  ];
  
  // If first part is a known prefix, city is in second part
  if (knownPrefixes.some(prefix => firstPart.startsWith(prefix) || firstPart === prefix)) {
    return secondPart;
  }
  
  // Known functions/roles - when second part matches, city is in first part
  const knownFunctions = [
    "PORTEIRO",
    "LIMPEZA",
    "COZINHA",
    "VIGILANCIA",
    "MANUTENCAO",
    "CAMARA",
    "PACO",
    "OBRAS",
    "RECEPCAO",
    "ASSISTENCIA",
    "ZELADOR",
  ];
  
  // If second part is a function, city is in first part
  const secondNorm = normalizeForComparison(secondPart);
  if (knownFunctions.some(func => secondNorm.startsWith(func) || secondNorm.includes(func))) {
    return parts[0]?.trim() || "";
  }
  
  // Known banks (appear in last position)
  const knownBanks = ["ITAU", "SICREDI", "BRADESCO", "CAIXA", "BB", "SANTANDER", "BANRISUL", "PREFEITURA"];
  
  // If second part is a bank, city is in first part
  if (knownBanks.some(bank => secondNorm.includes(bank))) {
    return parts[0]?.trim() || "";
  }
  
  // Default: first part is the city
  return parts[0]?.trim() || "";
}

/**
 * Infer company from sheet name or context
 */
function inferCompany(sheetName: string, contextHint: string = ""): string {
  const combined = `${sheetName} ${contextHint}`.toUpperCase();
  
  // Check for known companies in order of specificity
  if (/FORTCLEAN/i.test(combined)) return "FORTCLEAN";
  if (/INTERCLEAN/i.test(combined)) return "INTERCLEAN";
  if (/SPACE/i.test(combined)) return "SPACE";
  if (/B\s*SERVICE/i.test(combined)) return "B SERVICE";
  
  // SPACE company sheets typically have these patterns
  const spacePatterns = [
    /CANOAS\s*TEC/i,
    /CAPAO\s*DO\s*CIPO/i,
    /ELDORADO/i,
    /ESTEIO/i,
    /TUPANDI/i,
    /AJURICABA/i,
    /CARLOS\s*BARBOSA/i,
    /ERECHIM/i,
    /PANAMBI/i,
    /PASSO\s*FUNDO/i,
  ];
  
  if (spacePatterns.some((p) => p.test(sheetName))) {
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

  const skipHeaders = ["NOME", "FUNCIONARIO", "COLABORADOR", "MATRICULA", "CODIGO", "EMPRESA", "CIDADE", "B SERVICE", "SPACE", "FORTCLEAN", "INTERCLEAN", "SALARIO", "SALÁRIO"];

  const isNumeric = (value: unknown): boolean => {
    if (typeof value === "number") return true;
    const str = String(value ?? "").trim().replace(/\./g, "").replace(",", ".");
    if (!str) return false;
    return !Number.isNaN(Number(str));
  };

  const cleanEmployeeName = (name: string): string => {
    let cleaned = name.trim();
    if (/PIX/i.test(cleaned)) {
      cleaned = cleaned.replace(/\s*-\s*PIX.*$/i, "").trim();
      cleaned = cleaned.replace(/\s*PIX.*$/i, "").trim();
    }
    cleaned = cleaned.replace(/\s*\(\d{2}\)\s*\d{4,5}-?\d{4}.*$/i, "").trim();
    cleaned = cleaned.replace(/\s*-?\s*\d+\s*$/, "").trim();
    cleaned = cleaned.replace(/\s+/g, " ").trim();
    return cleaned;
  };

  const isLikelyName = (value: string): boolean => {
    if (!value) return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    const norm = normalizeForComparison(trimmed);
    if (skipHeaders.includes(norm)) return false;
    if (/^TOTAL/i.test(trimmed) || /^SUBTOTAL/i.test(trimmed) || /^SOMA/i.test(trimmed) || /^COLUNA/i.test(trimmed)) return false;
    if (/^R\$\s*[\d.,]/i.test(trimmed)) return false;
    if (looksLikeCompany(trimmed) || looksLikeCity(trimmed)) return false;
    if (!/[A-ZÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ]/i.test(trimmed)) return false;
    return true;
  };

  const getCandidateName = (row: unknown[]): string => {
    // Scan first 6 cells for any plausible name (not just the first string)
    for (let i = 0; i < 6; i++) {
      const value = row[i];
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) continue;
        if (isNumeric(trimmed)) continue;
        if (isLikelyName(trimmed)) return trimmed;
      }
    }
    return "";
  };

  for (const sheetName of workbook.SheetNames) {
    if (normalizeForComparison(sheetName) === "TODOS") continue;

    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
    if (jsonData.length < 3) continue;

    const row1 = jsonData[0] as unknown[];
    const row2 = jsonData[1] as unknown[];
    const row3 = jsonData[2] as unknown[];

    const getFirstCellText = (row: unknown[] | undefined): string => {
      if (!row) return "";
      for (const cell of row) {
        const value = String(cell ?? "").trim();
        if (value) return value;
      }
      return "";
    };

    const cellA1 = getFirstCellText(row1);
    const cellA2 = getFirstCellText(row2);
    const cellA3 = getFirstCellText(row3);

    // Rules from user:
    // - Company is ALWAYS in row 1.
    // - If row 1 has "Colunas1" (or variants), then company is in row 2 and city is in row 3.
    // - Otherwise, city is in row 2.
    const row1IsColunas = /^COLUNA[S]?\d*$/i.test(cellA1) || /^COLUMN[S]?\d*$/i.test(cellA1);

    let empresa = "";
    let cidade = "";
    let cityRowIndex = -1;
    let headerRowIndex = -1;

    if (row1IsColunas) {
      empresa = cellA2;
      cidade = extractCityFromLine(cellA3) || cellA3;
      cityRowIndex = 2;
      if (!cidade) {
        cidade = extractCityFromLine(cellA2) || cellA2;
        cityRowIndex = 1;
      }
    } else {
      empresa = cellA1;
      cidade = extractCityFromLine(cellA2) || cellA2;
      cityRowIndex = 1;
      if (!cidade) {
        cidade = extractCityFromLine(cellA3) || cellA3;
        cityRowIndex = 2;
      }
    }

    if (!empresa || !cidade) continue;
    if (skipHeaders.includes(normalizeForComparison(cidade))) continue;

    empresasSet.add(empresa);
    cidadesSet.add(cidade);

    // Find header row if present (NOME/COLABORADOR)
    for (let i = Math.max(0, cityRowIndex + 1); i < Math.min(cityRowIndex + 6, jsonData.length); i++) {
      const row = jsonData[i] as unknown[];
      const cellA = String(row?.[0] || "").trim();
      const norm = normalizeForComparison(cellA);
      if (norm.includes("NOME") || norm.includes("COLABORADOR")) {
        headerRowIndex = i;
        break;
      }
    }

    let startIndex = headerRowIndex >= 0 ? headerRowIndex + 1 : cityRowIndex + 1;

    // Skip header rows if present
    while (startIndex < jsonData.length) {
      const checkRow = jsonData[startIndex] as unknown[];
      const checkValue = normalizeForComparison(String(checkRow?.[0] || ""));
      if (skipHeaders.includes(checkValue)) {
        startIndex++;
      } else {
        break;
      }
    }

    let sheetEmployeeCount = 0;

    for (let i = startIndex; i < jsonData.length; i++) {
      const row = jsonData[i] as unknown[];
      if (!row) continue;

      const rawName = getCandidateName(row);
      if (!rawName) continue;

      if (!isLikelyName(rawName)) continue;

      const name = cleanEmployeeName(rawName);
      if (!name) continue;
      if (name.length < 3) continue;

      const words = name.split(" ").filter((w) => w.length >= 2);
      if (words.length === 0) continue;

      records.push({
        empresa,
        cidade,
        contrato: sheetName,
        colaborador: name,
      });
      sheetEmployeeCount++;
    }

    sheetStats.push({ name: sheetName, employees: sheetEmployeeCount, cidade, empresa });
  }

  console.log(`[Excel] Parsed ${workbook.SheetNames.length - 1} sheets: ${records.length} employees, ${cidadesSet.size} cities, ${empresasSet.size} companies`);

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
  const knownCompanies = ["B SERVICE", "SPACE", "FORTCLEAN", "INTERCLEAN"];
  return knownCompanies.some(c => normalized.startsWith(c) || normalized === c);
}

/**
 * Extract city from a municipality line in format:
 * "[CITY] - [FUNCTION] - [BANK]" or "[PREFIX] - [CITY] - [BANK]"
 * 
 * Examples:
 * - "GRAMADO - PORTEIROS - ITAÚ" → "GRAMADO" (city in 1st position)
 * - "IPAM - CAXIAS DO SUL - ITAÚ" → "CAXIAS DO SUL" (city in 2nd position, IPAM is prefix)
 */
function extractCityFromLine(line: string): string {
  const parts = line.split(/\s*-\s*/);
  
  if (parts.length < 2) {
    return parts[0]?.trim() || "";
  }
  
  const firstPart = normalizeForComparison(parts[0] || "");
  const secondPart = parts[1]?.trim() || "";
  
  // Known prefixes (NOT cities) - when first part matches, city is in second part
  const knownPrefixes = [
    "IPAM",
    "IFRS",
    "SESI",
    "MIN AGRIC",
    "MINISTERIO",
    "FARMACIA",
    "METROPOLITANA",
    "SS CAI",
  ];
  
  // If first part is a known prefix, city is in second part
  if (knownPrefixes.some(prefix => firstPart.startsWith(prefix) || firstPart === prefix)) {
    return secondPart;
  }
  
  // Known functions/roles - when second part matches, city is in first part
  const knownFunctions = [
    "PORTEIRO",
    "LIMPEZA",
    "COZINHA",
    "VIGILANCIA",
    "MANUTENCAO",
    "CAMARA",
    "PACO",
    "OBRAS",
    "RECEPCAO",
    "ASSISTENCIA",
    "ZELADOR",
  ];
  
  // If second part is a function, city is in first part
  const secondNorm = normalizeForComparison(secondPart);
  if (knownFunctions.some(func => secondNorm.startsWith(func) || secondNorm.includes(func))) {
    return parts[0]?.trim() || "";
  }
  
  // Known banks (appear in last position)
  const knownBanks = ["ITAU", "SICREDI", "BRADESCO", "CAIXA", "BB", "SANTANDER", "BANRISUL", "PREFEITURA"];
  
  // If second part is a bank, city is in first part
  if (knownBanks.some(bank => secondNorm.includes(bank))) {
    return parts[0]?.trim() || "";
  }
  
  // Default: first part is the city
  return parts[0]?.trim() || "";
}

/**
 * Infer company from sheet name or context
 */
function inferCompany(sheetName: string, contextHint: string = ""): string {
  const combined = `${sheetName} ${contextHint}`.toUpperCase();
  
  // Check for known companies in order of specificity
  if (/FORTCLEAN/i.test(combined)) return "FORTCLEAN";
  if (/INTERCLEAN/i.test(combined)) return "INTERCLEAN";
  if (/SPACE/i.test(combined)) return "SPACE";
  if (/B\s*SERVICE/i.test(combined)) return "B SERVICE";
  
  // SPACE company sheets typically have these patterns
  const spacePatterns = [
    /CANOAS\s*TEC/i,
    /CAPAO\s*DO\s*CIPO/i,
    /ELDORADO/i,
    /ESTEIO/i,
    /TUPANDI/i,
    /AJURICABA/i,
    /CARLOS\s*BARBOSA/i,
    /ERECHIM/i,
    /PANAMBI/i,
    /PASSO\s*FUNDO/i,
  ];
  
  if (spacePatterns.some((p) => p.test(sheetName))) {
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

  const skipHeaders = ["NOME", "FUNCIONARIO", "COLABORADOR", "MATRICULA", "CODIGO", "EMPRESA", "CIDADE", "B SERVICE", "SPACE", "FORTCLEAN", "INTERCLEAN", "SALARIO", "SALÁRIO"];

  const isNumeric = (value: unknown): boolean => {
    if (typeof value === "number") return true;
    const str = String(value ?? "").trim().replace(/\./g, "").replace(",", ".");
    if (!str) return false;
    return !Number.isNaN(Number(str));
  };

  const cleanEmployeeName = (name: string): string => {
    let cleaned = name.trim();
    if (/PIX/i.test(cleaned)) {
      cleaned = cleaned.replace(/\s*-\s*PIX.*$/i, "").trim();
      cleaned = cleaned.replace(/\s*PIX.*$/i, "").trim();
    }
    cleaned = cleaned.replace(/\s*\(\d{2}\)\s*\d{4,5}-?\d{4}.*$/i, "").trim();
    cleaned = cleaned.replace(/\s*-?\s*\d+\s*$/, "").trim();
    cleaned = cleaned.replace(/\s+/g, " ").trim();
    return cleaned;
  };

  const isLikelyName = (value: string): boolean => {
    if (!value) return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    const norm = normalizeForComparison(trimmed);
    if (skipHeaders.includes(norm)) return false;
    if (/^TOTAL/i.test(trimmed) || /^SUBTOTAL/i.test(trimmed) || /^SOMA/i.test(trimmed) || /^COLUNA/i.test(trimmed)) return false;
    if (/^R\$\s*[\d.,]/i.test(trimmed)) return false;
    if (looksLikeCompany(trimmed) || looksLikeCity(trimmed)) return false;
    if (!/[A-ZÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ]/i.test(trimmed)) return false;
    return true;
  };

  const getCandidateName = (row: unknown[]): string => {
    // Scan first 6 cells for any plausible name (not just the first string)
    for (let i = 0; i < 6; i++) {
      const value = row[i];
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) continue;
        if (isNumeric(trimmed)) continue;
        if (isLikelyName(trimmed)) return trimmed;
      }
    }
    return "";
  };

  for (const sheetName of workbook.SheetNames) {
    if (normalizeForComparison(sheetName) === "TODOS") continue;

    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
    if (jsonData.length < 3) continue;

    const row1 = jsonData[0] as unknown[];
    const row2 = jsonData[1] as unknown[];
    const row3 = jsonData[2] as unknown[];

    const getFirstCellText = (row: unknown[] | undefined): string => {
      if (!row) return "";
      for (const cell of row) {
        const value = String(cell ?? "").trim();
        if (value) return value;
      }
      return "";
    };

    const cellA1 = getFirstCellText(row1);
    const cellA2 = getFirstCellText(row2);
    const cellA3 = getFirstCellText(row3);

    // Rules from user:
    // - Company is ALWAYS in row 1.
    // - If row 1 has "Colunas1" (or variants), then company is in row 2 and city is in row 3.
    // - Otherwise, city is in row 2.
    const row1IsColunas = /^COLUNA[S]?\d*$/i.test(cellA1) || /^COLUMN[S]?\d*$/i.test(cellA1);

    let empresa = "";
    let cidade = "";
    let cityRowIndex = -1;
    let headerRowIndex = -1;

    if (row1IsColunas) {
      empresa = cellA2;
      cidade = extractCityFromLine(cellA3) || cellA3;
      cityRowIndex = 2;
      if (!cidade) {
        cidade = extractCityFromLine(cellA2) || cellA2;
        cityRowIndex = 1;
      }
    } else {
      empresa = cellA1;
      cidade = extractCityFromLine(cellA2) || cellA2;
      cityRowIndex = 1;
      if (!cidade) {
        cidade = extractCityFromLine(cellA3) || cellA3;
        cityRowIndex = 2;
      }
    }

    if (!empresa || !cidade) continue;
    if (skipHeaders.includes(normalizeForComparison(cidade))) continue;

    empresasSet.add(empresa);
    cidadesSet.add(cidade);

    // Find header row if present (NOME/COLABORADOR)
    for (let i = Math.max(0, cityRowIndex + 1); i < Math.min(cityRowIndex + 6, jsonData.length); i++) {
      const row = jsonData[i] as unknown[];
      const cellA = String(row?.[0] || "").trim();
      const norm = normalizeForComparison(cellA);
      if (norm.includes("NOME") || norm.includes("COLABORADOR")) {
        headerRowIndex = i;
        break;
      }
    }

    let startIndex = headerRowIndex >= 0 ? headerRowIndex + 1 : cityRowIndex + 1;

    // Skip header rows if present
    while (startIndex < jsonData.length) {
      const checkRow = jsonData[startIndex] as unknown[];
      const checkValue = normalizeForComparison(String(checkRow?.[0] || ""));
      if (skipHeaders.includes(checkValue)) {
        startIndex++;
      } else {
        break;
      }
    }

    let sheetEmployeeCount = 0;

    for (let i = startIndex; i < jsonData.length; i++) {
      const row = jsonData[i] as unknown[];
      if (!row) continue;

      const rawName = getCandidateName(row);
      if (!rawName) continue;

      if (!isLikelyName(rawName)) continue;

      const name = cleanEmployeeName(rawName);
      if (!name) continue;
      if (name.length < 3) continue;

      const words = name.split(" ").filter((w) => w.length >= 2);
      if (words.length === 0) continue;

      records.push({
        empresa,
        cidade,
        contrato: sheetName,
        colaborador: name,
      });
      sheetEmployeeCount++;
    }

    sheetStats.push({ name: sheetName, employees: sheetEmployeeCount, cidade, empresa });
  }

  console.log(`[Excel] Parsed ${workbook.SheetNames.length - 1} sheets: ${records.length} employees, ${cidadesSet.size} cities, ${empresasSet.size} companies`);

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
      });
      sheetEmployeeCount++;
    }

    sheetStats.push({ name: sheetName, employees: sheetEmployeeCount, cidade, empresa });
  }

  console.log(
    `[Excel] Parsed ${workbook.SheetNames.length - 1} sheets: ${records.length} employees, ${cidadesSet.size} cities, ${empresasSet.size} companies`,
  );

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
