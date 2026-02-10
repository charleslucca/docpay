import { motion } from 'framer-motion';
import { FileText, Sparkles, RotateCcw, Play, Zap, StopCircle, UserCircle, LogOut, User, Shield } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useDocumentProcessor } from '@/hooks/useDocumentProcessor';
import { useAuth } from '@/hooks/useAuth';
import { FileDropzone } from '@/components/FileDropzone';
import { ExcelDropzone } from '@/components/ExcelDropzone';
import { ProcessingStatus } from '@/components/ProcessingStatus';
import { MatchedPairCard } from '@/components/MatchedPairCard';
import { DocumentRepository } from '@/components/DocumentRepository';
import { ResumeProcessingDialog } from '@/components/ResumeProcessingDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const Index = () => {
  const { profile, role, signOut } = useAuth();
  const navigate = useNavigate();
  const {
    holerites,
    comprovantes,
    matchedPairs,
    generatedDocs,
    spreadsheetData,
    setSpreadsheetData,
    status,
    isCancelling,
    hasSavedState,
    isCheckingState,
    addFiles,
    removeFile,
    processDocuments,
    generatePdfs,
    cancelProcessing,
    reset,
    resumeProcessing,
    discardSavedState,
    reprocessWithEnhancedOcr,
  } = useDocumentProcessor();

  const canProcess = holerites.length > 0 && comprovantes.length > 0 && status.step === 'idle';
  const canGenerate = matchedPairs.length > 0 && matchedPairs.some((p) => p.status === 'pending');
  const isProcessing = ['extracting', 'matching', 'generating'].includes(status.step);

  return (
    <div className="min-h-screen bg-background">
      {/* Resume Processing Dialog */}
      <ResumeProcessingDialog
        open={hasSavedState && !isCheckingState}
        onResume={resumeProcessing}
        onDiscard={discardSavedState}
      />
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl gradient-primary flex items-center justify-center shadow-lg">
                <FileText className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-xl font-bold gradient-text">DocuMerge</h1>
                <p className="text-xs text-muted-foreground">
                  Processador de Documentos Financeiros
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {(holerites.length > 0 || comprovantes.length > 0 || generatedDocs.length > 0) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={reset}
                  disabled={isProcessing}
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Recomeçar
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <UserCircle className="h-4 w-4" />
                    <span className="hidden sm:inline">{profile?.full_name || 'Usuário'}</span>
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
                  {role === 'admin' && (
                    <DropdownMenuItem onClick={() => navigate('/admin/ip-whitelist')} className="cursor-pointer">
                      <Shield className="h-4 w-4 mr-2" />
                      IP Whitelist
                    </DropdownMenuItem>
                  )}
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

      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="upload" className="space-y-6">
          <TabsList className="grid w-full max-w-md mx-auto grid-cols-2">
            <TabsTrigger value="upload" className="flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Processar
            </TabsTrigger>
            <TabsTrigger value="repository" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Repositório
              {generatedDocs.length > 0 && (
                <span className="ml-1 h-5 w-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center">
                  {generatedDocs.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="space-y-6">
            {/* Excel Spreadsheet Upload */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-md mx-auto"
            >
              <ExcelDropzone
                spreadsheetData={spreadsheetData}
                onSpreadsheetLoaded={setSpreadsheetData}
                onSpreadsheetRemoved={() => setSpreadsheetData(null)}
                disabled={isProcessing}
              />
            </motion.div>

            {/* Upload Section */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid md:grid-cols-2 gap-6"
            >
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
            </motion.div>

            {/* Action Buttons */}
            {(canProcess || canGenerate) && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex justify-center gap-4"
              >
                {canProcess && (
                  <Button
                    size="lg"
                    onClick={processDocuments}
                    className="gradient-primary shadow-lg hover:shadow-xl transition-shadow"
                  >
                    <Play className="h-5 w-5 mr-2" />
                    Iniciar Processamento
                  </Button>
                )}
                {canGenerate && (
                  <Button
                    size="lg"
                    onClick={generatePdfs}
                    className="gradient-primary shadow-lg hover:shadow-xl transition-shadow"
                  >
                    <Sparkles className="h-5 w-5 mr-2" />
                    Gerar PDFs ({matchedPairs.filter((p) => p.status === 'pending').length})
                  </Button>
                )}
              </motion.div>
            )}

            {/* Processing Status with Cancel Button */}
            {status.step !== 'idle' && (
              <div className="space-y-4">
                <ProcessingStatus 
                  status={status} 
                  onReprocessEnhanced={reprocessWithEnhancedOcr}
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

            {/* Matched Pairs */}
            {matchedPairs.length > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-4"
              >
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
              </motion.div>
            )}
          </TabsContent>

          <TabsContent value="repository">
            <DocumentRepository documents={generatedDocs} spreadsheetData={spreadsheetData} />
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
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
