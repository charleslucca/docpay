import * as XLSX from "xlsx";

/**
 * Fill merged cell ranges so sheet_to_json produces complete data.
 * In .xls files, only the anchor cell of a merge has a value — this fills all cells in the range.
 */
function fillMerges(sheet: XLSX.WorkSheet): void {
  const merges = sheet['!merges'];
  if (!merges || merges.length === 0) return;

  for (const merge of merges) {
    const anchorAddr = XLSX.utils.encode_cell({ r: merge.s.r, c: merge.s.c });
    const anchorCell = sheet[anchorAddr];
    if (!anchorCell) continue;

    for (let r = merge.s.r; r <= merge.e.r; r++) {
      for (let c = merge.s.c; c <= merge.e.c; c++) {
        if (r === merge.s.r && c === merge.s.c) continue;
        const addr = XLSX.utils.encode_cell({ r, c });
        if (!sheet[addr]) {
          sheet[addr] = { t: anchorCell.t, v: anchorCell.v, w: anchorCell.w };
        }
      }
    }
  }
  console.log(`[Excel] Filled ${merges.length} merged cell ranges`);
}

/**
 * Raw cell scan fallback: read cells directly when sheet_to_json fails to find headers.
 * Scans first maxRows × maxCols cells looking for payroll header columns.
 */
function rawCellScanForHeaders(sheet: XLSX.WorkSheet, maxRows = 30, maxCols = 50): { headerRow: number; columnMap: Record<string, number> } | null {
  for (let r = 0; r < maxRows; r++) {
    const cells: string[] = [];
    for (let c = 0; c < maxCols; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      cells.push(cell ? String(cell.v || cell.w || "") : "");
    }

    const codigoCol = findColumnIndex(cells, PR_CODIGO_ALIASES);
    const nomeCol = findColumnIndex(cells, PR_NOME_ALIASES);

    if (codigoCol >= 0 && nomeCol >= 0) {
      console.log(`[Excel] Raw cell scan found headers at row ${r}: codigo=${codigoCol}, nome=${nomeCol}`);
      return {
        headerRow: r,
        columnMap: {
          codigo: codigoCol,
          nome: nomeCol,
          salario: findColumnIndex(cells, PR_SALARIO_ALIASES),
          outrosProv: findColumnIndex(cells, PR_OUTROS_PROV_ALIASES),
          salFam: findColumnIndex(cells, PR_SAL_FAM_ALIASES),
          inss: findColumnIndex(cells, PR_INSS_ALIASES),
          irrf: findColumnIndex(cells, PR_IRRF_ALIASES),
          outrosDesc: findColumnIndex(cells, PR_OUTROS_DESC_ALIASES),
          liquido: findColumnIndex(cells, PR_LIQUIDO_ALIASES),
          fgts: findColumnIndex(cells, PR_FGTS_ALIASES),
        },
      };
    }

    // Secondary: nome + financial column
    if (nomeCol >= 0) {
      const salCol = findColumnIndex(cells, PR_SALARIO_ALIASES);
      const liqCol = findColumnIndex(cells, PR_LIQUIDO_ALIASES);
      if (salCol >= 0 || liqCol >= 0) {
        console.log(`[Excel] Raw cell scan found headers (secondary) at row ${r}: nome=${nomeCol}`);
        return {
          headerRow: r,
          columnMap: {
            codigo: codigoCol,
            nome: nomeCol,
            salario: salCol,
            outrosProv: findColumnIndex(cells, PR_OUTROS_PROV_ALIASES),
            salFam: findColumnIndex(cells, PR_SAL_FAM_ALIASES),
            inss: findColumnIndex(cells, PR_INSS_ALIASES),
            irrf: findColumnIndex(cells, PR_IRRF_ALIASES),
            outrosDesc: findColumnIndex(cells, PR_OUTROS_DESC_ALIASES),
            liquido: liqCol,
            fgts: findColumnIndex(cells, PR_FGTS_ALIASES),
          },
        };
      }
    }
  }
  return null;
}


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
/**
 * Result of analyzing a sheet for payroll report layout
 */
