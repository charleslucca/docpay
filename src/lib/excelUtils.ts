import * as XLSX from "xlsx";

export interface EmployeeRecord {
  empresa: string;
  cidade: string;
  contrato: string;
  colaborador: string;
  banco?: string;
  tipo?: string;
  totalFuncionarios?: number;
  observacoes?: string;
  salario?: number;
  codigo?: string;
  outrosProventos?: number;
  salarioFamilia?: number;
  inss?: number;
  irrf?: number;
  outrosDescontos?: number;
  liquido?: number;
  fgts?: number;
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

// Required columns — OBSERVAÇÕES, SALARIO, TOTAL FUNCIONARIOS and TIPO are optional
const REQUIRED_COLUMNS = ["EMPRESA", "CIDADE", "CONTRATO", "COLABORADOR", "BANCO"];

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
  const todosSheet = workbook.SheetNames.find(
    (name) => normalizeForComparison(name) === "TODOS"
  );

  if (!todosSheet) {
    return { valid: false, missingColumns: REQUIRED_COLUMNS };
  }

  const sheet = workbook.Sheets[todosSheet];
  const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

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
 * Flexible column detection: exact → startsWith → contains, with aliases
 */
function findColumnIndex(headers: string[], possibleNames: string[]): number {
  const normalizedHeaders = headers.map(h => h ? normalizeForComparison(String(h)) : "");
  const normalizedNames = possibleNames.map(normalizeForComparison);

  for (const name of normalizedNames) {
    const idx = normalizedHeaders.indexOf(name);
    if (idx !== -1) return idx;
  }
  for (const name of normalizedNames) {
    const idx = normalizedHeaders.findIndex(h => h.startsWith(name));
    if (idx !== -1) return idx;
  }
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
const OBSERVACOES_ALIASES = ["OBSERVACOES", "OBSERVAÇÕES", "OBS", "OBSERVACAO", "OBSERVAÇÃO"];
const SALARIO_ALIASES = ["SALARIO", "SALÁRIO", "SAL", "REMUNERACAO", "REMUNERAÇÃO", "VALOR"];

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
  let observacoesCol = -1;
  let salarioCol = -1;

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
    observacoesCol = findColumnIndex(headerStrings, OBSERVACOES_ALIASES);
    salarioCol = findColumnIndex(headerStrings, SALARIO_ALIASES);

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
    const observacoes = observacoesCol >= 0 ? String(row[observacoesCol] || "").trim() || undefined : undefined;
    
    // Parse salary safely — never log the value
    let salario: number | undefined;
    if (salarioCol >= 0) {
      const rawSalario = row[salarioCol];
      if (rawSalario !== null && rawSalario !== undefined && rawSalario !== "") {
        const parsed = Number(rawSalario);
        if (!isNaN(parsed) && parsed > 0) {
          salario = parsed;
        }
      }
    }

    records.push({ empresa, cidade, contrato, colaborador, banco, tipo, totalFuncionarios: totalFunc, observacoes, salario });

    if (empresa) empresasSet.add(empresa);
    if (cidade) cidadesSet.add(cidade);
  }

  // Log safe metadata only — never log salary values
  console.log(`[Excel] Parsed "Todos" sheet: ${records.length} employees, ${empresasSet.size} companies, ${cidadesSet.size} cities`);

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
 * Detect if a line looks like a city
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

function looksLikeCompany(value: string): boolean {
  const normalized = value.trim().toUpperCase();
  const knownCompanies = ["B SERVICE", "SPACE", "FORTCLEAN", "INTERCLEAN"];
  return knownCompanies.some((c) => normalized.startsWith(c) || normalized === c);
}

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

    // Detect salary column in municipality sheet headers
    let salarioColMun = -1;
    const headerRow = jsonData[startIndex - 1] as unknown[];
    if (headerRow) {
      const headerStrings = headerRow.map(cell => String(cell || ""));
      salarioColMun = findColumnIndex(headerStrings, SALARIO_ALIASES);
    }

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

