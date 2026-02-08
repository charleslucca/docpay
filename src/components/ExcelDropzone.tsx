import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'framer-motion';
import { FileSpreadsheet, Upload, X, Check, Building2, MapPin, Users, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { parseExcelFile, type SpreadsheetData } from '@/lib/excelUtils';

interface ExcelDropzoneProps {
  spreadsheetData: SpreadsheetData | null;
  onSpreadsheetLoaded: (data: SpreadsheetData) => void;
  onSpreadsheetRemoved: () => void;
  disabled?: boolean;
}

export function ExcelDropzone({
  spreadsheetData,
  onSpreadsheetLoaded,
  onSpreadsheetRemoved,
  disabled = false,
}: ExcelDropzoneProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCidades, setShowCidades] = useState(false);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    const file = acceptedFiles[0];
    setIsLoading(true);
    setError(null);

    try {
      const data = await parseExcelFile(file);
      onSpreadsheetLoaded(data);
    } catch (err) {
      console.error('[ExcelDropzone] Error:', err);
      setError(err instanceof Error ? err.message : 'Erro ao processar planilha');
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
    disabled: disabled || isLoading,
  });

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSpreadsheetRemoved();
    setError(null);
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
                  disabled={disabled}
                  className="h-8 w-8"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

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
                            {cidade}
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
