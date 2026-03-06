import { useState, useEffect, useCallback } from "react";
import { History, Loader2, RefreshCw, FileText, Clock, Calendar, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";

interface UnprocessedItem {
  name: string;
  reason: string;
  closestCandidate?: string;
  foundInFullText?: boolean;
  foundAsFavorecido?: boolean;
}

interface HistoryEntry {
  id: string;
  created_at: string;
  pdf_count: number;
  duration_seconds: number | null;
  month: number | null;
  year: number | null;
  month_name: string | null;
  unprocessed_data: UnprocessedItem[] | null;
}

const monthNames = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export function ProcessingHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("processing_history")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("[History] Error loading:", error);
        return;
      }
      setEntries((data as unknown as HistoryEntry[]) || []);
    } catch (err) {
      console.error("[History] Failed:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center text-muted-foreground">
            <Loader2 className="h-8 w-8 mx-auto mb-4 animate-spin" />
            <p>Carregando histórico...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center text-muted-foreground">
            <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Nenhum processamento realizado ainda</p>
            <p className="text-sm mt-1">O histórico aparecerá aqui após gerar PDFs</p>
          </div>
        </CardContent>
      </Card>
  );
}

function HistoryEntryRow({
  entry, date, unprocessedCount, unprocessed, formatDuration,
}: {
  entry: HistoryEntry;
  date: Date;
  unprocessedCount: number;
  unprocessed: UnprocessedItem[] | null;
  formatDuration: (s: number) => string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-3 p-3 hover:bg-accent/50 transition-colors">
        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <FileText className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">
              {entry.pdf_count} PDF(s) gerado(s)
            </p>
            {unprocessedCount > 0 && (
              <Badge variant="outline" className="text-xs border-amber-500 text-amber-700 dark:text-amber-400">
                {unprocessedCount} não processado(s)
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {date.toLocaleDateString("pt-BR")} às{" "}
              {date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </span>
            {entry.duration_seconds != null && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDuration(entry.duration_seconds)}
              </span>
            )}
            {entry.month_name && entry.year && (
              <span>
                {entry.month_name}/{entry.year}
              </span>
            )}
          </div>
        </div>
        {unprocessedCount > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        )}
      </div>
      {expanded && unprocessed && unprocessed.length > 0 && (
        <div className="border-t px-3 pb-3 pt-2">
          <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Funcionários não processados
          </p>
          <div className="max-h-[200px] overflow-auto space-y-1">
            {unprocessed.map((item, idx) => (
              <div key={idx} className="text-xs flex gap-2 py-1 border-b last:border-0">
                <span className="font-medium min-w-[180px]">{item.name}</span>
                <span className="text-muted-foreground truncate">{item.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            Histórico de Processamento
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={loadHistory}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {entries.map((entry) => {
            const date = new Date(entry.created_at);
            const unprocessed = entry.unprocessed_data;
            const unprocessedCount = unprocessed?.length || 0;
            return (
              <HistoryEntryRow
                key={entry.id}
                entry={entry}
                date={date}
                unprocessedCount={unprocessedCount}
                unprocessed={unprocessed}
                formatDuration={formatDuration}
              />
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