      // Parse salary from municipality sheet — never log value
      let salario: number | undefined;
      if (salarioColMun >= 0) {
        const rawSalario = row[salarioColMun];
        if (rawSalario !== null && rawSalario !== undefined && rawSalario !== "") {
          const parsed = Number(rawSalario);
          if (!isNaN(parsed) && parsed > 0) {
            salario = parsed;
          }
        }
      }

      records.push({
        empresa,
        cidade: cidadeExtraida,
        contrato: sheetName,
        colaborador: name,
        salario,
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
 */
/**
 * Detect if a workbook is a "Relação da Folha por Empregado" payroll report
 */
function isPayrollReport(workbook: XLSX.WorkBook): boolean {
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) return false;
  const jsonData = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1 });
  // Check first 10 rows for the report identifier
  for (let i = 0; i < Math.min(10, jsonData.length); i++) {
    const row = jsonData[i] as unknown[];
    if (!row) continue;
    const rowText = row.map(c => String(c || "")).join(" ").toUpperCase();
    if (rowText.includes("RELAÇÃO DA FOLHA") || rowText.includes("RELACAO DA FOLHA")) {
      return true;
    }
  }
  return false;
}

/**
 * Parse a numeric value from a cell, returning undefined if invalid
 */
function parseNumericCell(cell: unknown): number | undefined {
  if (cell === null || cell === undefined || cell === "") return undefined;
  const val = typeof cell === "number" ? cell : Number(String(cell).replace(/[^\d.,-]/g, "").replace(",", "."));
  return isNaN(val) ? undefined : val;
}

/**
 * Extract empresa name from header line like "2 - B SERVICE PRESTADORA DE SERVICOS EIRELI"
 */
function extractEmpresaFromHeader(line: string): string {
  return line.replace(/^\d+\s*-\s*/, "").trim();
}

/**
 * Extract cidade from "Serviço:" line like "6-MUNICIPIO DE SANTO ANTONIO DA PATRULHA"
 */
function extractCidadeFromServico(servicoText: string): string {
  // Remove prefix number "6-" or "6 - "
  const cleaned = servicoText.replace(/^\d+\s*-\s*/, "").trim();
  // If starts with "MUNICIPIO DE " or "MUNICÍPIO DE ", extract just the city name
  const munMatch = cleaned.match(/^MUNIC[IÍ]PIO\s+DE\s+(.+)/i);
  if (munMatch) return munMatch[1].trim();
  // If starts with "PREFEITURA MUNICIPAL DE", extract city
  const prefMatch = cleaned.match(/^PREFEITURA\s+MUNICIPAL\s+DE\s+(.+)/i);
  if (prefMatch) return prefMatch[1].trim();
  return cleaned;
}

/**
 * Parse "Relação da Folha por Empregado" payroll report format
 */
