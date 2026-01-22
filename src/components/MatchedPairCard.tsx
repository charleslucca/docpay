import { motion } from 'framer-motion';
import { Download, FileText, CheckCircle, Loader2, AlertCircle, ArrowRight } from 'lucide-react';
import { MatchedPair } from '@/types/document';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface MatchedPairCardProps {
  pair: MatchedPair;
  index: number;
}

export function MatchedPairCard({ pair, index }: MatchedPairCardProps) {
  const handleDownload = () => {
    if (!pair.outputUrl) return;

    const link = document.createElement('a');
    link.href = pair.outputUrl;
    link.download = `${pair.employeeName.replace(/\s+/g, '_')}.pdf`;
    link.click();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
    >
      <Card className="overflow-hidden">
        <CardContent className="p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-sm font-bold text-primary">
                  {pair.employeeName.charAt(0)}
                </span>
              </div>
              <div>
                <h4 className="font-semibold text-foreground text-sm">
                  {pair.employeeName}
                </h4>
                <p className="text-xs text-muted-foreground">
                  Página {pair.comprovante.pageNumber} do comprovante
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {pair.status === 'pending' && (
                <span className="text-xs text-muted-foreground px-2 py-1 bg-muted rounded-full">
                  Aguardando
                </span>
              )}
              {pair.status === 'generating' && (
                <span className="text-xs text-primary px-2 py-1 bg-primary/10 rounded-full flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Gerando
                </span>
              )}
              {pair.status === 'completed' && (
                <span className="text-xs text-primary px-2 py-1 bg-primary/10 rounded-full flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" />
                  Pronto
                </span>
              )}
              {pair.status === 'error' && (
                <span className="text-xs text-destructive px-2 py-1 bg-destructive/10 rounded-full flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Erro
                </span>
              )}
            </div>
          </div>

          {/* Document previews */}
          <div className="flex items-center gap-3">
            {/* Holerite preview */}
            <div className="flex-1">
              <div className="text-xs text-muted-foreground mb-2 text-center">
                Holerite
              </div>
              <div className="aspect-[3/4] rounded-lg border bg-muted overflow-hidden">
                {pair.holerite.previewUrl ? (
                  <img
                    src={pair.holerite.previewUrl}
                    alt="Holerite"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <FileText className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
              </div>
            </div>

            {/* Arrow */}
            <div className="flex-shrink-0">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <ArrowRight className="h-4 w-4 text-primary" />
              </div>
            </div>

            {/* Comprovante preview */}
            <div className="flex-1">
              <div className="text-xs text-muted-foreground mb-2 text-center">
                Comprovante
              </div>
              <div className="aspect-[3/4] rounded-lg border bg-muted overflow-hidden">
                {pair.comprovante.previewUrl ? (
                  <img
                    src={pair.comprovante.previewUrl}
                    alt="Comprovante"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <FileText className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Download button */}
          {pair.status === 'completed' && pair.outputUrl && (
            <Button
              onClick={handleDownload}
              className="w-full mt-4"
              size="sm"
            >
              <Download className="h-4 w-4 mr-2" />
              Baixar PDF Combinado
            </Button>
          )}

          {pair.error && (
            <p className="text-xs text-destructive mt-2 text-center">
              {pair.error}
            </p>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
