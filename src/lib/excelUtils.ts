import * as XLSX from "xlsx";

export interface EmployeeRecord {
  empresa: string;
  cidade: string;
  contrato: string;
  colaborador: string;
  banco?: string;
  tipo?: string;
  totalFuncionarios?: number;
}

export interface SpreadsheetData {
  records: EmployeeRecord[];
  empresas: string[];
  cidades: string[];
  funcionariosPorCidade: Record<string, number>;
  fileName: string;
}

export interface ValidationResult {
  valid: boolean;
  missingColumns: string[];
}

const REQUIRED_COLUMNS = ["EMPRESA", "CIDADE", "CONTRATO", "COLABORADOR", "TOTAL FUNCIONARIOS", "BANCO", "TIPO"];

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
 * Validate that the Excel workbook has a "Todos" sheet with the required column structure
 */
export function validateExcelStructure(workbook: XLSX.WorkBook): ValidationResult {
  // Find "Todos" sheet
  const todosSheet = workbook.SheetNames.find(
    (name) => normalizeForComparison(name) === "TODOS"
  );

  if (!todosSheet) {
    return { valid: false, missingColumns: REQUIRED_COLUMNS };
  }

  const sheet = workbook.Sheets[todosSheet];
  const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

  // Find header row in first 10 rows
  for (let i = 0; i < Math.min(10, jsonData.length); i++) {
    const row = jsonData[i] as unknown[];
    if (!row) continue;

    const headerCells = row.map((cell) =>
      normalizeForComparison(String(cell || ""))
    );

    const missing = REQUIRED_COLUMNS.filter(
      (col) => !headerCells.some((h) => h === normalizeForComparison(col))
    );

    if (missing.length === 0) {
      return { valid: true, missingColumns: [] };
    }

    // If we found at least some columns, report what's missing
    const found = REQUIRED_COLUMNS.filter((col) =>
      headerCells.some((h) => h === normalizeForComparison(col))
    );
    if (found.length >= 3) {
      return { valid: false, missingColumns: missing };
    }
  }

  return { valid: false, missingColumns: REQUIRED_COLUMNS };
}

/**
 * Parse the "Todos" sheet with the validated tabular structure
 */
/**
 * Flexible column detection: exact → startsWith → contains, with aliases
 */
function findColumnIndex(headers: string[], possibleNames: string[]): number {
  const normalizedHeaders = headers.map(h => h ? normalizeForComparison(String(h)) : "");
  const normalizedNames = possibleNames.map(normalizeForComparison);

  // Priority 1: Exact match
  for (const name of normalizedNames) {
    const idx = normalizedHeaders.indexOf(name);
    if (idx !== -1) return idx;
  }
  // Priority 2: Starts with
  for (const name of normalizedNames) {
    const idx = normalizedHeaders.findIndex(h => h.startsWith(name));
    if (idx !== -1) return idx;
  }
  // Priority 3: Contains
  for (const name of normalizedNames) {
    const idx = normalizedHeaders.findIndex(h => h.includes(name));
    if (idx !== -1) return idx;
  }
  return -1;
}

const EMPRESA_ALIASES = ["EMPRESA", "EMPRESA CONVENIADA", "RAZAO SOCIAL", "COMPANY"];
const CIDADE_ALIASES = ["CIDADE", "MUNICIPIO", "LOCALIDADE", "CITY"];
const CONTRATO_ALIASES = ["CONTRATO", "NUMERO CONTRATO", "CONTRACT"];
const COLABORADOR_ALIASES = ["COLABORADOR", "FUNCIONARIO", "NOME", "EMPREGADO", "NOME FUNCIONARIO"];
const TOTAL_FUNC_ALIASES = ["TOTAL FUNCIONARIOS", "TOTAL FUNC", "QTD FUNCIONARIOS"];
const BANCO_ALIASES = ["BANCO", "INSTITUICAO", "BANK"];
const TIPO_ALIASES = ["TIPO", "MODALIDADE", "TYPE"];

