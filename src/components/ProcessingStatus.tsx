import { motion } from 'framer-motion';
import { Loader2, CheckCircle, Upload, Search, FileOutput, Sparkles } from 'lucide-react';
import { ProcessingStatus as ProcessingStatusType } from '@/types/document';
import { Progress } from '@/components/ui/progress';

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

export function ProcessingStatus({ status }: ProcessingStatusProps) {
  const config = stepConfig[status.step];
  const Icon = config.icon;
  const isActive = status.step !== 'idle' && status.step !== 'completed';

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

      {status.step !== 'idle' && (
        <div className="space-y-2">
          <Progress value={status.progress} className="h-2" />
          <p className="text-xs text-muted-foreground text-right">
            {Math.round(status.progress)}%
          </p>
        </div>
      )}

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
