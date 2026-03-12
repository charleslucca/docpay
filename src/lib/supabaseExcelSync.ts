import { supabase } from "@/integrations/supabase/client";
import { normalizeForComparison, type SpreadsheetData, type EmployeeRecord } from "./excelUtils";

export interface SyncProgress {
  stage: 'uploading' | 'syncing-empresas' | 'syncing-municipios' | 'syncing-funcionarios' | 'finalizing';
  message: string;
}

export interface SyncResult {
  success: boolean;
  error?: string;
  stats: {
    empresas: number;
    municipios: number;
    funcionariosNovos: number;
    funcionariosAtualizados: number;
    funcionariosRemovidos: number;
    totalFuncionarios: number;
  };
  uploadHistoryId?: string;
}

interface FuncionarioExisting {
  id: string;
  empresa_id: string;
  municipio_id: string;
  nome_normalizado: string;
  banco: string | null;
  contrato: string | null;
  ativo: boolean;
}

/**
 * Helper function to split array into chunks
 */
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Upload Excel file to Supabase Storage
 */
async function uploadExcelFile(file: File): Promise<string | null> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${timestamp}_${file.name}`;
  const filePath = `uploads/${fileName}`;

  const { error } = await supabase.storage
    .from("excel-uploads")
    .upload(filePath, file);

  if (error) {
    console.error("[Sync] Upload error:", error);
    return null;
  }

  return filePath;
}

/**
 * BATCH: Upsert empresas and return mapping of nome_normalizado -> id
 * Reduced from N requests to 2-3 requests
 */
async function upsertEmpresasBatch(empresas: string[]): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();
  
  if (empresas.length === 0) return mapping;

  // 1. Fetch ALL existing empresas in ONE request
  const { data: existingEmpresas } = await supabase
    .from("empresas")
    .select("id, nome_normalizado");

  const existingMap = new Map(
    (existingEmpresas || []).map(e => [e.nome_normalizado, e.id])
  );

  // 2. Prepare data and find which ones need to be inserted
  const empresasData = empresas.map((nome) => ({
    nome,
    nome_normalizado: normalizeForComparison(nome),
  }));

  const toInsert = empresasData.filter(e => !existingMap.has(e.nome_normalizado));

  // 3. Insert all new empresas in ONE batch request
  if (toInsert.length > 0) {
    const { data: inserted, error } = await supabase
      .from("empresas")
      .insert(toInsert)
      .select("id, nome_normalizado");

    if (error) {
      console.error("[Sync] Batch insert empresas error:", error);
    } else if (inserted) {
      inserted.forEach(e => existingMap.set(e.nome_normalizado, e.id));
    }
  }

  // 4. Build final mapping from all empresas
  empresasData.forEach(e => {
    const id = existingMap.get(e.nome_normalizado);
    if (id) mapping.set(e.nome_normalizado, id);
  });

  return mapping;
}

/**
 * BATCH: Upsert municipios and return mapping of nome_normalizado -> id
 * Reduced from N requests to 2-3 requests
 */
async function upsertMunicipiosBatch(municipios: string[]): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();
  
  if (municipios.length === 0) return mapping;

  // 1. Fetch ALL existing municipios in ONE request
  const { data: existingMunicipios } = await supabase
    .from("municipios")
    .select("id, nome_normalizado");

  const existingMap = new Map(
    (existingMunicipios || []).map(m => [m.nome_normalizado, m.id])
  );

  // 2. Prepare data and find which ones need to be inserted
  const municipiosData = municipios.map((nome) => ({
    nome,
    nome_normalizado: normalizeForComparison(nome),
  }));

  const toInsert = municipiosData.filter(m => !existingMap.has(m.nome_normalizado));

  // 3. Insert all new municipios in ONE batch request
  if (toInsert.length > 0) {
    const { data: inserted, error } = await supabase
      .from("municipios")
      .insert(toInsert)
      .select("id, nome_normalizado");

    if (error) {
      console.error("[Sync] Batch insert municipios error:", error);
    } else if (inserted) {
      inserted.forEach(m => existingMap.set(m.nome_normalizado, m.id));
    }
  }

  // 4. Build final mapping from all municipios
  municipiosData.forEach(m => {
    const id = existingMap.get(m.nome_normalizado);
    if (id) mapping.set(m.nome_normalizado, id);
  });

  return mapping;
}

/**
 * Extract banco from the second line format: "CIDADE - BANCO" or "CIDADE - CARGO - BANCO"
 */
function extractBancoFromContrato(contrato: string): string | null {
  if (!contrato) return null;
  const parts = contrato.split(/\s*-\s*/);
  return parts.length > 1 ? parts[parts.length - 1]?.trim() || null : null;
}

/**
 * Normalize a value for safe comparison: treat null, undefined, "" as null; trim and uppercase otherwise
 */
function normalizeFieldValue(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  return value.trim().toUpperCase();
}

/**
 * BATCH: Sync funcionarios with the database
 * Reduced from ~2N requests to ~5-10 requests
 */
async function syncFuncionariosBatch(
  records: EmployeeRecord[],
  empresaMap: Map<string, string>,
  municipioMap: Map<string, string>
): Promise<{ novos: number; atualizados: number; removidos: number }> {
  let novos = 0;
  let atualizados = 0;
  let removidos = 0;

  const empresaIds = Array.from(empresaMap.values());
  const municipioIds = Array.from(municipioMap.values());

  if (empresaIds.length === 0 || municipioIds.length === 0) {
    return { novos, atualizados, removidos };
  }

  // 1. BATCH FETCH: Get ALL existing funcionarios for these empresas in ONE request
  const { data: allExisting } = await supabase
    .from("funcionarios")
    .select("id, empresa_id, municipio_id, nome_normalizado, banco, contrato, ativo")
    .in("empresa_id", empresaIds);

  // 2. Build lookup Map for O(1) access
  const existingMap = new Map<string, FuncionarioExisting>(
    (allExisting || []).map(f => [
      `${f.empresa_id}|${f.municipio_id}|${f.nome_normalizado}`,
      f
    ])
  );

  // 3. Compare in memory and categorize records
  const toInsert: Array<{
    empresa_id: string;
    municipio_id: string;
    nome: string;
    nome_normalizado: string;
    banco: string | null;
    contrato: string | null;
    ativo: boolean;
  }> = [];

  const toUpdate: Array<{ id: string; data: { banco: string | null; contrato: string | null; ativo: boolean } }> = [];
  const processedIds = new Set<string>();

  for (const record of records) {
    const empresaNorm = normalizeForComparison(record.empresa);
    const municipioNorm = normalizeForComparison(record.cidade);
    const nomeNorm = normalizeForComparison(record.colaborador);

    const empresaId = empresaMap.get(empresaNorm);
    const municipioId = municipioMap.get(municipioNorm);

    if (!empresaId || !municipioId) {
      console.warn("[Sync] Missing empresa or municipio for:", record.colaborador);
      continue;
    }

    const banco = record.banco || extractBancoFromContrato(record.contrato);
    const key = `${empresaId}|${municipioId}|${nomeNorm}`;
    const existing = existingMap.get(key);

    if (existing) {
      processedIds.add(existing.id);

      // Check if update needed
      const needsUpdate =
        existing.banco !== banco ||
        existing.contrato !== record.contrato ||
        !existing.ativo;

      if (needsUpdate) {
        toUpdate.push({
          id: existing.id,
          data: { banco, contrato: record.contrato, ativo: true }
        });
      }
    } else {
      toInsert.push({
        empresa_id: empresaId,
        municipio_id: municipioId,
        nome: record.colaborador,
        nome_normalizado: nomeNorm,
        banco,
        contrato: record.contrato,
        ativo: true,
      });
    }
  }

  // 4. BATCH INSERT: Insert all new funcionarios in ONE request
  if (toInsert.length > 0) {
    const { data: inserted, error } = await supabase
      .from("funcionarios")
      .insert(toInsert)
      .select("id");

    if (error) {
      console.error("[Sync] Batch insert funcionarios error:", error);
    } else if (inserted) {
      novos = inserted.length;
      inserted.forEach(f => processedIds.add(f.id));
    }
  }

  // 5. PARALLEL UPDATES: Process updates in parallel chunks of 50
  if (toUpdate.length > 0) {
    const updateChunks = chunkArray(toUpdate, 50);
    
    await Promise.all(
      updateChunks.map(chunk =>
        Promise.all(
          chunk.map(item =>
            supabase
              .from("funcionarios")
              .update(item.data)
              .eq("id", item.id)
          )
        )
      )
    );
    
    atualizados = toUpdate.length;
  }

  // 6. BATCH DEACTIVATE: Mark funcionarios not in current Excel as inactive
  const toDeactivate = (allExisting || [])
    .filter(f => f.ativo && !processedIds.has(f.id))
    .map(f => f.id);

  if (toDeactivate.length > 0) {
    // Use IN clause for batch update in ONE request
    const { error } = await supabase
      .from("funcionarios")
      .update({ ativo: false })
      .in("id", toDeactivate);

    if (error) {
      console.error("[Sync] Batch deactivate error:", error);
    } else {
      removidos = toDeactivate.length;
    }
  }

  return { novos, atualizados, removidos };
}

/**
 * Log the upload to history table
 */
async function logUploadHistory(
  fileName: string,
  filePath: string | null,
  stats: SyncResult["stats"]
): Promise<string | null> {
  const { data, error } = await supabase
    .from("excel_upload_history")
    .insert({
      file_name: fileName,
      file_path: filePath,
      total_empresas: stats.empresas,
      total_municipios: stats.municipios,
      total_funcionarios: stats.totalFuncionarios,
      funcionarios_novos: stats.funcionariosNovos,
      funcionarios_atualizados: stats.funcionariosAtualizados,
      funcionarios_removidos: stats.funcionariosRemovidos,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[Sync] Log history error:", error);
    return null;
  }

  return data?.id || null;
}

/**
 * Main sync function - orchestrates the entire process with batch processing
 * Reduced from ~900 HTTP requests to ~10-15 requests
 */
export async function syncSpreadsheetToDatabase(
  data: SpreadsheetData,
  file?: File,
  onProgress?: (progress: SyncProgress) => void
): Promise<SyncResult> {
  try {
    const startTime = performance.now();
    
    console.log("[Sync] Starting optimized batch sync...", {
      empresas: data.empresas.length,
      municipios: data.cidades.length,
      funcionarios: data.records.length,
    });

    // 1. Upload file to storage (optional)
    onProgress?.({ stage: 'uploading', message: 'Enviando arquivo...' });
    let filePath: string | null = null;
    if (file) {
      filePath = await uploadExcelFile(file);
    }

    // 2. BATCH upsert empresas (2-3 requests instead of N*2)
    onProgress?.({ stage: 'syncing-empresas', message: `Sincronizando ${data.empresas.length} empresas...` });
    const empresaMap = await upsertEmpresasBatch(data.empresas);
    console.log("[Sync] Empresas synced:", empresaMap.size);

    // 3. BATCH upsert municipios (2-3 requests instead of N*2)
    onProgress?.({ stage: 'syncing-municipios', message: `Sincronizando ${data.cidades.length} municípios...` });
    const municipioMap = await upsertMunicipiosBatch(data.cidades);
    console.log("[Sync] Municipios synced:", municipioMap.size);

    // 4. BATCH sync funcionarios (~5-10 requests instead of N*2)
    onProgress?.({ stage: 'syncing-funcionarios', message: `Sincronizando ${data.records.length} funcionários...` });
    const funcStats = await syncFuncionariosBatch(data.records, empresaMap, municipioMap);
    console.log("[Sync] Funcionarios synced:", funcStats);

    const stats: SyncResult["stats"] = {
      empresas: empresaMap.size,
      municipios: municipioMap.size,
      funcionariosNovos: funcStats.novos,
      funcionariosAtualizados: funcStats.atualizados,
      funcionariosRemovidos: funcStats.removidos,
      totalFuncionarios: data.records.length,
    };

    // 5. Log to history
    onProgress?.({ stage: 'finalizing', message: 'Finalizando...' });
    const historyId = await logUploadHistory(data.fileName, filePath, stats);

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`[Sync] Complete in ${elapsed}s!`, stats);

    return {
      success: true,
      stats,
      uploadHistoryId: historyId || undefined,
    };
  } catch (error) {
    console.error("[Sync] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao sincronizar dados",
      stats: {
        empresas: 0,
        municipios: 0,
        funcionariosNovos: 0,
        funcionariosAtualizados: 0,
        funcionariosRemovidos: 0,
        totalFuncionarios: 0,
      },
    };
  }
}