function parseTodosSheet(workbook: XLSX.WorkBook, sheetName: string, fileName: string): SpreadsheetData {
  const sheet = workbook.Sheets[sheetName];
  const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

  let headerRowIndex = -1;
  let empresaCol = -1;
  let cidadeCol = -1;
  let contratoCol = -1;
  let colaboradorCol = -1;
  let totalFuncCol = -1;
  let bancoCol = -1;
  let tipoCol = -1;

  for (let i = 0; i < Math.min(10, jsonData.length); i++) {
    const row = jsonData[i] as unknown[];
    if (!row) continue;

    const headerStrings = row.map(cell => String(cell || ""));

    empresaCol = findColumnIndex(headerStrings, EMPRESA_ALIASES);
    cidadeCol = findColumnIndex(headerStrings, CIDADE_ALIASES);
    contratoCol = findColumnIndex(headerStrings, CONTRATO_ALIASES);
    colaboradorCol = findColumnIndex(headerStrings, COLABORADOR_ALIASES);
    totalFuncCol = findColumnIndex(headerStrings, TOTAL_FUNC_ALIASES);
    bancoCol = findColumnIndex(headerStrings, BANCO_ALIASES);
    tipoCol = findColumnIndex(headerStrings, TIPO_ALIASES);

    if (empresaCol >= 0 && cidadeCol >= 0 && colaboradorCol >= 0) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex < 0 || colaboradorCol < 0) {
    return { records: [], empresas: [], cidades: [], funcionariosPorCidade: {}, fileName };
  }

  const records: EmployeeRecord[] = [];
  const empresasSet = new Set<string>();
  const cidadesSet = new Set<string>();

  for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
    const row = jsonData[i] as unknown[];
    if (!row) continue;

    const colaborador = String(row[colaboradorCol] || "").trim();
    if (!colaborador) continue;

    const empresa = String(row[empresaCol] || "").trim();
    const cidade = String(row[cidadeCol] || "").trim();
    const contrato = contratoCol >= 0 ? String(row[contratoCol] || "").trim() : "";
    const banco = bancoCol >= 0 ? String(row[bancoCol] || "").trim() : "";
    const tipo = tipoCol >= 0 ? String(row[tipoCol] || "").trim() : "";
    const totalFunc = totalFuncCol >= 0 ? Number(row[totalFuncCol]) || undefined : undefined;

    records.push({ empresa, cidade, contrato, colaborador, banco, tipo, totalFuncionarios: totalFunc });

    if (empresa) empresasSet.add(empresa);
    if (cidade) cidadesSet.add(cidade);
  }

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
  return knownCompanies.some((c) => normalized.startsWith(c) || normalized === c);
}

/**
 * Extract city from a municipality line
 */
function extractCityFromLine(line: string): string {
  const parts = line.split(/\s*-\s*/);

  if (parts.length < 2) {
    return parts[0]?.trim() || "";
  }

  const firstPart = normalizeForComparison(parts[0] || "");
  const secondPart = parts[1]?.trim() || "";

  const knownPrefixes = ["IPAM", "IFRS", "SESI", "MIN AGRIC", "MINISTERIO", "FARMACIA", "METROPOLITANA", "SS CAI"];

  if (knownPrefixes.some((prefix) => firstPart.startsWith(prefix) || firstPart === prefix)) {
    return secondPart;
  }

  const knownFunctions = [
    "PORTEIRO", "LIMPEZA", "COZINHA", "VIGILANCIA", "MANUTENCAO",
    "CAMARA", "PACO", "OBRAS", "RECEPCAO", "ASSISTENCIA", "ZELADOR",
  ];

  const secondNorm = normalizeForComparison(secondPart);
  if (knownFunctions.some((func) => secondNorm.startsWith(func) || secondNorm.includes(func))) {
    return parts[0]?.trim() || "";
  }

  const knownBanks = ["ITAU", "SICREDI", "BRADESCO", "CAIXA", "BB", "SANTANDER", "BANRISUL", "PREFEITURA"];

  if (knownBanks.some((bank) => secondNorm.includes(bank))) {
    return parts[0]?.trim() || "";
  }

  return parts[0]?.trim() || "";
}

/**
 * Parse municipality sheets (one sheet per city)
 */
