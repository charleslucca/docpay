import { useCallback, useState, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'framer-motion';
import { FileSpreadsheet, Upload, X, Check, Building2, MapPin, Users, ChevronDown, ChevronUp, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { parseExcelFile, type SpreadsheetData } from '@/lib/excelUtils';
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
  disabled = false,
}: ExcelDropzoneProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCidades, setShowCidades] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const fileRef = useRef<File | null>(null);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    const file = acceptedFiles[0];
    fileRef.current = file;
    setIsLoading(true);
    setError(null);
    setSyncStatus('idle');
    setSyncResult(null);

    try {
      const data = await parseExcelFile(file);
      onSpreadsheetLoaded(data);

      // Automatically sync to database after parsing with progress tracking
      setSyncStatus('syncing');
      setSyncProgress(null);
      
      const result = await syncSpreadsheetToDatabase(data, file, (progress) => {
        setSyncProgress(progress);
      });
      
      if (result.success) {
        setSyncStatus('success');
        setSyncResult(result);
        setSyncProgress(null);
      } else {
        setSyncStatus('error');
        setSyncResult(result);
        setSyncProgress(null);
        setSyncResult(result);
      }
    } catch (err) {
      console.error('[ExcelDropzone] Error:', err);
      setError(err instanceof Error ? err.message : 'Erro ao processar planilha');
      setSyncStatus('idle');
    } finally {
      setIsLoading(false);
    }
  }, [onSpreadsheetLoaded]);

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
          <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
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
              className="space-y-3"
            >
              <div className="flex items-center justify-between p-3 rounded-lg bg-primary/10 border border-primary/20">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
                    <Check className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium truncate max-w-[200px]">
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

              {renderSyncStatus()}

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 rounded-lg bg-muted/50">
                  <Users className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                  <p className="text-lg font-semibold">{spreadsheetData.records.length}</p>
                  <p className="text-xs text-muted-foreground">Funcionários</p>
                </div>
                <div className="p-2 rounded-lg bg-muted/50">
                  <Building2 className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                  <p className="text-lg font-semibold">{spreadsheetData.empresas.length}</p>
                  <p className="text-xs text-muted-foreground">Empresas</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCidades(!showCidades)}
                  className="p-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer"
                >
                  <MapPin className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                  <p className="text-lg font-semibold flex items-center justify-center gap-1">
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
