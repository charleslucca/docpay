import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Search, Calendar, User, FileText, FolderOpen, Building2, MapPin } from 'lucide-react';
import { GeneratedDocument } from '@/types/document';
import { type SpreadsheetData } from '@/lib/excelUtils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface DocumentRepositoryProps {
  documents: GeneratedDocument[];
  spreadsheetData?: SpreadsheetData | null;
}

// Month names for filter display
const monthNames = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

export function DocumentRepository({ documents, spreadsheetData }: DocumentRepositoryProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState<string>('all');
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [selectedEmpresa, setSelectedEmpresa] = useState<string>('all');
  const [selectedCidade, setSelectedCidade] = useState<string>('all');

  const years = useMemo(() => {
    const uniqueYears = [...new Set(documents.map((d) => d.year))];
    return uniqueYears.sort((a, b) => b - a);
  }, [documents]);

  const months = useMemo(() => {
    const uniqueMonths = [...new Set(documents.map((d) => d.month))];
    return uniqueMonths.sort((a, b) => a - b);
  }, [documents]);

  const empresas = useMemo(() => {
    const uniqueEmpresas = [...new Set(documents.map((d) => d.empresa).filter(Boolean))] as string[];
    return uniqueEmpresas.sort();
  }, [documents]);

  const cidades = useMemo(() => {
    const uniqueCidades = [...new Set(documents.map((d) => d.municipio).filter(Boolean))] as string[];
    return uniqueCidades.sort();
  }, [documents]);

  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      const matchesSearch = doc.employeeName
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
      const matchesYear = selectedYear === 'all' || doc.year === parseInt(selectedYear);
      const matchesMonth = selectedMonth === 'all' || doc.month === parseInt(selectedMonth);
      const matchesEmpresa = selectedEmpresa === 'all' || doc.empresa === selectedEmpresa;
      const matchesCidade = selectedCidade === 'all' || doc.municipio === selectedCidade;
      return matchesSearch && matchesYear && matchesMonth && matchesEmpresa && matchesCidade;
    });
  }, [documents, searchQuery, selectedYear, selectedMonth, selectedEmpresa, selectedCidade]);

  const groupedDocuments = useMemo(() => {
    const groups: Record<string, GeneratedDocument[]> = {};
    
    filteredDocuments.forEach((doc) => {
      // Use year and month name for grouping
      const key = `${doc.year}/${doc.monthName}`;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(doc);
    });

    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  }, [filteredDocuments]);

  const handleDownload = (doc: GeneratedDocument) => {
    const link = document.createElement('a');
    link.href = doc.blobUrl;
    link.download = doc.fileName;
    link.click();
  };

  const handleDownloadAll = () => {
    filteredDocuments.forEach((doc, index) => {
      setTimeout(() => handleDownload(doc), index * 200);
    });
  };

  if (documents.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center text-muted-foreground">
            <FolderOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Nenhum documento gerado ainda</p>
            <p className="text-sm mt-1">
              Os documentos aparecerão aqui após o processamento
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          Repositório de Documentos
        </CardTitle>
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
                  <SelectItem key={year} value={year.toString()}>
                    {year}
                  </SelectItem>
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
                  <SelectItem key={month} value={month.toString()}>
                    {monthNames[month - 1]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {/* Company and City filters - only show if data exists */}
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
                      <SelectItem key={empresa} value={empresa}>
                        {empresa}
                      </SelectItem>
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
                      <SelectItem key={cidade} value={cidade}>
                        {cidade}
                      </SelectItem>
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
          </p>
          {filteredDocuments.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadAll}
            >
              <Download className="h-4 w-4 mr-2" />
              Baixar Todos
            </Button>
          )}
        </div>

        {/* Document list grouped by year/month */}
        <div className="space-y-6">
          <AnimatePresence>
            {groupedDocuments.map(([period, docs]) => {
              const [year, monthName] = period.split('/');
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
                      ({docs.length} arquivo{docs.length > 1 ? 's' : ''})
                    </span>
                  </h4>
                  <div className="grid gap-2">
                    {docs.map((doc) => (
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
                          <p className="text-sm font-medium truncate">
                            {doc.employeeName}
                          </p>
                          {(doc.empresa || doc.municipio) ? (
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
                              {doc.createdAt.toLocaleDateString('pt-BR')} às{' '}
                              {doc.createdAt.toLocaleTimeString('pt-BR', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
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
                    ))}
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
