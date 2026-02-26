import { useState, useMemo, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, Search, Calendar, User, FileText, FolderOpen, Building2, MapPin, RefreshCw, Loader2 } from "lucide-react";
import { GeneratedDocument } from "@/types/document";
import { type SpreadsheetData } from "@/lib/excelUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

type RepoDocument = GeneratedDocument & { storagePath?: string; publicUrl?: string };

interface DocumentRepositoryProps {
  documents: RepoDocument[];
  spreadsheetData?: SpreadsheetData | null;
}

const GENERATED_BUCKET = "generated-documents";

// Month names for filter display
const monthNames = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export function DocumentRepository({ documents, spreadsheetData }: DocumentRepositoryProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedYear, setSelectedYear] = useState<string>("all");
  const [selectedMonth, setSelectedMonth] = useState<string>("all");
  const [selectedEmpresa, setSelectedEmpresa] = useState<string>("all");
  const [selectedCidade, setSelectedCidade] = useState<string>("all");
  const [persistedDocs, setPersistedDocs] = useState<RepoDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadPersistedDocuments = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("generated_documents")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("[Repository] Error loading documents:", error);
        return;
      }

      if (data) {
        const docs: RepoDocument[] = data.map((row) => {
          const { data: urlData } = supabase.storage.from(GENERATED_BUCKET).getPublicUrl(row.storage_path);
          return {
            id: row.id,
            employeeName: row.employee_name,
            year: row.year,
            month: row.month,
            monthName: row.month_name,
            createdAt: new Date(row.created_at),
            blobUrl: urlData.publicUrl,
            fileName: row.file_name,
            storagePath: row.storage_path,
            publicUrl: urlData.publicUrl,
            empresa: row.empresa || undefined,
            municipio: row.municipio || undefined,
          };
        });
        setPersistedDocs(docs);
      }
    } catch (err) {
      console.error("[Repository] Failed to load documents:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPersistedDocuments();
  }, [loadPersistedDocuments]);

  // Merge in-memory docs with persisted, dedup by fileName+year+month
  const allDocuments = useMemo(() => {
    const seen = new Set<string>();
    const merged: RepoDocument[] = [];

    // In-memory docs take priority (they have blob URLs)
    for (const doc of documents) {
      const key = `${doc.fileName}_${doc.year}_${doc.month}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(doc);
      }
    }

    // Add persisted docs that aren't already in-memory
    for (const doc of persistedDocs) {
      const key = `${doc.fileName}_${doc.year}_${doc.month}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(doc);
      }
    }

    return merged;
  }, [documents, persistedDocs]);

  const years = useMemo(() => {
    const uniqueYears = [...new Set(allDocuments.map((d) => d.year))];
    return uniqueYears.sort((a, b) => b - a);
  }, [allDocuments]);

  const months = useMemo(() => {
    const uniqueMonths = [...new Set(allDocuments.map((d) => d.month))];
    return uniqueMonths.sort((a, b) => a - b);
  }, [allDocuments]);

  const empresas = useMemo(() => {
    const uniqueEmpresas = [...new Set(allDocuments.map((d) => d.empresa).filter(Boolean))] as string[];
    return uniqueEmpresas.sort();
  }, [allDocuments]);

  const cidades = useMemo(() => {
    const uniqueCidades = [...new Set(allDocuments.map((d) => d.municipio).filter(Boolean))] as string[];
    return uniqueCidades.sort();
  }, [allDocuments]);

  const filteredDocuments = useMemo(() => {
    return allDocuments.filter((doc) => {
      const matchesSearch = doc.employeeName.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesYear = selectedYear === "all" || doc.year === parseInt(selectedYear);
      const matchesMonth = selectedMonth === "all" || doc.month === parseInt(selectedMonth);
      const matchesEmpresa = selectedEmpresa === "all" || doc.empresa === selectedEmpresa;
      const matchesCidade = selectedCidade === "all" || doc.municipio === selectedCidade;
      return matchesSearch && matchesYear && matchesMonth && matchesEmpresa && matchesCidade;
    });
  }, [allDocuments, searchQuery, selectedYear, selectedMonth, selectedEmpresa, selectedCidade]);

  const groupedDocuments = useMemo(() => {
    const groups: Record<string, RepoDocument[]> = {};
    filteredDocuments.forEach((doc) => {
      const key = `${doc.year}/${doc.monthName}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(doc);
    });
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  }, [filteredDocuments]);

  const handleDownload = (doc: RepoDocument) => {
    const url = doc.publicUrl || doc.blobUrl;
    const link = document.createElement("a");
    link.href = url;
    link.download = doc.fileName;
    link.target = "_blank";
    link.click();
  };

  const handleDownloadAll = () => {
    filteredDocuments.forEach((doc, index) => {
      setTimeout(() => handleDownload(doc), index * 200);
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center text-muted-foreground">
            <Loader2 className="h-8 w-8 mx-auto mb-4 animate-spin" />
            <p>Carregando documentos...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (allDocuments.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center text-muted-foreground">
            <FolderOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Nenhum documento gerado ainda</p>
            <p className="text-sm mt-1">Os documentos aparecerão aqui após o processamento</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Repositório de Documentos
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={loadPersistedDocuments}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger className="w-full sm:w-32">
                <Calendar className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Ano" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {years.map((year) => (
                  <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-full sm:w-36">
                <SelectValue placeholder="Mês" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {months.map((month) => (
                  <SelectItem key={month} value={month.toString()}>{monthNames[month - 1]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(empresas.length > 0 || cidades.length > 0) && (
            <div className="flex flex-col sm:flex-row gap-3">
              {empresas.length > 0 && (
                <Select value={selectedEmpresa} onValueChange={setSelectedEmpresa}>
                  <SelectTrigger className="w-full sm:w-44">
                    <Building2 className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Empresa" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas Empresas</SelectItem>
                    {empresas.map((empresa) => (
                      <SelectItem key={empresa} value={empresa}>{empresa}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {cidades.length > 0 && (
                <Select value={selectedCidade} onValueChange={setSelectedCidade}>
                  <SelectTrigger className="w-full sm:w-44">
                    <MapPin className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Cidade" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas Cidades</SelectItem>
                    {cidades.map((cidade) => (
                      <SelectItem key={cidade} value={cidade}>{cidade}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
        </div>

        {/* Stats and download all */}
        <div className="flex items-center justify-between py-2 border-y">
          <p className="text-sm text-muted-foreground">
            {filteredDocuments.length} documento(s) encontrado(s)
            {persistedDocs.length > 0 && (
              <span className="ml-1 text-xs">({persistedDocs.length} salvo(s) no servidor)</span>
            )}
          </p>
          {filteredDocuments.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleDownloadAll}>
              <Download className="h-4 w-4 mr-2" />
              Baixar Todos
            </Button>
          )}
        </div>

        {/* Document list grouped by year/month */}
        <div className="space-y-6">
          <AnimatePresence>
            {groupedDocuments.map(([period, docs]) => {
              const [year, monthName] = period.split("/");
              return (
                <motion.div
                  key={period}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <h4 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
                    <FolderOpen className="h-4 w-4 text-primary" />
                    {monthName} de {year}
                    <span className="text-xs text-muted-foreground">
                      ({docs.length} arquivo{docs.length > 1 ? "s" : ""})
                    </span>
                  </h4>
                  <div className="grid gap-2">
                    {docs.map((doc) => {
                      const createdAt = doc.createdAt instanceof Date ? doc.createdAt : new Date(doc.createdAt as unknown as string);
                      return (
                        <motion.div
                          key={doc.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors group"
                        >
                          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <User className="h-4 w-4 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{doc.employeeName}</p>
                            {doc.storagePath && (
                              <p className="text-xs text-muted-foreground">
                                📁 {doc.storagePath.substring(0, doc.storagePath.lastIndexOf("/") + 1)}
                              </p>
                            )}
                            {doc.empresa || doc.municipio ? (
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                {doc.empresa && (
                                  <span className="flex items-center gap-0.5">
                                    <Building2 className="h-3 w-3" />
                                    {doc.empresa}
                                  </span>
                                )}
                                {doc.empresa && doc.municipio && <span>•</span>}
                                {doc.municipio && (
                                  <span className="flex items-center gap-0.5">
                                    <MapPin className="h-3 w-3" />
                                    {doc.municipio}
                                  </span>
                                )}
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                {createdAt.toLocaleDateString("pt-BR")} às{" "}
                                {createdAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                              </p>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDownload(doc)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        </motion.div>
                      );
                    })}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </CardContent>
    </Card>
  );
}
