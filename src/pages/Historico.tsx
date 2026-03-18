import { ProcessingHistory } from "@/components/ProcessingHistory";

export default function Historico() {
  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Histórico de Processamento</h1>
        <p className="text-sm text-muted-foreground">Registro de todas as execuções de processamento</p>
      </div>
      <ProcessingHistory />
    </div>
  );
}