interface PayrollLayoutAnalysis {
  detected: boolean;
  headerRowIndex: number;
  columnMap: Record<string, number>;
  empresa: string;
  hasServicoBlocks: boolean;
  sheetIndex: number;
}

/**
 * Analyze a single sheet for payroll report signals.
 * Scans ALL rows (not just first 20) looking for header combinations and layout clues.
 */
function analyzeSheetForPayrollLayout(workbook: XLSX.WorkBook, sheetIdx: number): PayrollLayoutAnalysis {
  const noResult: PayrollLayoutAnalysis = {
    detected: false, headerRowIndex: -1, columnMap: {}, empresa: "", hasServicoBlocks: false, sheetIndex: sheetIdx,
  };

  const sheet = workbook.Sheets[workbook.SheetNames[sheetIdx]];
  if (!sheet) return noResult;

  // Fill merged cells BEFORE converting to JSON — critical for .xls files
  fillMerges(sheet);

  const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  if (jsonData.length < 3) return noResult;

  // Diagnostic: log first 15 rows (text only, no financial values)
  console.log(`[Excel] Sheet "${workbook.SheetNames[sheetIdx]}" has ${jsonData.length} rows`);
  for (let d = 0; d < Math.min(15, jsonData.length); d++) {
    const row = jsonData[d] as unknown[];
    if (!row) continue;
    const textCells = row.map((c, ci) => {
      const s = String(c || "").trim();
      return s ? `[${ci}]="${s.substring(0, 40)}"` : null;
    }).filter(Boolean);
    if (textCells.length > 0) {
      console.log(`[Excel]   Row ${d}: ${textCells.join(", ")}`);
    }
  }

  // --- Step 1: find header row by scanning ALL rows ---
  let headerRowIndex = -1;
  let bestColumnMap: Record<string, number> = {};

  for (let i = 0; i < jsonData.length; i++) {
    const row = jsonData[i] as unknown[];
    if (!row) continue;
    const headerStrings = row.map(c => String(c || ""));

    const codigoCol = findColumnIndex(headerStrings, PR_CODIGO_ALIASES);
    const nomeCol = findColumnIndex(headerStrings, PR_NOME_ALIASES);

    // Primary detection: both código and nome columns present
    if (codigoCol >= 0 && nomeCol >= 0) {
      headerRowIndex = i;
      bestColumnMap = {
        codigo: codigoCol,
        nome: nomeCol,
        salario: findColumnIndex(headerStrings, PR_SALARIO_ALIASES),
        outrosProv: findColumnIndex(headerStrings, PR_OUTROS_PROV_ALIASES),
        salFam: findColumnIndex(headerStrings, PR_SAL_FAM_ALIASES),
        inss: findColumnIndex(headerStrings, PR_INSS_ALIASES),
        irrf: findColumnIndex(headerStrings, PR_IRRF_ALIASES),
        outrosDesc: findColumnIndex(headerStrings, PR_OUTROS_DESC_ALIASES),
        liquido: findColumnIndex(headerStrings, PR_LIQUIDO_ALIASES),
        fgts: findColumnIndex(headerStrings, PR_FGTS_ALIASES),
      };
      break;
    }

    // Secondary detection: just nome column + financial columns
    if (nomeCol >= 0) {
      const salCol = findColumnIndex(headerStrings, PR_SALARIO_ALIASES);
      const liqCol = findColumnIndex(headerStrings, PR_LIQUIDO_ALIASES);
      if (salCol >= 0 || liqCol >= 0) {
        headerRowIndex = i;
        bestColumnMap = {
          codigo: codigoCol,
          nome: nomeCol,
          salario: salCol,
          outrosProv: findColumnIndex(headerStrings, PR_OUTROS_PROV_ALIASES),
          salFam: findColumnIndex(headerStrings, PR_SAL_FAM_ALIASES),
          inss: findColumnIndex(headerStrings, PR_INSS_ALIASES),
          irrf: findColumnIndex(headerStrings, PR_IRRF_ALIASES),
          outrosDesc: findColumnIndex(headerStrings, PR_OUTROS_DESC_ALIASES),
          liquido: liqCol,
          fgts: findColumnIndex(headerStrings, PR_FGTS_ALIASES),
        };
        break;
      }
    }
  }

  // Fallback: raw cell scan if sheet_to_json didn't find headers
  if (headerRowIndex < 0) {
    console.log("[Excel] sheet_to_json failed to find payroll headers, trying raw cell scan...");
    const rawResult = rawCellScanForHeaders(sheet);
    if (rawResult) {
      headerRowIndex = rawResult.headerRow;
      bestColumnMap = rawResult.columnMap;
    }
  }

  if (headerRowIndex < 0) {
    console.log("[Excel] No payroll headers found in sheet");
    return noResult;
  }

  // --- Step 2: extract empresa from rows before header ---
  let empresa = "";
  const empresaPattern = /^\d+\s*-\s*.+/;
  for (let i = 0; i < Math.min(headerRowIndex, 10); i++) {
    const row = jsonData[i] as unknown[];
    if (!row) continue;
    for (const cell of row) {
      const cellStr = String(cell || "").trim();
      if (cellStr && empresaPattern.test(cellStr)) {
        empresa = extractEmpresaFromHeader(cellStr);
        break;
      }
    }
    if (empresa) break;
  }

  // Fallback: look for "RELAÇÃO DA FOLHA" title lines and nearby empresa
  if (!empresa) {
    for (let i = 0; i < Math.min(headerRowIndex, 10); i++) {
      const row = jsonData[i] as unknown[];
      if (!row) continue;
      for (const cell of row) {
        const cellStr = String(cell || "").trim();
        if (cellStr.length > 5 && !cellStr.match(/^(RELAC|Servi|Codigo|Nome|Salari|INSS|IRRF|FGTS|Liquid)/i)) {
          empresa = cellStr;
          break;
        }
      }
      if (empresa) break;
    }
  }

  // --- Step 3: check for Serviço: blocks ---
  let hasServicoBlocks = false;
  for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
    const row = jsonData[i] as unknown[];
    if (!row) continue;
    const fullRowText = row.map(c => String(c || "")).join(" ");
    if (/Servi[çc]o\s*:/i.test(fullRowText)) {
      hasServicoBlocks = true;
      break;
    }
  }

  const foundCols = Object.entries(bestColumnMap).filter(([, v]) => v >= 0).map(([k]) => k);
  console.log(`[Excel] Payroll layout detected: headerRow=${headerRowIndex}, columns=[${foundCols.join(",")}], empresa="${empresa}", servico=${hasServicoBlocks}`);

  return {
    detected: true,
    headerRowIndex,
    columnMap: bestColumnMap,
    empresa,
    hasServicoBlocks,
    sheetIndex: sheetIdx,
  };
}

