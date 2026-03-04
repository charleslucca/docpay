import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Step {
  number: number;
  label: string;
}

const steps: Step[] = [
  { number: 1, label: 'Planilha' },
  { number: 2, label: 'Arquivos' },
  { number: 3, label: 'Processar' },
  { number: 4, label: 'Resultado' },
];

interface StepIndicatorProps {
  currentStep: number;
  completedSteps: number[];
}

export function StepIndicator({ currentStep, completedSteps }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center w-full max-w-2xl mx-auto">
      {steps.map((step, index) => {
        const isCompleted = completedSteps.includes(step.number);
        const isCurrent = currentStep === step.number;
        const isLast = index === steps.length - 1;

        return (
          <div key={step.number} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  'h-10 w-10 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-all duration-300',
                  isCompleted
                    ? 'bg-primary border-primary text-primary-foreground'
                    : isCurrent
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-muted-foreground/30 bg-muted/50 text-muted-foreground'
                )}
              >
                {isCompleted ? <Check className="h-5 w-5" /> : step.number}
              </div>
              <span
                className={cn(
                  'text-xs font-medium hidden sm:block transition-colors',
                  isCurrent ? 'text-primary' : isCompleted ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div
                className={cn(
                  'flex-1 h-0.5 mx-2 sm:mx-3 rounded-full transition-colors duration-300 mt-[-1.25rem] sm:mt-[-1.75rem]',
                  isCompleted ? 'bg-primary' : 'bg-muted-foreground/20'
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
