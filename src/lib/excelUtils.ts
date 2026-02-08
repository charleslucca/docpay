import * as XLSX from 'xlsx';

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
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Parse an Excel file and extract employee records from the "Todos" tab or first sheet
 */
export async function parseExcelFile(file: File): Promise<SpreadsheetData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Try to find "Todos" sheet, otherwise use first sheet
        let sheetName = workbook.SheetNames.find(
          name => normalizeForComparison(name) === 'TODOS'
        );
        
        if (!sheetName) {
          sheetName = workbook.SheetNames[0];
        }
        
        if (!sheetName) {
          throw new Error('Nenhuma aba encontrada na planilha');
        }
        
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
            const cell = String(row[j] || '').toUpperCase().trim();
            if (cell === 'EMPRESA') empresaCol = j;
            if (cell === 'CIDADE') cidadeCol = j;
            if (cell === 'CONTRATO') contratoCol = j;
            if (cell === 'COLABORADOR') colaboradorCol = j;
          }
          
          if (empresaCol >= 0 && cidadeCol >= 0 && colaboradorCol >= 0) {
            headerRowIndex = i;
            break;
          }
        }
        
        if (headerRowIndex < 0 || colaboradorCol < 0) {
          throw new Error('Colunas obrigatórias não encontradas (EMPRESA, CIDADE, COLABORADOR)');
        }
        
        const records: EmployeeRecord[] = [];
        const empresasSet = new Set<string>();
        const cidadesSet = new Set<string>();
        
        // Parse data rows
        for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
          const row = jsonData[i] as unknown[];
          if (!row) continue;
          
          const colaborador = String(row[colaboradorCol] || '').trim();
          if (!colaborador) continue;
          
          const empresa = String(row[empresaCol] || '').trim();
          const cidade = String(row[cidadeCol] || '').trim();
          const contrato = contratoCol >= 0 ? String(row[contratoCol] || '').trim() : '';
          
          records.push({
            empresa,
            cidade,
            contrato,
            colaborador,
          });
          
          if (empresa) empresasSet.add(empresa);
          if (cidade) cidadesSet.add(cidade);
        }
        
        console.log(`[Excel] Parsed ${records.length} records from "${sheetName}" sheet`);
        
        resolve({
          records,
          empresas: Array.from(empresasSet).sort(),
          cidades: Array.from(cidadesSet).sort(),
          fileName: file.name,
        });
      } catch (error) {
        console.error('[Excel] Parse error:', error);
        reject(error);
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Erro ao ler arquivo Excel'));
    };
    
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Find an employee record in the spreadsheet by name
 * Uses flexible matching: exact, partial (first+last name), and similarity
 */
export function findEmployeeInSpreadsheet(
  name: string,
  records: EmployeeRecord[]
): EmployeeRecord | null {
  if (!name || records.length === 0) return null;
  
  const normalizedName = normalizeForComparison(name);
  const nameWords = normalizedName.split(' ').filter(w => w.length >= 2);
  
  if (nameWords.length === 0) return null;
  
  // 1. Exact match
  const exact = records.find(
    r => normalizeForComparison(r.colaborador) === normalizedName
  );
  if (exact) return exact;
  
  // 2. First and last name match
  const firstName = nameWords[0];
  const lastName = nameWords[nameWords.length - 1];
  
  const firstLastMatch = records.find(r => {
    const rNorm = normalizeForComparison(r.colaborador);
    const rWords = rNorm.split(' ').filter(w => w.length >= 2);
    if (rWords.length < 2) return false;
    
    const rFirst = rWords[0];
    const rLast = rWords[rWords.length - 1];
    
    return rFirst === firstName && rLast === lastName;
  });
  if (firstLastMatch) return firstLastMatch;
  
  // 3. High word overlap (60%+ of words match)
  const overlapMatch = records.find(r => {
    const rNorm = normalizeForComparison(r.colaborador);
    const rWords = rNorm.split(' ').filter(w => w.length >= 2);
    
    const sharedWords = nameWords.filter(w => rWords.includes(w));
    const minWords = Math.min(nameWords.length, rWords.length);
    
    return sharedWords.length >= 2 && sharedWords.length >= Math.ceil(minWords * 0.6);
  });
  if (overlapMatch) return overlapMatch;
  
  // 4. First name + partial last name (handles abbreviations)
  const partialMatch = records.find(r => {
    const rNorm = normalizeForComparison(r.colaborador);
    const rWords = rNorm.split(' ').filter(w => w.length >= 2);
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
  records: EmployeeRecord[]
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
