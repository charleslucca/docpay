import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, CheckCircle, Upload, Search, FileOutput, Sparkles, Clock, AlertTriangle, FileText, Cpu, Link2 } from 'lucide-react';
import { ProcessingStatus as ProcessingStatusType } from '@/types/document';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getWorkerCount, isOcrWorkerReady } from '@/lib/ocrUtils';

interface ProcessingStatusProps {
  status: ProcessingStatusType;
}

const stepConfig = {
  idle: { icon: Upload, label: 'Aguardando arquivos', color: 'text-muted-foreground' },
  uploading: { icon: Upload, label: 'Enviando arquivos', color: 'text-info' },
  extracting: { icon: Search, label: 'Extraindo nomes', color: 'text-primary' },
  matching: { icon: Search, label: 'Buscando correspondências', color: 'text-primary' },
  generating: { icon: FileOutput, label: 'Gerando PDFs', color: 'text-primary' },
  completed: { icon: CheckCircle, label: 'Concluído', color: 'text-primary' },
};

function formatTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export function ProcessingStatus({ status }: ProcessingStatusProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  
  const config = stepConfig[status.step];
  const Icon = config.icon;
  const isActive = status.step !== 'idle' && status.step !== 'completed';

  // Real-time elapsed time counter
  useEffect(() => {
    if (!isActive || !status.startTime) {
      setElapsedSeconds(0);
      return;
    }

    const updateElapsed = () => {
      const elapsed = Math.floor((Date.now() - status.startTime!) / 1000);
      setElapsedSeconds(elapsed);
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [isActive, status.startTime]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border bg-card p-6 shadow-sm"
    >
      <div className="flex items-center gap-4 mb-4">
        <div className={`rounded-full p-3 ${status.step === 'completed' ? 'bg-primary/10' : 'bg-muted'}`}>
          {isActive ? (
            <Loader2 className={`h-6 w-6 animate-spin ${config.color}`} />
          ) : (
            <Icon className={`h-6 w-6 ${config.color}`} />
          )}
        </div>
        <div className="flex-1">
          <h4 className="font-semibold text-foreground">{config.label}</h4>
          <p className="text-sm text-muted-foreground">{status.message}</p>
        </div>
        {status.step === 'completed' && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="flex items-center gap-1 text-primary"
          >
            <Sparkles className="h-4 w-4" />
            <span className="text-sm font-medium">Pronto!</span>
          </motion.div>
        )}
      </div>

      {/* Current file being processed */}
      {isActive && status.currentItem && (
        <motion.div 
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="flex items-center gap-2 mb-3 p-2 rounded-lg bg-muted/50"
        >
          <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span className="text-sm text-muted-foreground truncate">
            Processando: <span className="text-foreground font-medium">{status.currentItem}</span>
          </span>
          {status.processedItems !== undefined && status.totalItems !== undefined && (
            <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">
              {status.processedItems} de {status.totalItems}
            </span>
          )}
        </motion.div>
      )}

      {/* Saving indicator */}
      {status.isSaving && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-2 mb-3 px-2"
        >
          <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
          <span className="text-xs text-muted-foreground">Salvando progresso...</span>
        </motion.div>
      )}

      {status.step !== 'idle' && (
        <div className="space-y-2">
          <Progress value={status.progress} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{Math.round(status.progress)}%</span>
            {status.isOcrActive && status.ocrProgress !== undefined && (
              <span className="text-primary font-medium">OCR: {status.ocrProgress}%</span>
            )}
          </div>
        </div>
      )}

      {/* Secondary OCR progress bar with worker indicator */}
      {status.isOcrActive && status.ocrProgress !== undefined && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mt-2 space-y-1"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Reconhecimento OCR:</span>
            {isOcrWorkerReady() && (
              <div className="flex items-center gap-1.5">
                <Cpu className="h-3 w-3 text-primary" />
                <span className="text-xs font-medium text-primary">
                  {getWorkerCount()} workers ativos
                </span>
                <div className="flex gap-0.5">
                  {Array.from({ length: getWorkerCount() }).map((_, i) => (
                    <motion.div
                      key={i}
                      className="h-2 w-2 rounded-full bg-primary"
                      animate={{ 
                        opacity: [0.4, 1, 0.4],
                        scale: [0.8, 1, 0.8]
                      }}
                      transition={{ 
                        duration: 1.2,
                        repeat: Infinity,
                        delay: i * 0.15
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
          <Progress value={status.ocrProgress} className="h-1.5 bg-primary/20" />
        </motion.div>
      )}

      {/* Matches found indicator during matching */}
      {status.step === 'matching' && status.matchesFound !== undefined && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mt-3 flex items-center justify-center gap-3 p-3 rounded-lg bg-primary/10 border border-primary/20"
        >
          <div className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-primary" />
            <span className="text-lg font-bold text-primary">{status.matchesFound}</span>
          </div>
          <span className="text-sm text-muted-foreground">
            correspondência{status.matchesFound !== 1 ? 's' : ''} encontrada{status.matchesFound !== 1 ? 's' : ''}
            {status.totalToMatch !== undefined && (
              <span className="text-xs ml-1">
                (de {status.totalToMatch} funcionário{status.totalToMatch !== 1 ? 's' : ''})
              </span>
            )}
          </span>
        </motion.div>
      )}

      {/* Time information */}
      {isActive && status.startTime && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-4 grid grid-cols-2 gap-4"
        >
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Tempo decorrido</p>
              <p className="text-sm font-medium text-foreground">{formatTime(elapsedSeconds)}</p>
            </div>
          </div>
          
          {status.estimatedTimeRemaining !== undefined && status.estimatedTimeRemaining > 0 && (
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              <div>
                <p className="text-xs text-muted-foreground">Tempo estimado</p>
                <p className="text-sm font-medium text-primary">~{formatTime(status.estimatedTimeRemaining)}</p>
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* Slow operation warning */}
      <AnimatePresence>
        {status.isSlowOperation && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4"
          >
            <Alert variant="destructive" className="border-destructive/50 bg-destructive/10">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <AlertDescription className="text-destructive">
                <strong>Atenção:</strong> Extração lenta detectada (mais de 10s). 
                O documento pode estar escaneado ou ser muito grande.
              </AlertDescription>
            </Alert>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Step indicators */}
      <div className="mt-6 flex justify-between">
        {(['extracting', 'matching', 'generating', 'completed'] as const).map((step, index) => {
          const stepIndex = ['extracting', 'matching', 'generating', 'completed'].indexOf(status.step);
          const currentStepIndex = index;
          const isCompleted = stepIndex > currentStepIndex || (stepIndex === currentStepIndex && status.step === 'completed');
          const isCurrent = status.step === step && status.step !== 'completed';

          return (
            <div key={step} className="flex flex-col items-center gap-2">
              <div
                className={`h-3 w-3 rounded-full transition-colors ${
                  isCompleted
                    ? 'bg-primary'
                    : isCurrent
                    ? 'bg-primary/50 animate-pulse'
                    : 'bg-muted'
                }`}
              />
              <span className={`text-xs ${isCompleted || isCurrent ? 'text-foreground' : 'text-muted-foreground'}`}>
                {step === 'extracting' && 'Extração'}
                {step === 'matching' && 'Match'}
                {step === 'generating' && 'Geração'}
                {step === 'completed' && 'Concluído'}
              </span>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
