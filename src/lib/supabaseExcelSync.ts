import { supabase } from "@/integrations/supabase/client";
import { normalizeForComparison, type SpreadsheetData, type EmployeeRecord } from "./excelUtils";

export interface SyncProgress {
  stage: 'uploading' | 'syncing-empresas' | 'syncing-municipios' | 'syncing-funcionarios' | 'syncing-salarios' | 'finalizing';
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
  observacoes: string | null;
  codigo: string | null;
  ativo: boolean;
}

function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

async function uploadExcelFile(file: File): Promise<string | null> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${timestamp}_${file.name}`;
  const filePath = `uploads/${fileName}`;

  const { error } = await supabase.storage
    .from("excel-uploads")
    .upload(filePath, file);

  if (error) {
    console.error("[Sync] Upload error:", error.message);
    return null;
  }

  return filePath;
}

async function upsertEmpresasBatch(empresas: string[]): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();
  if (empresas.length === 0) return mapping;

  const { data: existingEmpresas } = await supabase
    .from("empresas")
    .select("id, nome_normalizado");

  const existingMap = new Map(
    (existingEmpresas || []).map(e => [e.nome_normalizado, e.id])
  );

  const empresasData = empresas.map((nome) => ({
    nome,
    nome_normalizado: normalizeForComparison(nome),
  }));

  const toInsert = empresasData.filter(e => !existingMap.has(e.nome_normalizado));

  if (toInsert.length > 0) {
    const { data: inserted, error } = await supabase
      .from("empresas")
      .insert(toInsert)
      .select("id, nome_normalizado");

    if (error) {
      console.error("[Sync] Batch insert empresas error:", error.message);
    } else if (inserted) {
      inserted.forEach(e => existingMap.set(e.nome_normalizado, e.id));
    }
  }

  empresasData.forEach(e => {
    const id = existingMap.get(e.nome_normalizado);
    if (id) mapping.set(e.nome_normalizado, id);
  });

  return mapping;
}

async function upsertMunicipiosBatch(municipios: string[]): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();
  if (municipios.length === 0) return mapping;

  const { data: existingMunicipios } = await supabase
    .from("municipios")
    .select("id, nome_normalizado");

  const existingMap = new Map(
    (existingMunicipios || []).map(m => [m.nome_normalizado, m.id])
  );

  const municipiosData = municipios.map((nome) => ({
    nome,
    nome_normalizado: normalizeForComparison(nome),
  }));

  const toInsert = municipiosData.filter(m => !existingMap.has(m.nome_normalizado));

  if (toInsert.length > 0) {
    const { data: inserted, error } = await supabase
      .from("municipios")
      .insert(toInsert)
      .select("id, nome_normalizado");

    if (error) {
      console.error("[Sync] Batch insert municipios error:", error.message);
    } else if (inserted) {
      inserted.forEach(m => existingMap.set(m.nome_normalizado, m.id));
    }
  }

  municipiosData.forEach(m => {
    const id = existingMap.get(m.nome_normalizado);
    if (id) mapping.set(m.nome_normalizado, id);
  });

  return mapping;
}

function extractBancoFromContrato(contrato: string): string | null {
  if (!contrato) return null;
  const parts = contrato.split(/\s*-\s*/);
  return parts.length > 1 ? parts[parts.length - 1]?.trim() || null : null;
}

function normalizeFieldValue(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  return value.trim().toUpperCase();
}

/**
 * Sync salary data to the separate funcionarios_salario table
 * SECURITY: salary values are never logged
 */
async function syncSalariosBatch(
  records: EmployeeRecord[],
  empresaMap: Map<string, string>,
  municipioMap: Map<string, string>,
  funcionarioIdMap: Map<string, string>
): Promise<void> {
  const salarioRecords: Array<{ funcionario_id: string; salario: number }> = [];

  for (const record of records) {
    if (record.salario === undefined || record.salario === null) continue;

    const empresaNorm = normalizeForComparison(record.empresa);
    const municipioNorm = normalizeForComparison(record.cidade);
    const nomeNorm = normalizeForComparison(record.colaborador);

    const empresaId = empresaMap.get(empresaNorm);
    const municipioId = municipioMap.get(municipioNorm);
    if (!empresaId || !municipioId) continue;

    const key = `${empresaId}|${municipioId}|${nomeNorm}`;
    const funcionarioId = funcionarioIdMap.get(key);
    if (!funcionarioId) continue;

    salarioRecords.push({ funcionario_id: funcionarioId, salario: record.salario });
  }

  if (salarioRecords.length === 0) return;

  // Upsert in chunks to avoid payload limits
  const chunks = chunkArray(salarioRecords, 50);
  for (const chunk of chunks) {
    const { error } = await supabase
      .from("funcionarios_salario" as any)
      .upsert(chunk as any, { onConflict: "funcionario_id" });

    if (error) {
      console.error("[Sync] Salary sync error:", error.message);
    }
  }

  console.log(`[Sync] Salary data synced for ${salarioRecords.length} employees`);
}

async function syncFuncionariosBatch(
  records: EmployeeRecord[],
  empresaMap: Map<string, string>,
  municipioMap: Map<string, string>
): Promise<{ novos: number; atualizados: number; removidos: number; funcionarioIdMap: Map<string, string> }> {
  let novos = 0;
  let atualizados = 0;
  let removidos = 0;
  const funcionarioIdMap = new Map<string, string>();

  const empresaIds = Array.from(empresaMap.values());
  const municipioIds = Array.from(municipioMap.values());

  if (empresaIds.length === 0 || municipioIds.length === 0) {
    return { novos, atualizados, removidos, funcionarioIdMap };
  }

  const { data: allExisting } = await supabase
    .from("funcionarios")
    .select("id, empresa_id, municipio_id, nome_normalizado, banco, contrato, observacoes, codigo, ativo") as { data: FuncionarioExisting[] | null };

  const existingMap = new Map<string, FuncionarioExisting>(
    (allExisting || []).map(f => [
      `${f.empresa_id}|${f.municipio_id}|${f.nome_normalizado}`,
      f
    ])
  );

  const toInsert: Array<{
    empresa_id: string;
    municipio_id: string;
    nome: string;
    nome_normalizado: string;
    banco: string | null;
    contrato: string | null;
    observacoes: string | null;
    codigo: string | null;
    ativo: boolean;
  }> = [];

  const toUpdate: Array<{ id: string; data: { banco: string | null; contrato: string | null; observacoes: string | null; codigo: string | null; ativo: boolean } }> = [];
  const processedIds = new Set<string>();

  // Track keys for inserted records to build funcionarioIdMap later
  const insertKeys: string[] = [];

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
      funcionarioIdMap.set(key, existing.id);

      const newBancoNorm = normalizeFieldValue(banco);
      const existingBancoNorm = normalizeFieldValue(existing.banco);
      const newContratoNorm = normalizeFieldValue(record.contrato);
      const existingContratoNorm = normalizeFieldValue(existing.contrato);
      const newObsNorm = normalizeFieldValue(record.observacoes);
      const existingObsNorm = normalizeFieldValue(existing.observacoes);
      const newCodigoNorm = normalizeFieldValue(record.codigo);
      const existingCodigoNorm = normalizeFieldValue(existing.codigo);

      const bancoChanged = newBancoNorm !== existingBancoNorm;
      const contratoChanged = newContratoNorm !== existingContratoNorm;
      const obsChanged = newObsNorm !== existingObsNorm;
      const codigoChanged = newCodigoNorm !== existingCodigoNorm;
      const needsReactivation = !existing.ativo;

      if (bancoChanged || contratoChanged || obsChanged || codigoChanged || needsReactivation) {
        if (bancoChanged) console.log(`[Sync] Atualização banco: "${existing.banco}" → "${banco}" (${record.colaborador})`);
        if (contratoChanged) console.log(`[Sync] Atualização contrato: "${existing.contrato}" → "${record.contrato}" (${record.colaborador})`);
        if (obsChanged) console.log(`[Sync] Atualização observações: (${record.colaborador})`);
        if (codigoChanged) console.log(`[Sync] Atualização código: (${record.colaborador})`);
        if (needsReactivation) console.log(`[Sync] Reativação: ${record.colaborador}`);

        toUpdate.push({
          id: existing.id,
          data: { banco, contrato: record.contrato, observacoes: record.observacoes || null, codigo: record.codigo || null, ativo: true }
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
        observacoes: record.observacoes || null,
        ativo: true,
      });
      insertKeys.push(key);
    }
  }

  if (toInsert.length > 0) {
    const { data: inserted, error } = await supabase
      .from("funcionarios")
      .insert(toInsert)
      .select("id, empresa_id, municipio_id, nome_normalizado");

    if (error) {
      console.error("[Sync] Batch insert funcionarios error:", error.message);
    } else if (inserted) {
      novos = inserted.length;
      inserted.forEach(f => {
        processedIds.add(f.id);
        const key = `${f.empresa_id}|${f.municipio_id}|${f.nome_normalizado}`;
        funcionarioIdMap.set(key, f.id);
      });
    }
  }

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

  const municipioIdSet = new Set(municipioIds);
  const toDeactivate = (allExisting || [])
    .filter(f => f.ativo && !processedIds.has(f.id) && municipioIdSet.has(f.municipio_id));

  if (toDeactivate.length > 0) {
    toDeactivate.forEach(f => console.log(`[Sync] Desativando: ${f.nome_normalizado}`));

    const deactivateIds = toDeactivate.map(f => f.id);
    const { error } = await supabase
      .from("funcionarios")
      .update({ ativo: false })
      .in("id", deactivateIds);

    if (error) {
      console.error("[Sync] Batch deactivate error:", error.message);
    } else {
      removidos = toDeactivate.length;
    }
  }

  return { novos, atualizados, removidos, funcionarioIdMap };
}

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
    console.error("[Sync] Log history error:", error.message);
    return null;
  }

  return data?.id || null;
}

export async function syncSpreadsheetToDatabase(
  data: SpreadsheetData,
  file?: File,
  onProgress?: (progress: SyncProgress) => void
): Promise<SyncResult> {
  try {
    const startTime = performance.now();

    // Log safe metadata only — never log record details that may contain salary
    console.log("[Sync] Starting optimized batch sync...", {
      empresas: data.empresas.length,
      municipios: data.cidades.length,
      funcionarios: data.records.length,
    });

    onProgress?.({ stage: 'uploading', message: 'Enviando arquivo...' });
    let filePath: string | null = null;
    if (file) {
      filePath = await uploadExcelFile(file);
    }

    onProgress?.({ stage: 'syncing-empresas', message: `Sincronizando ${data.empresas.length} empresas...` });
    const empresaMap = await upsertEmpresasBatch(data.empresas);
    console.log("[Sync] Empresas synced:", empresaMap.size);

    onProgress?.({ stage: 'syncing-municipios', message: `Sincronizando ${data.cidades.length} municípios...` });
    const municipioMap = await upsertMunicipiosBatch(data.cidades);
    console.log("[Sync] Municipios synced:", municipioMap.size);

    onProgress?.({ stage: 'syncing-funcionarios', message: `Sincronizando ${data.records.length} funcionários...` });
    const funcStats = await syncFuncionariosBatch(data.records, empresaMap, municipioMap);
    console.log("[Sync] Funcionarios synced:", { novos: funcStats.novos, atualizados: funcStats.atualizados, removidos: funcStats.removidos });

    // Sync salary data to separate table
    const hasSalaryData = data.records.some(r => r.salario !== undefined && r.salario !== null);
    if (hasSalaryData) {
      onProgress?.({ stage: 'syncing-salarios', message: 'Sincronizando dados salariais...' });
      await syncSalariosBatch(data.records, empresaMap, municipioMap, funcStats.funcionarioIdMap);
    }

    const stats: SyncResult["stats"] = {
      empresas: empresaMap.size,
      municipios: municipioMap.size,
      funcionariosNovos: funcStats.novos,
      funcionariosAtualizados: funcStats.atualizados,
      funcionariosRemovidos: funcStats.removidos,
      totalFuncionarios: data.records.length,
    };

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
    // Safe error logging — never expose record data
    console.error("[Sync] Error:", error instanceof Error ? error.message : "Unknown sync error");
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