/**
 * Try to detect payroll report format across all sheets
 */
function detectPayrollLayout(workbook: XLSX.WorkBook): PayrollLayoutAnalysis | null {
  // Try first sheet first (most common)
  const first = analyzeSheetForPayrollLayout(workbook, 0);
  if (first.detected) return first;

  // Try remaining sheets
  for (let i = 1; i < workbook.SheetNames.length; i++) {
    const result = analyzeSheetForPayrollLayout(workbook, i);
    if (result.detected) return result;
  }

  return null;
}

/**
 * Parse a numeric value from a cell, supporting Brazilian locale (1.234,56)
 */
function parseNumericCell(cell: unknown): number | undefined {
  if (cell === null || cell === undefined || cell === "") return undefined;
  if (typeof cell === "number") return cell;

  let str = String(cell).trim();
  // Remove R$, spaces
  str = str.replace(/R\$\s*/gi, "").replace(/\s/g, "");
  if (!str || str === "-") return undefined;

  // Detect Brazilian format: has comma as decimal separator
  // Pattern: 1.234,56 or 1234,56
  if (str.includes(",")) {
    // If has both . and , → dots are thousands, comma is decimal
    if (str.includes(".")) {
      str = str.replace(/\./g, "").replace(",", ".");
    } else {
      // Only comma → comma is decimal
      str = str.replace(",", ".");
    }
  }

  // Remove any remaining non-numeric chars except . and -
  str = str.replace(/[^\d.\-]/g, "");

  const val = Number(str);
  return isNaN(val) ? undefined : val;
}

