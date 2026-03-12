import { useCallback, useState, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'framer-motion';
import { FileSpreadsheet, Upload, X, Check, Building2, MapPin, Users, ChevronDown, ChevronUp, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { parseExcelFile, type SpreadsheetData, type ValidationResult } from '@/lib/excelUtils';
import { syncSpreadsheetToDatabase, type SyncResult, type SyncProgress } from '@/lib/supabaseExcelSync';

interface ExcelDropzoneProps {
  spreadsheetData: SpreadsheetData | null;
  onSpreadsheetLoaded: (data: SpreadsheetData) => void;
  onSpreadsheetRemoved: () => void;
  onSyncComplete?: () => void;
  disabled?: boolean;
}

type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

export function ExcelDropzone({
  spreadsheetData,
  onSpreadsheetLoaded,
  onSpreadsheetRemoved,
  onSyncComplete,
  disabled = false,
}: ExcelDropzoneProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCidades, setShowCidades] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [previewData, setPreviewData] = useState<SpreadsheetData | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const fileRef = useRef<File | null>(null);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    const file = acceptedFiles[0];
    fileRef.current = file;
    setIsLoading(true);
    setError(null);
    setSyncStatus('idle');
    setSyncResult(null);
    setPreviewData(null);
    setValidationResult(null);

    try {
      const { data, validation } = await parseExcelFile(file);
      setValidationResult(validation);

      if (!validation.valid) {
        // Show validation error but still set preview if we got data
        setPreviewData(data);
        onSpreadsheetLoaded(data);
      } else {
        // Valid structure - show preview for confirmation
        setPreviewData(data);
        onSpreadsheetLoaded(data);
      }
    } catch (err) {
      console.error('[ExcelDropzone] Error:', err);
      setError(err instanceof Error ? err.message : 'Erro ao processar planilha');
    } finally {
      setIsLoading(false);
    }
  }, [onSpreadsheetLoaded]);

  const handleConfirmImport = async () => {
    if (!previewData || !fileRef.current) return;

    setSyncStatus('syncing');
    setSyncProgress(null);

    try {
      const result = await syncSpreadsheetToDatabase(previewData, fileRef.current, (progress) => {
        setSyncProgress(progress);
      });

      if (result.success) {
        setSyncStatus('success');
        setSyncResult(result);
        setSyncProgress(null);
        setPreviewData(null);
        onSyncComplete?.();
      } else {
        setSyncStatus('error');
        setSyncResult(result);
        setSyncProgress(null);
      }
    } catch (err) {
      console.error('[ExcelDropzone] Sync error:', err);
      setSyncStatus('error');
      setSyncResult({
        success: false,
        error: err instanceof Error ? err.message : 'Erro ao sincronizar',
        stats: { empresas: 0, municipios: 0, funcionariosNovos: 0, funcionariosAtualizados: 0, funcionariosRemovidos: 0, totalFuncionarios: 0 },
      });
      setSyncProgress(null);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
    maxFiles: 1,
    disabled: disabled || isLoading || syncStatus === 'syncing',
  });

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSpreadsheetRemoved();
    setError(null);
    setSyncStatus('idle');
    setSyncResult(null);
    setSyncProgress(null);
    setPreviewData(null);
    setValidationResult(null);
    fileRef.current = null;
  };

  const getProgressPercentage = (): number => {
    if (!syncProgress) return 0;
    switch (syncProgress.stage) {
      case 'uploading': return 10;
      case 'syncing-empresas': return 25;
      case 'syncing-municipios': return 40;
      case 'syncing-funcionarios': return 70;
      case 'finalizing': return 95;
      default: return 0;
    }
  };

  const renderValidationAlert = () => {
    if (!validationResult || validationResult.valid) return null;

    return (
      <Alert variant="destructive" className="mb-3">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Estrutura de colunas inválida</AlertTitle>
        <AlertDescription>
          <p className="mb-2">
            A planilha deve conter uma aba "Todos" com as seguintes colunas:
          </p>
          <div className="flex flex-wrap gap-1 mb-2">
            {['EMPRESA', 'CIDADE', 'CONTRATO', 'COLABORADOR', 'TOTAL FUNCIONARIOS', 'BANCO', 'TIPO'].map((col) => (
              <Badge
                key={col}
                variant={validationResult.missingColumns.includes(col) ? 'destructive' : 'secondary'}
                className="text-xs"
              >
                {col}
              </Badge>
            ))}
          </div>
          {validationResult.missingColumns.length > 0 && (
            <p className="text-xs">
              Colunas faltantes: <strong>{validationResult.missingColumns.join(', ')}</strong>
            </p>
          )}
          <p className="text-xs mt-1 text-muted-foreground">
            Os dados foram importados usando o formato alternativo (abas por município).
          </p>
        </AlertDescription>
      </Alert>
    );
  };

  const renderPreviewTable = () => {
    if (!previewData || syncStatus === 'success') return null;

    const displayRecords = previewData.records.slice(0, 20);
    const hasMore = previewData.records.length > 20;

    return (
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-3"
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">
            Preview: {previewData.records.length} funcionários encontrados
          </p>
        </div>

        <ScrollArea className="h-[400px] rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-semibold">EMPRESA</TableHead>
                <TableHead className="text-xs font-semibold">CIDADE</TableHead>
                <TableHead className="text-xs font-semibold">CONTRATO</TableHead>
                <TableHead className="text-xs font-semibold">COLABORADOR</TableHead>
                <TableHead className="text-xs font-semibold text-center">TOTAL</TableHead>
                <TableHead className="text-xs font-semibold">BANCO</TableHead>
                <TableHead className="text-xs font-semibold">TIPO</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayRecords.map((record, idx) => (
                <TableRow key={idx}>
                  <TableCell className="text-sm py-2.5 px-3">{record.empresa}</TableCell>
                  <TableCell className="text-sm py-2.5 px-3">{record.cidade}</TableCell>
                  <TableCell className="text-sm py-2.5 px-3">{record.contrato}</TableCell>
                  <TableCell className="text-sm py-2.5 px-3">{record.colaborador}</TableCell>
                  <TableCell className="text-sm py-2.5 px-3 text-center">{record.totalFuncionarios ?? idx + 1}</TableCell>
                  <TableCell className="text-sm py-2.5 px-3">{record.banco || '-'}</TableCell>
                  <TableCell className="text-sm py-2.5 px-3">{record.tipo || '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>

        {hasMore && (
          <p className="text-xs text-muted-foreground text-center">
            Mostrando 20 de {previewData.records.length} registros
          </p>
        )}

        <div className="flex gap-2 justify-end">
          <Button
            variant="outline"
            size="default"
            onClick={handleRemove}
            disabled={syncStatus === 'syncing'}
          >
            Cancelar
          </Button>
          <Button
            size="default"
            onClick={handleConfirmImport}
            disabled={syncStatus === 'syncing'}
          >
            {syncStatus === 'syncing' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Importando...
              </>
            ) : (
              'Confirmar Importação'
            )}
          </Button>
        </div>
      </motion.div>
    );
  };

  const renderSyncStatus = () => {
    if (syncStatus === 'idle') return null;

    return (
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        className={`p-3 rounded-lg border ${
          syncStatus === 'syncing' ? 'bg-muted/50 border-muted' :
          syncStatus === 'success' ? 'bg-accent/50 border-accent' :
          'bg-destructive/10 border-destructive/30'
        }`}
      >
        <div className="flex flex-col gap-2">
          {syncStatus === 'syncing' && (
            <>
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm font-medium">
                  {syncProgress?.message || 'Sincronizando...'}
                </span>
              </div>
              <Progress value={getProgressPercentage()} className="h-2" />
            </>
          )}
          {syncStatus === 'success' && syncResult && (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <div className="text-sm">
                <span className="font-medium text-primary">Sincronizado!</span>
                <span className="text-muted-foreground ml-2">
                  {syncResult.stats.funcionariosNovos} novos
                  {syncResult.stats.funcionariosAtualizados > 0 && `, ${syncResult.stats.funcionariosAtualizados} atualizados`}
                  {syncResult.stats.funcionariosRemovidos > 0 && `, ${syncResult.stats.funcionariosRemovidos} removidos`}
                </span>
              </div>
            </div>
          )}
          {syncStatus === 'error' && syncResult && (
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-destructive" />
              <span className="text-sm text-destructive">
                {syncResult.error || 'Erro ao sincronizar'}
              </span>
            </div>
          )}
        </div>
      </motion.div>
    );
  };

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5 text-primary" />
          Planilha de Funcionários
        </CardTitle>
      </CardHeader>
      <CardContent>
        <AnimatePresence mode="wait">
          {spreadsheetData ? (
            <motion.div
              key="loaded"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-5"
            >
              <div className="flex items-center justify-between p-3 rounded-lg bg-primary/10 border border-primary/20">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
                    <Check className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium truncate max-w-[400px]">
                      {spreadsheetData.fileName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Planilha carregada
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleRemove}
                  disabled={disabled || syncStatus === 'syncing'}
                  className="h-8 w-8"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {renderValidationAlert()}
              {renderPreviewTable()}
              {renderSyncStatus()}

              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="p-4 rounded-lg bg-muted/50">
                  <Users className="h-5 w-5 mx-auto mb-1.5 text-muted-foreground" />
                  <p className="text-2xl font-semibold">{spreadsheetData.records.length}</p>
                  <p className="text-xs text-muted-foreground">Funcionários</p>
                </div>
                <div className="p-4 rounded-lg bg-muted/50">
                  <Building2 className="h-5 w-5 mx-auto mb-1.5 text-muted-foreground" />
                  <p className="text-2xl font-semibold">{spreadsheetData.empresas.length}</p>
                  <p className="text-xs text-muted-foreground">Empresas</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCidades(!showCidades)}
                  className="p-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer"
                >
                  <MapPin className="h-5 w-5 mx-auto mb-1.5 text-muted-foreground" />
                  <p className="text-2xl font-semibold flex items-center justify-center gap-1">
                    {spreadsheetData.cidades.length}
                    {showCidades ? (
                      <ChevronUp className="h-3 w-3 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">Cidades</p>
                </button>
              </div>

              <AnimatePresence>
                {showCidades && spreadsheetData.cidades.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                      <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        Cidades encontradas:
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {spreadsheetData.cidades.map((cidade) => (
                          <Badge
                            key={cidade}
                            variant="secondary"
                            className="text-xs font-normal"
                          >
                            {cidade} ({spreadsheetData.funcionariosPorCidade[cidade] || 0})
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div
                {...getRootProps()}
                className={`
                  border-2 border-dashed rounded-lg p-6 text-center cursor-pointer
                  transition-colors duration-200
                  ${isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}
                  ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
                  ${error ? 'border-destructive/50' : ''}
                `}
              >
                <input {...getInputProps()} />
                <div className="flex flex-col items-center gap-2">
                  {isLoading ? (
                    <>
                      <div className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                      <p className="text-sm text-muted-foreground">Processando planilha...</p>
                    </>
                  ) : (
                    <>
                      <Upload className="h-8 w-8 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">
                          {isDragActive ? 'Solte aqui' : 'Arraste a planilha ou clique'}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Suporta .xlsx e .xls
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>
              {error && (
                <p className="text-xs text-destructive mt-2 text-center">{error}</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}