function parseMunicipalitySheets(workbook: XLSX.WorkBook, fileName: string): SpreadsheetData {
  const records: EmployeeRecord[] = [];
  const empresasSet = new Set<string>();
  const cidadesSet = new Set<string>();
  const skipValues = [
    "", "NOME", "FUNCIONARIO", "COLABORADOR", "MATRICULA", "CODIGO",
    "EMPRESA", "CIDADE", "TOTAL", "SUBTOTAL", "SOMA",
  ];

  const cleanEmployeeName = (name: string): string => {
    let cleaned = name.trim();
    if (/PIX/i.test(cleaned)) {
      cleaned = cleaned.replace(/\s*-\s*PIX.*$/i, "").trim();
      cleaned = cleaned.replace(/\s*PIX.*$/i, "").trim();
    }
    cleaned = cleaned.replace(/\s*\(\d{2}\)\s*\d{4,5}-?\d{4}.*$/i, "").trim();
    cleaned = cleaned.replace(/\s+/g, " ").trim();
    return cleaned;
  };

  for (const sheetName of workbook.SheetNames) {
    if (normalizeForComparison(sheetName) === "TODOS") continue;

    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
    if (jsonData.length < 3) continue;

    const cellA1 = String((jsonData[0] as unknown[])?.[0] || "").trim();
    const cellA2 = String((jsonData[1] as unknown[])?.[0] || "").trim();
    const cellA3 = String((jsonData[2] as unknown[])?.[0] || "").trim();

    const row1IsColunas = /^COLUNA[S]?\d*$/i.test(normalizeForComparison(cellA1));

    let empresa = "";
    let cidade = "";
    let startIndex = 3;

    if (row1IsColunas) {
      empresa = cellA2;
      cidade = extractCityFromLine(cellA3) || cellA3;
      startIndex = 4;
    } else {
      empresa = cellA1;
      cidade = extractCityFromLine(cellA2) || cellA2;
    }

    if (!empresa || !cidade) continue;

    const cidadeExtraida = extractCityFromLine(cidade) || cidade;
    if (!cidadeExtraida || cidadeExtraida.length < 2) continue;

    empresasSet.add(empresa);
    cidadesSet.add(cidadeExtraida);

    const row4 = String((jsonData[3] as unknown[])?.[0] || "").trim();
    const row4Norm = normalizeForComparison(row4);
    if (!row4 || skipValues.includes(row4Norm) || /^COLUNA/i.test(row4Norm)) {
      startIndex = Math.max(startIndex, 4);
    }

    for (let i = startIndex; i < jsonData.length; i++) {
      const row = jsonData[i] as unknown[];
      if (!row) continue;

      const rawName = String(row[0] || "").trim();
      if (!rawName) continue;
      const norm = normalizeForComparison(rawName);
      if (skipValues.includes(norm)) continue;
      if (/^TOTAL/i.test(norm) || /^SUBTOTAL/i.test(norm) || /^SOMA/i.test(norm) || /^COLUNA/i.test(norm)) continue;
      if (/^R\$\s*[\d.,]/i.test(rawName)) continue;
      if (looksLikeCity(rawName)) continue;
      if (looksLikeCompany(rawName)) continue;

      const name = cleanEmployeeName(rawName);
      if (!name) continue;
      if (name.length < 3) continue;
      const words = name.split(" ").filter((w) => w.length >= 2);
      if (words.length < 2) continue;

      records.push({
        empresa,
        cidade: cidadeExtraida,
        contrato: sheetName,
        colaborador: name,
      });
    }
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
 * Strategy: First try "Todos" tab with validated structure, fallback to individual municipality sheets
 */
export async function parseExcelFile(file: File): Promise<{ data: SpreadsheetData; validation: ValidationResult }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });

        if (workbook.SheetNames.length === 0) {
          throw new Error("Nenhuma aba encontrada na planilha");
        }

        // Validate structure first
        const validation = validateExcelStructure(workbook);

        if (validation.valid) {
          // Use "Todos" sheet
          const todosSheet = workbook.SheetNames.find(
            (name) => normalizeForComparison(name) === "TODOS"
          )!;
          const result = parseTodosSheet(workbook, todosSheet, file.name);

          if (result.records.length === 0) {
            throw new Error("Nenhum funcionário encontrado na planilha");
          }

          resolve({ data: result, validation });
        } else {
          // Fallback to municipality sheets
          const municipalityResult = parseMunicipalitySheets(workbook, file.name);

          if (municipalityResult.records.length === 0) {
            throw new Error("Nenhum funcionário encontrado na planilha");
          }

          resolve({ data: municipalityResult, validation });
        }
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
 */
export function findEmployeeInSpreadsheet(name: string, records: EmployeeRecord[]): EmployeeRecord | null {
  if (!name || records.length === 0) return null;

  const normalizedName = normalizeForComparison(name);
  const nameWords = normalizedName.split(" ").filter((w) => w.length >= 2);

  if (nameWords.length === 0) return null;

  // 1. Exact match (highest confidence)
  const exact = records.find((r) => normalizeForComparison(r.colaborador) === normalizedName);
  if (exact) return exact;

  // 2. First + last name exact match, but ONLY if unique (no ambiguity)
  const firstName = nameWords[0];
  const lastName = nameWords[nameWords.length - 1];

  const firstLastMatches = records.filter((r) => {
    const rNorm = normalizeForComparison(r.colaborador);
    const rWords = rNorm.split(" ").filter((w) => w.length >= 2);
    if (rWords.length < 2) return false;
    return rWords[0] === firstName && rWords[rWords.length - 1] === lastName;
  });

  // Only return if there's exactly ONE match (no ambiguity)
  if (firstLastMatches.length === 1) return firstLastMatches[0];

  // NO further fallbacks (overlap/partial removed to prevent wrong company assignment)
  if (firstLastMatches.length > 1) {
    console.warn(`[Excel] Ambiguous match for "${name}": ${firstLastMatches.length} candidates with same first+last name. Skipping.`);
  }

  return null;
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