/**
 * Extract empresa name from header line like "2 - B SERVICE PRESTADORA DE SERVICOS EIRELI"
 */
function extractEmpresaFromHeader(line: string): string {
  return line.replace(/^\d+\s*-\s*/, "").trim();
}

/**
 * Extract cidade from "Serviço:" line
 */
function extractCidadeFromServico(servicoText: string): string {
  const cleaned = servicoText.replace(/^\d+\s*-\s*/, "").trim();
  const munMatch = cleaned.match(/^MUNIC[IÍ]PIO\s+DE\s+(.+)/i);
  if (munMatch) return munMatch[1].trim();
  const prefMatch = cleaned.match(/^PREFEITURA\s+MUNICIPAL\s+DE\s+(.+)/i);
  if (prefMatch) return prefMatch[1].trim();
  return cleaned;
}

// Column aliases for payroll report
const PR_CODIGO_ALIASES = ["CODIGO", "CÓDIGO", "COD", "COD.", "MATR", "MATRICULA", "MATRÍCULA"];
const PR_NOME_ALIASES = ["NOME DO EMPREGADO", "NOME EMPREGADO", "NOME", "EMPREGADO", "FUNCIONARIO", "FUNCIONÁRIO", "COLABORADOR"];
const PR_SALARIO_ALIASES = ["SALARIO", "SALÁRIO", "SAL", "SAL.", "SALARIO BASE", "SALÁRIO BASE", "REMUNERACAO", "REMUNERAÇÃO"];
const PR_OUTROS_PROV_ALIASES = ["OUT.PROV", "OUTROS PROVENTOS", "OUT PROV", "OUTPROV", "OUTROS PROV", "OUT. PROV", "O.PROV"];
const PR_SAL_FAM_ALIASES = ["SAL.FAM", "SALARIO FAMILIA", "SAL FAM", "SALFAM", "SALÁRIO FAMÍLIA", "SAL. FAM", "S.FAM"];
const PR_INSS_ALIASES = ["INSS", "PREV.SOCIAL", "PREV SOCIAL"];
const PR_IRRF_ALIASES = ["IRRF", "IR", "IMPOSTO RENDA"];
const PR_OUTROS_DESC_ALIASES = ["OUT.DES", "OUTROS DESCONTOS", "OUT DES", "OUTDES", "OUTROS DESC", "OUT. DES", "O.DESC"];
const PR_LIQUIDO_ALIASES = ["LIQUID", "LÍQUID", "LIQUIDO", "LÍQUIDO", "LIQ", "LÍQ", "VALOR LIQUIDO", "VALOR LÍQUIDO"];
const PR_FGTS_ALIASES = ["FGTS", "F.G.T.S"];

/**
 * Parse "Relação da Folha por Empregado" payroll report using pre-analyzed layout
 */
