import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText, Sparkles, RotateCcw, Play, Zap, StopCircle,
  UserCircle, LogOut, User, Shield, ArrowLeft, ArrowRight, FolderOpen,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useDocumentProcessor } from '@/hooks/useDocumentProcessor';
import { useAuth } from '@/hooks/useAuth';
import { FileDropzone } from '@/components/FileDropzone';
import { ExcelDropzone } from '@/components/ExcelDropzone';
import { ProcessingStatus } from '@/components/ProcessingStatus';

import { DocumentRepository } from '@/components/DocumentRepository';
import { ResumeProcessingDialog } from '@/components/ResumeProcessingDialog';
import { StepIndicator } from '@/components/StepIndicator';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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
  const { profile, role, signOut } = useAuth();
  const navigate = useNavigate();
  const {
    holerites, comprovantes, matchedPairs, generatedDocs, spreadsheetData,
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
      <div className="min-h-screen bg-background">
        <Header
          profile={profile}
          role={role}
          signOut={signOut}
          navigate={navigate}
          onReset={handleReset}
          showReset={false}
          isProcessing={isProcessing}
          onRepository={() => setShowRepository(false)}
          repositoryActive
        />
        <main className="container mx-auto px-4 py-8">
          <div className="flex items-center gap-3 mb-6">
            <Button variant="outline" size="sm" onClick={() => setShowRepository(false)}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Voltar
            </Button>
            <h2 className="text-xl font-semibold text-foreground">Repositório de Documentos</h2>
          </div>
          <DocumentRepository documents={generatedDocs} spreadsheetData={spreadsheetData} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <ResumeProcessingDialog
        open={hasSavedState && !isCheckingState}
        onResume={resumeProcessing}
        onDiscard={discardSavedState}
      />

      <Header
        profile={profile}
        role={role}
        signOut={signOut}
        navigate={navigate}
        onReset={handleReset}
        showReset={currentStep > 1 || holerites.length > 0 || comprovantes.length > 0}
        isProcessing={isProcessing}
        onRepository={() => setShowRepository(true)}
        repositoryActive={false}
        docCount={generatedDocs.length}
      />

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
              className="max-w-lg mx-auto space-y-6"
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
                        onClick={cancelProcessing}
                        disabled={isCancelling}
                      >
                        <StopCircle className="h-4 w-4 mr-2" />
                        {isCancelling ? 'Cancelando...' : 'Cancelar Processamento'}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Matched pairs */}
              {matchedPairs.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                    Correspondências Encontradas
                    <span className="text-sm font-normal text-muted-foreground">
                      ({matchedPairs.length})
                    </span>
                  </h3>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {matchedPairs.map((pair, index) => (
                      <MatchedPairCard key={pair.id} pair={pair} index={index} />
                    ))}
                  </div>
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
                  {generatedDocs.length} documento(s) gerado(s) com sucesso e salvo(s) no repositório.
                </p>
              </div>

              {/* Summary of generated docs */}
              {matchedPairs.length > 0 && (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {matchedPairs
                    .filter((p) => p.status === 'completed')
                    .map((pair, index) => (
                      <MatchedPairCard key={pair.id} pair={pair} index={index} />
                    ))}
                </div>
              )}

              <div className="flex justify-center gap-4 flex-wrap">
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => setShowRepository(true)}
                  className="gap-2"
                >
                  <FolderOpen className="h-5 w-5" />
                  Ver Repositório
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

// Extracted Header component
function Header({
  profile, role, signOut, navigate, onReset, showReset, isProcessing,
  onRepository, repositoryActive, docCount = 0,
}: {
  profile: any;
  role: string | null;
  signOut: () => Promise<void>;
  navigate: (path: string) => void;
  onReset: () => void;
  showReset: boolean;
  isProcessing: boolean;
  onRepository: () => void;
  repositoryActive: boolean;
  docCount?: number;
}) {
  return (
    <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl gradient-primary flex items-center justify-center shadow-lg">
              <FileText className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold gradient-text">DocuMerge</h1>
              <p className="text-xs text-muted-foreground">Processador de Documentos Financeiros</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={repositoryActive ? 'default' : 'outline'}
              size="sm"
              onClick={onRepository}
              className="gap-2"
            >
              <FolderOpen className="h-4 w-4" />
              <span className="hidden sm:inline">Repositório</span>
              {docCount > 0 && (
                <span className="h-5 w-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center">
                  {docCount}
                </span>
              )}
            </Button>

            {showReset && (
              <Button variant="outline" size="sm" onClick={onReset} disabled={isProcessing}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Recomeçar
              </Button>
            )}

            {role === 'admin' && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <Shield className="h-4 w-4" />
                    <span className="hidden sm:inline">Admin</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => navigate('/admin/ip-whitelist')} className="cursor-pointer">
                    <Shield className="h-4 w-4 mr-2" />
                    IP Whitelist
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/admin/users')} className="cursor-pointer">
                    <User className="h-4 w-4 mr-2" />
                    Usuários
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/admin/funcionarios')} className="cursor-pointer">
                    <User className="h-4 w-4 mr-2" />
                    Funcionários
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <UserCircle className="h-4 w-4" />
                  <span className="hidden sm:inline">Perfil</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="flex items-center gap-2">
                  <span className="truncate">{profile?.full_name || 'Usuário'}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {role === 'admin' ? 'Admin' : 'Funcionário'}
                  </Badge>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/account')} className="cursor-pointer">
                  <User className="h-4 w-4 mr-2" />
                  Minha Conta
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={async () => { await signOut(); navigate('/login'); }}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Index;
