import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { UnprocessedEmployee } from "@/types/document";

interface UnprocessedListProps {
  items: UnprocessedEmployee[];
  totalProcessed?: number;
}

export function UnprocessedList({ items, totalProcessed = 0 }: UnprocessedListProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");

  if (!items || items.length === 0) return null;

  const filtered = search
    ? items.filter(
        (i) =>
          i.name.toLowerCase().includes(search.toLowerCase()) ||
          i.reason.toLowerCase().includes(search.toLowerCase()),
      )
    : items;

  const exportCsv = () => {
    const header = "Nome,Normalizado,Arquivo,Página,No Texto,FAVORECIDO,Candidato Próximo,Motivo\n";
    const rows = items
      .map(
        (i) =>
          `"${i.name}","${i.normalized}","${i.sourceFile}",${i.sourcePage},${i.foundInFullText ? "SIM" : "NÃO"},${i.foundAsFavorecido ? "SIM" : "NÃO"},"${i.closestCandidate}","${i.reason}"`,
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "funcionarios_nao_processados.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const reasonBadge = (item: UnprocessedEmployee) => {
    if (item.foundAsFavorecido) return <Badge variant="outline" className="text-xs border-amber-500 text-amber-700 dark:text-amber-400">Match rejeitado</Badge>;
    if (item.foundInFullText) return <Badge variant="outline" className="text-xs border-orange-500 text-orange-700 dark:text-orange-400">Não extraído como FAVORECIDO</Badge>;
    if (item.closestCandidate !== "(nenhum)") return <Badge variant="outline" className="text-xs border-red-400 text-red-600 dark:text-red-400">Candidato parcial</Badge>;
    return <Badge variant="destructive" className="text-xs">Ausente</Badge>;
  };

  return (
    <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <button className="w-full p-4 flex items-center justify-between hover:bg-amber-100/50 dark:hover:bg-amber-900/20 transition-colors rounded-t-lg">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="text-left">
                <p className="font-semibold text-foreground">
                  {items.length} funcionário(s) não processado(s)
                </p>
                <p className="text-xs text-muted-foreground">
                  {totalProcessed} processado(s) com sucesso • Clique para ver detalhes
                </p>
              </div>
            </div>
            {isOpen ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nome ou motivo..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-9 bg-background"
                />
              </div>
              <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5">
                <Download className="h-4 w-4" />
                CSV
              </Button>
            </div>

            <div className="rounded-md border bg-background max-h-[400px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">#</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Candidato Próximo</TableHead>
                    <TableHead>Motivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((item) => (
                    <TableRow key={item.index}>
                      <TableCell className="text-muted-foreground text-xs">{item.index}</TableCell>
                      <TableCell className="font-medium text-sm">{item.name}</TableCell>
                      <TableCell>{reasonBadge(item)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                        {item.closestCandidate !== "(nenhum)" ? item.closestCandidate : "—"}
                      </TableCell>
                      <TableCell className="text-xs max-w-[300px]">{item.reason}</TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                        Nenhum resultado encontrado
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