function parsePayrollReport(workbook: XLSX.WorkBook, fileName: string): SpreadsheetData {
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const jsonData = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, defval: "" });

  const records: EmployeeRecord[] = [];
  const empresasSet = new Set<string>();
  const cidadesSet = new Set<string>();

  // Extract empresa from first row
  let empresa = "";
  if (jsonData.length > 0) {
    const row0 = jsonData[0] as unknown[];
    empresa = extractEmpresaFromHeader(String(row0?.[0] || ""));
  }
  if (empresa) empresasSet.add(empresa);

  let currentCidade = "";
  let currentContrato = "";

  // Skip rows to ignore: total, subtotal, headers, empty
  const skipPatterns = [
    /^TOTAL/i, /^SUBTOTAL/i, /^SOMA/i,
    /^EMPREGADOS?$/i, /^CONTRIBUINTES?$/i,
    /^C[OÓ]DIGO$/i, /^NOME/i,
  ];

  for (let i = 0; i < jsonData.length; i++) {
    const row = jsonData[i] as unknown[];
    if (!row) continue;

    const cellA = String(row[0] || "").trim();
    const cellB = String(row[1] || "").trim();

    // Detect "Serviço:" grouping line
    // Could be in cellA like "Serviço: 6-MUNICIPIO DE ..." or split across cells
    const fullRowText = row.map(c => String(c || "")).join(" ");
    const servicoMatch = fullRowText.match(/Servi[çc]o\s*:\s*(.+)/i);
    if (servicoMatch) {
      const servicoValue = servicoMatch[1].trim();
      currentContrato = servicoValue;
      currentCidade = extractCidadeFromServico(servicoValue);
      if (currentCidade) cidadesSet.add(currentCidade);
      continue;
    }

    // Skip non-data rows
    if (!cellA) continue;
    const cellANorm = normalizeForComparison(cellA);
    if (skipPatterns.some(p => p.test(cellANorm))) continue;

    // Employee row: cellA should be a numeric code
    const codigo = cellA;
    if (!/^\d+$/.test(codigo)) continue;

    // cellB = employee name
    const colaborador = cellB.trim();
    if (!colaborador || colaborador.length < 3) continue;

    // Financial columns: Salário(C), Out.Prov(D), Sal.Fam(E), INSS(F), IRRF(G), Out.Des(H), Líquid(I), FGTS(J)
    const salario = parseNumericCell(row[2]);
    const outrosProventos = parseNumericCell(row[3]);
    const salarioFamilia = parseNumericCell(row[4]);
    const inss = parseNumericCell(row[5]);
    const irrf = parseNumericCell(row[6]);
    const outrosDescontos = parseNumericCell(row[7]);
    const liquido = parseNumericCell(row[8]);
    const fgts = parseNumericCell(row[9]);

    records.push({
      empresa,
      cidade: currentCidade,
      contrato: currentContrato,
      colaborador,
      codigo,
      salario,
      outrosProventos,
      salarioFamilia,
      inss,
      irrf,
      outrosDescontos,
      liquido,
      fgts,
    });
  }

  console.log(`[Excel] Parsed payroll report: ${records.length} employees, ${empresasSet.size} companies, ${cidadesSet.size} cities`);

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

        // Check for payroll report format first
        if (isPayrollReport(workbook)) {
          console.log("[Excel] Detected payroll report format (Relação da Folha por Empregado)");
          const result = parsePayrollReport(workbook, file.name);

          if (result.records.length === 0) {
            throw new Error("Nenhum funcionário encontrado na planilha");
          }

          resolve({ data: result, validation: { valid: true, missingColumns: [] } });
          return;
        }

        const validation = validateExcelStructure(workbook);

        if (validation.valid) {
          const todosSheet = workbook.SheetNames.find(
            (name) => normalizeForComparison(name) === "TODOS"
          )!;
          const result = parseTodosSheet(workbook, todosSheet, file.name);

          if (result.records.length === 0) {
            throw new Error("Nenhum funcionário encontrado na planilha");
          }

          resolve({ data: result, validation });
        } else {
          const municipalityResult = parseMunicipalitySheets(workbook, file.name);

          if (municipalityResult.records.length === 0) {
            throw new Error("Nenhum funcionário encontrado na planilha");
          }

          resolve({ data: municipalityResult, validation });
        }
      } catch (error) {
        console.error("[Excel] Parse error:", error instanceof Error ? error.message : "Unknown error");
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

  const exact = records.find((r) => normalizeForComparison(r.colaborador) === normalizedName);
  if (exact) return exact;

  const firstName = nameWords[0];
  const lastName = nameWords[nameWords.length - 1];

  const firstLastMatches = records.filter((r) => {
    const rNorm = normalizeForComparison(r.colaborador);
    const rWords = rNorm.split(" ").filter((w) => w.length >= 2);
    if (rWords.length < 2) return false;
    return rWords[0] === firstName && rWords[rWords.length - 1] === lastName;
  });

  if (firstLastMatches.length === 1) return firstLastMatches[0];

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
