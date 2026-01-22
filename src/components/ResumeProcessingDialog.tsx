import { useState, useEffect } from 'react';
import { AlertCircle, FileText, Clock, RotateCcw, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { getProcessingSummary, clearProcessingState } from '@/lib/processingPersistence';

interface ProcessingSummary {
  fileName: string;
  progress: number;
  totalPages: number;
  currentPage: number;
  startedAt: Date;
  status: string;
}

interface ResumeProcessingDialogProps {
  open: boolean;
  onResume: () => void;
  onDiscard: () => void;
}

export function ResumeProcessingDialog({ open, onResume, onDiscard }: ResumeProcessingDialogProps) {
  const [summary, setSummary] = useState<ProcessingSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (open) {
      loadSummary();
    }
  }, [open]);

  const loadSummary = async () => {
    setIsLoading(true);
    try {
      const data = await getProcessingSummary();
      setSummary(data);
    } catch (error) {
      console.error('Error loading processing summary:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDiscard = async () => {
    await clearProcessingState();
    onDiscard();
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'extracting':
        return 'Extração OCR';
      case 'matching':
        return 'Correspondência';
      case 'generating':
        return 'Geração de PDFs';
      default:
        return status;
    }
  };

  if (isLoading || !summary) {
    return null;
  }

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-full bg-warning/20 flex items-center justify-center">
              <AlertCircle className="h-5 w-5 text-warning" />
            </div>
            <AlertDialogTitle className="text-left">
              Processamento Pendente
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription asChild>
            <div className="space-y-4 text-left">
              <p className="text-muted-foreground">
                Encontramos um processamento que foi interrompido. Deseja continuar de onde parou?
              </p>
              
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium truncate">{summary.fileName}</span>
                </div>
                
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Progresso: {summary.currentPage} de {summary.totalPages} páginas</span>
                    <span>{summary.progress}%</span>
                  </div>
                  <Progress value={summary.progress} className="h-2" />
                </div>
                
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    <span>
                      {formatDistanceToNow(summary.startedAt, { 
                        addSuffix: true, 
                        locale: ptBR 
                      })}
                    </span>
                  </div>
                  <span className="text-primary font-medium">
                    {getStatusLabel(summary.status)}
                  </span>
                </div>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={handleDiscard}
            className="flex-1"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Descartar e Recomeçar
          </Button>
          <Button
            onClick={onResume}
            className="flex-1 gradient-primary"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Retomar Processamento
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
