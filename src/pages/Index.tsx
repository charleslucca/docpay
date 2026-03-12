import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles, RotateCcw, Play, StopCircle,
  ArrowLeft, ArrowRight, FolderOpen, History,
} from 'lucide-react';
import { useDocumentProcessor } from '@/hooks/useDocumentProcessor';
import { FileDropzone } from '@/components/FileDropzone';
import { ExcelDropzone } from '@/components/ExcelDropzone';
import { ProcessingStatus } from '@/components/ProcessingStatus';

import { ProcessingHistory } from '@/components/ProcessingHistory';
import { UnprocessedList } from '@/components/UnprocessedList';
import { ResumeProcessingDialog } from '@/components/ResumeProcessingDialog';
import { StepIndicator } from '@/components/StepIndicator';
import { Button } from '@/components/ui/button';

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 200 : -200,
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({
    x: direction < 0 ? 200 : -200,
    opacity: 0,
  }),
};

const Index = () => {
  const {
    holerites, comprovantes, matchedPairs, generatedDocs, unprocessedList, spreadsheetData,
    setSpreadsheetData, status, isCancelling, hasSavedState, isCheckingState,
    addFiles, removeFile, processDocuments, generatePdfs, cancelProcessing,
    reset, resumeProcessing, discardSavedState, reprocessWithEnhancedOcr,
  } = useDocumentProcessor();

  const [currentStep, setCurrentStep] = useState(1);
  const [direction, setDirection] = useState(0);
  const [syncComplete, setSyncComplete] = useState(false);
  const [showRepository, setShowRepository] = useState(false);

  const completedSteps: number[] = [];
  if (spreadsheetData && syncComplete) completedSteps.push(1);
  if (holerites.length > 0 && comprovantes.length > 0) completedSteps.push(2);
  if (matchedPairs.length > 0) completedSteps.push(3);
  if (generatedDocs.length > 0) completedSteps.push(4);

  const isProcessing = ['extracting', 'matching', 'generating'].includes(status.step);

  const canAdvanceStep1 = spreadsheetData !== null && syncComplete;
  const canAdvanceStep2 = holerites.length > 0 && comprovantes.length > 0;

  // Auto-advance to step 4 when generation completes
  useEffect(() => {
    if (status.step === 'completed' && currentStep === 3 && generatedDocs.length > 0) {
      goToStep(4);
    }
  }, [status.step, generatedDocs.length]);

  const goToStep = (step: number) => {
    setDirection(step > currentStep ? 1 : -1);
    setCurrentStep(step);
  };

  const handleReset = () => {
    reset();
    setSyncComplete(false);
    setShowRepository(false);
    goToStep(1);
  };

  if (showRepository) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="outline" size="sm" onClick={() => setShowRepository(false)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar
          </Button>
          <h2 className="text-xl font-semibold text-foreground">Histórico de Processamento</h2>
        </div>
        <ProcessingHistory />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1">
      <ResumeProcessingDialog
        open={hasSavedState && !isCheckingState}
        onResume={resumeProcessing}
        onDiscard={discardSavedState}
      />

      {/* Top action bar */}
      <div className="container mx-auto px-4 pt-4 flex items-center gap-2 justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowRepository(true)}
          className="gap-2"
        >
          <FolderOpen className="h-4 w-4" />
          <span className="hidden sm:inline">Histórico</span>
          {generatedDocs.length > 0 && (
            <span className="h-5 w-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center">
              {generatedDocs.length}
            </span>
          )}
        </Button>
        {(currentStep > 1 || holerites.length > 0 || comprovantes.length > 0) && (
          <Button variant="outline" size="sm" onClick={handleReset} disabled={isProcessing}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Recomeçar
          </Button>
        )}
      </div>

      <main className="container mx-auto px-4 py-8 flex-1">
        <div className="mb-8">
          <StepIndicator currentStep={currentStep} completedSteps={completedSteps} />
        </div>

        <AnimatePresence mode="wait" custom={direction}>
          {currentStep === 1 && (
            <motion.div
              key="step1"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25 }}
              className="max-w-4xl mx-auto space-y-6"
            >
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold text-foreground">Enviar Planilha</h2>
                <p className="text-muted-foreground text-sm">
                  Envie a planilha Excel com os dados dos funcionários, empresas e valores.
                </p>
              </div>

              <ExcelDropzone
                spreadsheetData={spreadsheetData}
                onSpreadsheetLoaded={setSpreadsheetData}
                onSpreadsheetRemoved={() => {
                  setSpreadsheetData(null);
                  setSyncComplete(false);
                }}
                onSyncComplete={() => setSyncComplete(true)}
                disabled={isProcessing}
              />

              <div className="flex justify-end">
                <Button
                  size="lg"
                  onClick={() => goToStep(2)}
                  disabled={!canAdvanceStep1}
                  className="gap-2"
                >
                  Próximo
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </motion.div>
          )}

          {currentStep === 2 && (
            <motion.div
              key="step2"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25 }}
              className="space-y-6"
            >
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold text-foreground">Upload de Documentos</h2>
                <p className="text-muted-foreground text-sm">
                  Envie os holerites e comprovantes de pagamento em PDF.
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="rounded-xl border bg-card p-6 shadow-sm">
                  <FileDropzone
                    title="Holerites"
                    description="Recibos de pagamento dos funcionários"
                    files={holerites}
                    onFilesAdded={(files) => addFiles(files, 'holerite')}
                    onFileRemove={(id) => removeFile(id, 'holerite')}
                    disabled={isProcessing}
                  />
                </div>
                <div className="rounded-xl border bg-card p-6 shadow-sm">
                  <FileDropzone
                    title="Comprovantes"
                    description="Comprovantes de pagamento bancário"
                    files={comprovantes}
                    onFilesAdded={(files) => addFiles(files, 'comprovante')}
                    onFileRemove={(id) => removeFile(id, 'comprovante')}
                    disabled={isProcessing}
                  />
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="outline" size="lg" onClick={() => goToStep(1)} className="gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  Voltar
                </Button>
                <Button
                  size="lg"
                  onClick={() => goToStep(3)}
                  disabled={!canAdvanceStep2}
                  className="gap-2"
                >
                  Próximo
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </motion.div>
          )}

          {currentStep === 3 && (
            <motion.div
              key="step3"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25 }}
              className="space-y-6"
            >
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold text-foreground">Processamento</h2>
                <p className="text-muted-foreground text-sm">
                  Extraia dados, encontre correspondências e gere os PDFs.
                </p>
              </div>

              {/* Action buttons */}
              <div className="flex justify-center gap-4 flex-wrap">
                {status.step === 'idle' && (
                  <Button
                    size="lg"
                    onClick={processDocuments}
                    className="gradient-primary shadow-lg hover:shadow-xl transition-shadow gap-2"
                  >
                    <Play className="h-5 w-5" />
                    Iniciar Processamento
                  </Button>
                )}
                {matchedPairs.length > 0 && matchedPairs.some((p) => p.status === 'pending') && (
                  <Button
                    size="lg"
                    onClick={generatePdfs}
                    className="gradient-primary shadow-lg hover:shadow-xl transition-shadow gap-2"
                  >
                    <Sparkles className="h-5 w-5" />
                    Gerar PDFs ({matchedPairs.filter((p) => p.status === 'pending').length})
                  </Button>
                )}
              </div>

              {/* Processing status */}
              {status.step !== 'idle' && (
                <div className="space-y-4">
                  <ProcessingStatus
                    status={status}
                    onReset={reset}
                  />
                  {isProcessing && (
                    <div className="flex justify-center">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={async () => {
                          await cancelProcessing();
                          setSyncComplete(false);
                          setShowRepository(false);
                          goToStep(1);
                        }}
                        disabled={isCancelling}
                      >
                        <StopCircle className="h-4 w-4 mr-2" />
                        {isCancelling ? 'Cancelando...' : 'Cancelar Processamento'}
                      </Button>
                    </div>
                  )}
                </div>
              )}


              <div className="flex justify-between">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => goToStep(2)}
                  disabled={isProcessing}
                  className="gap-2"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Voltar
                </Button>
                {generatedDocs.length > 0 && (
                  <Button size="lg" onClick={() => goToStep(4)} className="gap-2">
                    Ver Resultados
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </motion.div>
          )}

          {currentStep === 4 && (
            <motion.div
              key="step4"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25 }}
              className="space-y-6"
            >
              <div className="text-center space-y-2">
                <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-primary/10 mb-2">
                  <Sparkles className="h-8 w-8 text-primary" />
                </div>
                <h2 className="text-2xl font-bold text-foreground">Documentos Gerados</h2>
            <p className="text-muted-foreground text-sm">
                  {generatedDocs.length} documento(s) gerado(s) com sucesso.
               </p>
              </div>

              {unprocessedList.length > 0 && (
                <UnprocessedList items={unprocessedList} totalProcessed={generatedDocs.length} />
              )}

              <div className="flex justify-center gap-4 flex-wrap">
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => setShowRepository(true)}
                  className="gap-2"
                >
              <History className="h-5 w-5" />
              Ver Histórico
                </Button>
                <Button size="lg" onClick={handleReset} className="gap-2">
                  <RotateCcw className="h-4 w-4" />
                  Recomeçar
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="border-t bg-card/50 mt-auto">
        <div className="container mx-auto px-4 py-4">
          <p className="text-center text-sm text-muted-foreground">
            Processamento 100% local • Seus documentos não saem do navegador
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
