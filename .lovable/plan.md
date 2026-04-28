
# Análise: Remoção do Storage do Sistema

## Resumo executivo

**Sim, é totalmente viável remover o Storage** — ele é usado em apenas **um lugar real** no código (upload da planilha Excel original) e **o bucket `generated-documents` nem é mais usado** (PDFs gerados são entregues como ZIP para download local, conforme política já documentada na memória do projeto).

## Onde o Storage é usado hoje

### Bucket `excel-uploads` — único uso ativo
- **Arquivo**: `src/lib/supabaseExcelSync.ts`
- **Função**: `uploadExcelFile()` (linhas 43-58) faz upload do `.xlsx` original
- **Para que serve**: o caminho retornado é gravado em `excel_upload_history.file_path` apenas como referência histórica
- **Criticidade**: **nenhuma** — o conteúdo do Excel já foi parseado e gravado em `funcionarios`/`empresas`/`municipios`. O arquivo armazenado é apenas backup/auditoria, **nunca é lido de volta** pelo sistema (busca em todo o código não retornou nenhum `.download()` nem `.createSignedUrl()` para esse bucket)
- **Tratamento de falha**: já retorna `null` graciosamente se o upload falhar

### Bucket `generated-documents` — **não é usado pelo código**
- Existe nas migrations (`20260226114134...sql`, `20260306101406...sql`) com policies por `auth.uid()`
- **Zero referências** no código TypeScript (`grep` não encontrou nada)
- Confirma a política de memória do projeto: *"Generated PDFs are not stored in the cloud; they are provided for immediate local download in ZIP format"*
- É código morto / vestígio histórico

### Outros usos de "storage" no código (falsos positivos)
- `src/integrations/supabase/client.ts:13` → `storage: localStorage` (config de auth, não Storage do Supabase)

## Impacto de remover

| Área | Impacto | Mitigação |
|---|---|---|
| Upload do Excel | Arquivo original deixa de ser persistido | Coluna `excel_upload_history.file_name` continua registrando o nome; já é suficiente para auditoria |
| `excel_upload_history.file_path` | Vira sempre `NULL` | Tornar coluna opcional / remover (já é nullable) |
| `generated-documents` | Nenhum | Já não é usado |
| Migração para VPS Hostinger | **Simplifica muito** — não precisa migrar buckets, scripts de export/import de storage, nem volumes Docker do Supabase Storage | — |
| RLS / Auth | Nenhum | policies de storage são removidas, nada mais depende delas |
| UI / UX | Nenhum | usuário não baixa/visualiza arquivos do Storage em nenhuma tela |

## Plano de remoção

### 1. Código (`src/lib/supabaseExcelSync.ts`)
- Remover função `uploadExcelFile()` (linhas 43-58)
- Remover chamada `filePath = await uploadExcelFile(file)` (linha 434) e a variável `filePath`
- Em `logUploadHistory()`: remover parâmetro `filePath` e o campo `file_path` do insert
- Atualizar a chamada em `syncSpreadsheetToDatabase` para não passar `filePath`

### 2. Banco de dados (migration)
- `ALTER TABLE excel_upload_history DROP COLUMN file_path;` (opcional, mas limpa)
- Remover policies de storage:
  - `DROP POLICY ... ON storage.objects` para `excel-uploads` e `generated-documents`
- Remover os buckets:
  - `DELETE FROM storage.buckets WHERE id IN ('excel-uploads', 'generated-documents');`

> Os arquivos físicos dentro dos buckets serão apagados em cascata pela exclusão dos buckets.

### 3. Guia de migração para VPS
- Atualizar `MIGRACAO_VPS_HOSTINGER.md` para:
  - Remover seção 5.4/5.5 (recriar buckets, reupload de arquivos)
  - Remover Anexos B (`export-storage.mjs`) e D (`import-storage.mjs`)
  - Remover `tar` do volume `storage` no script de backup (Fase 9)
  - Reduzir requisito de disco do VPS

### 4. Tipos do Supabase
- `src/integrations/supabase/types.ts` é regenerado automaticamente após a migration — sem ação manual

## Arquivos alterados

- `src/lib/supabaseExcelSync.ts` — remover upload e referências a `filePath`
- **Migration nova** — drop de policies, buckets e coluna `file_path`
- `/mnt/documents/MIGRACAO_VPS_HOSTINGER.md` — versão simplificada (gerar `_v2`)

## Benefícios

1. **Migração para VPS muito mais simples** — um componente a menos para operar e fazer backup
2. **Menor consumo de armazenamento** no Supabase Cloud atual e no VPS futuro
3. **Menos superfície de risco** (policies de storage, signed URLs, buckets públicos vs privados)
4. **Código mais enxuto** — remove código morto (`generated-documents`) e código sem propósito real (`excel-uploads`)
5. **Política já documentada** alinha com a memória *"local processing only / no server-side storage"*

## Riscos

- **Perda do histórico físico das planilhas Excel já enviadas**. Se quiser preservar os arquivos antigos antes de apagar os buckets, fazer um download manual via Studio → Storage antes de rodar a migration.
- Nenhum outro risco identificado — não há leitura ativa desses arquivos em nenhum lugar.

## Recomendação

✅ **Remover Storage** antes da migração para VPS. Reduz complexidade da migração em ~30% e elimina código morto. Avise se quer baixar manualmente o conteúdo de `excel-uploads` antes (histórico de planilhas) ou se pode descartar.