function parsePayrollReport(workbook: XLSX.WorkBook, layout: PayrollLayoutAnalysis, fileName: string): SpreadsheetData {
  const sheet = workbook.Sheets[workbook.SheetNames[layout.sheetIndex]];
  const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });

  const records: EmployeeRecord[] = [];
  const empresasSet = new Set<string>();
  const cidadesSet = new Set<string>();

  const empresa = layout.empresa;
  if (empresa) empresasSet.add(empresa);

  const cm = layout.columnMap;
  const codigoCol = cm.codigo ?? -1;
  const nomeCol = cm.nome ?? -1;
  const salarioCol = cm.salario ?? -1;
  const outrosProvCol = cm.outrosProv ?? -1;
  const salFamCol = cm.salFam ?? -1;
  const inssCol = cm.inss ?? -1;
  const irrfCol = cm.irrf ?? -1;
  const outrosDescCol = cm.outrosDesc ?? -1;
  const liquidoCol = cm.liquido ?? -1;
  const fgtsCol = cm.fgts ?? -1;

  if (nomeCol < 0) {
    console.warn("[Excel] Payroll report: nome column not found in layout");
    return { records: [], empresas: [], cidades: [], funcionariosPorCidade: {}, fileName };
  }

  let currentCidade = "";
  let currentContrato = "";

  const skipPatterns = [
    /^TOTAL/i, /^SUBTOTAL/i, /^SOMA/i,
    /^EMPREGADOS?\b/i, /^CONTRIBUINTES?\b/i,
    /^RELAC/i, /^COMPETENCIA/i, /^PAGAMENTO/i,
    /^Servi[çc]o/i, /^EMPRESA/i, /^CNPJ/i,
    /^CODIGO/i, /^NOME\s*(DO|DA)?\s*(EMPREGADO)?/i,
  ];

  let skippedReasons = { servico: 0, emptyName: 0, shortName: 0, skipPattern: 0, nonNumericCode: 0, fewWords: 0 };

  for (let i = layout.headerRowIndex + 1; i < jsonData.length; i++) {
    const row = jsonData[i] as unknown[];
    if (!row) continue;

    // Detect "Serviço:" — may be in one cell with value, or split across cells
    let servicoDetected = false;
    for (let ci = 0; ci < row.length; ci++) {
      const cellStr = String(row[ci] || "").trim();
      if (!cellStr) continue;
      const servicoMatch = cellStr.match(/Servi[çc]o\s*:\s*(.*)/i);
      if (servicoMatch) {
        let servicoValue = servicoMatch[1].trim();
        // If value is empty, look at next non-empty cells in the row
        if (!servicoValue) {
          for (let cj = ci + 1; cj < row.length; cj++) {
            const nextCell = String(row[cj] || "").trim();
            if (nextCell) {
              servicoValue = nextCell;
              break;
            }
          }
        }
        if (servicoValue) {
          currentContrato = servicoValue;
          currentCidade = extractCidadeFromServico(servicoValue);
          if (currentCidade) cidadesSet.add(currentCidade);
        }
        servicoDetected = true;
        break;
      }
    }
    // Fallback: join all cells and try again (merged cells may produce combined text)
    if (!servicoDetected) {
      const fullRowText = row.map(c => String(c || "")).join(" ");
      const servicoMatch = fullRowText.match(/Servi[çc]o\s*:\s*(.+)/i);
      if (servicoMatch) {
        const servicoValue = servicoMatch[1].trim();
        currentContrato = servicoValue;
        currentCidade = extractCidadeFromServico(servicoValue);
        if (currentCidade) cidadesSet.add(currentCidade);
        servicoDetected = true;
      }
    }
    if (servicoDetected) { skippedReasons.servico++; continue; }

    // Also detect "Serviço:" via number-dash pattern (e.g. "6-MUNICIPIO DE...")
    // This catches cases where the label "Serviço:" is missing but the value has the pattern
    if (!servicoDetected) {
      for (let ci = 0; ci < row.length; ci++) {
        const cellStr = String(row[ci] || "").trim();
        if (cellStr && /^\d+\s*-\s*.{5,}/.test(cellStr) && /MUNIC|PREFEIT|CAMARA/i.test(cellStr)) {
          currentContrato = cellStr;
          currentCidade = extractCidadeFromServico(cellStr);
          if (currentCidade) cidadesSet.add(currentCidade);
          servicoDetected = true;
          skippedReasons.servico++;
          break;
        }
      }
      if (servicoDetected) continue;
    }

    // Get name (required)
    const cellNome = String(row[nomeCol] || "").trim();
    if (!cellNome || cellNome.length < 3) { skippedReasons.emptyName++; continue; }

    const cellNomeNorm = normalizeForComparison(cellNome);
    if (skipPatterns.some(p => p.test(cellNomeNorm))) { skippedReasons.skipPattern++; continue; }

    // Get code (optional — may not exist in some variations)
    let cellCodigo = "";
    if (codigoCol >= 0) {
      let rawCodigo = String(row[codigoCol] || "").trim();
      // Handle numeric codes with .0 suffix from xls
      rawCodigo = rawCodigo.replace(/\.0$/, "");
      // Accept codes that are numeric (with possible leading zeros/spaces)
      rawCodigo = rawCodigo.replace(/\s/g, "");
      if (rawCodigo && /^\d+$/.test(rawCodigo)) {
        cellCodigo = rawCodigo;
      } else if (!rawCodigo) {
        // No code — still try to use the row if name looks valid
        // Skip rows where the "code" cell has non-numeric text (likely a header/label)
      } else {
        // Non-numeric code cell — skip (likely section header)
        skippedReasons.nonNumericCode++; continue;
      }
    } else {
      // No code column at all — accept row if name looks like a person name
      const words = cellNome.split(" ").filter(w => w.length >= 2);
      if (words.length < 2) { skippedReasons.fewWords++; continue; }
    }

    // Validate name looks like a person (at least 2 words)
    const nameWords = cellNome.split(/\s+/).filter(w => w.length >= 2);
    if (nameWords.length < 2) { skippedReasons.fewWords++; continue; }

    const salario = salarioCol >= 0 ? parseNumericCell(row[salarioCol]) : undefined;
    const outrosProventos = outrosProvCol >= 0 ? parseNumericCell(row[outrosProvCol]) : undefined;
    const salarioFamilia = salFamCol >= 0 ? parseNumericCell(row[salFamCol]) : undefined;
    const inss = inssCol >= 0 ? parseNumericCell(row[inssCol]) : undefined;
    const irrf = irrfCol >= 0 ? parseNumericCell(row[irrfCol]) : undefined;
    const outrosDescontos = outrosDescCol >= 0 ? parseNumericCell(row[outrosDescCol]) : undefined;
    const liquido = liquidoCol >= 0 ? parseNumericCell(row[liquidoCol]) : undefined;
    const fgts = fgtsCol >= 0 ? parseNumericCell(row[fgtsCol]) : undefined;

    records.push({
      empresa,
      cidade: currentCidade,
      contrato: currentContrato,
      colaborador: cellNome,
      codigo: cellCodigo || undefined,
      salario, outrosProventos, salarioFamilia, inss, irrf, outrosDescontos, liquido, fgts,
    });
  }

  console.log(`[Excel] Parsed payroll report: ${records.length} employees, ${empresasSet.size} companies, ${cidadesSet.size} cities`);
  console.log(`[Excel] Skip reasons: servico=${skippedReasons.servico}, emptyName=${skippedReasons.emptyName}, shortName=${skippedReasons.shortName}, skipPattern=${skippedReasons.skipPattern}, nonNumericCode=${skippedReasons.nonNumericCode}, fewWords=${skippedReasons.fewWords}`);

  const funcionariosPorCidade: Record<string, number> = {};
  for (const record of records) {
    if (record.cidade) {
      funcionariosPorCidade[record.cidade] = (funcionariosPorCidade[record.cidade] || 0) + 1;
    }
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

        console.log(`[Excel] File: "${file.name}", sheets: [${workbook.SheetNames.join(", ")}]`);
        for (const sn of workbook.SheetNames) {
          const s = workbook.Sheets[sn];
          const ref = s?.['!ref'] || 'empty';
          const mergeCount = s?.['!merges']?.length || 0;
          console.log(`[Excel]   Sheet "${sn}": ref=${ref}, merges=${mergeCount}`);
        }

        // Check for payroll report format first (unified detection + layout analysis)
        const payrollLayout = detectPayrollLayout(workbook);
        if (payrollLayout) {
          console.log("[Excel] Detected payroll report format (Relação da Folha por Empregado)");
          const result = parsePayrollReport(workbook, payrollLayout, file.name);

          if (result.records.length === 0) {
            throw new Error("Formato de folha de pagamento detectado, mas nenhum funcionário encontrado. Verifique se a planilha contém dados de empregados.");
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
