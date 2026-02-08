import { supabase } from "@/integrations/supabase/client";
import { normalizeForComparison, type SpreadsheetData, type EmployeeRecord } from "./excelUtils";

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

interface EmpresaRow {
  id: string;
  nome: string;
  nome_normalizado: string;
}

interface MunicipioRow {
  id: string;
  nome: string;
  nome_normalizado: string;
}

interface FuncionarioRow {
  id: string;
  empresa_id: string;
  municipio_id: string;
  nome: string;
  nome_normalizado: string;
  cargo: string | null;
  banco: string | null;
  contrato: string | null;
  ativo: boolean;
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
 * Upsert empresas and return mapping of nome_normalizado -> id
 */
async function upsertEmpresas(empresas: string[]): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();
  
  if (empresas.length === 0) return mapping;

  // Prepare data with normalized names
  const empresasData = empresas.map((nome) => ({
    nome,
    nome_normalizado: normalizeForComparison(nome),
  }));

  // Upsert each empresa
  for (const empresa of empresasData) {
    // First try to find existing
    const { data: existing } = await supabase
      .from("empresas")
      .select("id, nome_normalizado")
      .eq("nome_normalizado", empresa.nome_normalizado)
      .single();

    if (existing) {
      mapping.set(empresa.nome_normalizado, existing.id);
    } else {
      // Insert new
      const { data: inserted, error } = await supabase
        .from("empresas")
        .insert({ nome: empresa.nome, nome_normalizado: empresa.nome_normalizado })
        .select("id")
        .single();

      if (inserted) {
        mapping.set(empresa.nome_normalizado, inserted.id);
      } else if (error) {
        console.error("[Sync] Insert empresa error:", error);
      }
    }
  }

  return mapping;
}

/**
 * Upsert municipios and return mapping of nome_normalizado -> id
 */
async function upsertMunicipios(municipios: string[]): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();
  
  if (municipios.length === 0) return mapping;

  // Prepare data with normalized names
  const municipiosData = municipios.map((nome) => ({
    nome,
    nome_normalizado: normalizeForComparison(nome),
  }));

  // Upsert each municipio
  for (const municipio of municipiosData) {
    // First try to find existing
    const { data: existing } = await supabase
      .from("municipios")
      .select("id, nome_normalizado")
      .eq("nome_normalizado", municipio.nome_normalizado)
      .single();

    if (existing) {
      mapping.set(municipio.nome_normalizado, existing.id);
    } else {
      // Insert new
      const { data: inserted, error } = await supabase
        .from("municipios")
        .insert({ nome: municipio.nome, nome_normalizado: municipio.nome_normalizado })
        .select("id")
        .single();

      if (inserted) {
        mapping.set(municipio.nome_normalizado, inserted.id);
      } else if (error) {
        console.error("[Sync] Insert municipio error:", error);
      }
    }
  }

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
 * Sync funcionarios with the database
 * Returns counts of new, updated, and removed records
 */
async function syncFuncionarios(
  records: EmployeeRecord[],
  empresaMap: Map<string, string>,
  municipioMap: Map<string, string>
): Promise<{ novos: number; atualizados: number; removidos: number }> {
  let novos = 0;
  let atualizados = 0;
  let removidos = 0;

  // Get all current funcionarios IDs that we're about to process
  const processedIds = new Set<string>();

  // Get all empresas and municipios IDs that we have
  const empresaIds = Array.from(empresaMap.values());
  const municipioIds = Array.from(municipioMap.values());

  if (empresaIds.length === 0 || municipioIds.length === 0) {
    return { novos, atualizados, removidos };
  }

  // Process each record
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

    const banco = extractBancoFromContrato(record.contrato);

    // Check if funcionario exists
    const { data: existing } = await supabase
      .from("funcionarios")
      .select("id, cargo, banco, contrato, ativo")
      .eq("empresa_id", empresaId)
      .eq("municipio_id", municipioId)
      .eq("nome_normalizado", nomeNorm)
      .single();

    if (existing) {
      processedIds.add(existing.id);

      // Check if update needed
      const needsUpdate =
        existing.banco !== banco ||
        existing.contrato !== record.contrato ||
        !existing.ativo;

      if (needsUpdate) {
        await supabase
          .from("funcionarios")
          .update({
            banco,
            contrato: record.contrato,
            ativo: true,
          })
          .eq("id", existing.id);
        atualizados++;
      }
    } else {
      // Insert new funcionario
      const { data: inserted } = await supabase
        .from("funcionarios")
        .insert({
          empresa_id: empresaId,
          municipio_id: municipioId,
          nome: record.colaborador,
          nome_normalizado: nomeNorm,
          banco,
          contrato: record.contrato,
          ativo: true,
        })
        .select("id")
        .single();

      if (inserted) {
        processedIds.add(inserted.id);
        novos++;
      }
    }
  }

  // Mark funcionarios not in the current Excel as inactive
  // Only for the empresas and municipios that were in this file
  const { data: allFuncionarios } = await supabase
    .from("funcionarios")
    .select("id")
    .in("empresa_id", empresaIds)
    .in("municipio_id", municipioIds)
    .eq("ativo", true);

  if (allFuncionarios) {
    for (const func of allFuncionarios) {
      if (!processedIds.has(func.id)) {
        await supabase
          .from("funcionarios")
          .update({ ativo: false })
          .eq("id", func.id);
        removidos++;
      }
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
 * Main sync function - orchestrates the entire process
 */
export async function syncSpreadsheetToDatabase(
  data: SpreadsheetData,
  file?: File
): Promise<SyncResult> {
  try {
    console.log("[Sync] Starting sync...", {
      empresas: data.empresas.length,
      municipios: data.cidades.length,
      funcionarios: data.records.length,
    });

    // 1. Upload file to storage (optional)
    let filePath: string | null = null;
    if (file) {
      filePath = await uploadExcelFile(file);
    }

    // 2. Upsert empresas
    const empresaMap = await upsertEmpresas(data.empresas);
    console.log("[Sync] Empresas synced:", empresaMap.size);

    // 3. Upsert municipios
    const municipioMap = await upsertMunicipios(data.cidades);
    console.log("[Sync] Municipios synced:", municipioMap.size);

    // 4. Sync funcionarios
    const funcStats = await syncFuncionarios(data.records, empresaMap, municipioMap);
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
    const historyId = await logUploadHistory(data.fileName, filePath, stats);

    console.log("[Sync] Complete!", stats);

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
