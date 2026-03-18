import { useState, useEffect } from "react";
import { Users, Building2, MapPin, Clock, FileText, TrendingUp, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

interface DashboardMetrics {
  totalFuncionarios: number;
  totalEmpresas: number;
  totalMunicipios: number;
  totalPdfsGerados: number;
  ultimoProcessamento: string | null;
  taxaSucesso: number | null;
}

export default function Dashboard() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [funcRes, empRes, munRes, histRes] = await Promise.all([
          supabase.from("funcionarios").select("id", { count: "exact", head: true }).eq("ativo", true),
          supabase.from("empresas").select("id", { count: "exact", head: true }),
          supabase.from("municipios").select("id", { count: "exact", head: true }),
          supabase.from("processing_history").select("*").order("created_at", { ascending: false }).limit(100),
        ]);

        const history = (histRes.data || []) as any[];
        const totalPdfs = history.reduce((sum: number, h: any) => sum + (h.pdf_count || 0), 0);
        const ultimoProcessamento = history.length > 0 ? history[0].created_at : null;

        // Taxa de sucesso: PDFs gerados / (PDFs gerados + não processados)
        let taxaSucesso: number | null = null;
        if (history.length > 0) {
          const totalUnprocessed = history.reduce((sum: number, h: any) => {
            const unp = h.unprocessed_data;
            return sum + (Array.isArray(unp) ? unp.length : 0);
          }, 0);
          const total = totalPdfs + totalUnprocessed;
          taxaSucesso = total > 0 ? Math.round((totalPdfs / total) * 100) : null;
        }

        setMetrics({
          totalFuncionarios: funcRes.count || 0,
          totalEmpresas: empRes.count || 0,
          totalMunicipios: munRes.count || 0,
          totalPdfsGerados: totalPdfs,
          ultimoProcessamento,
          taxaSucesso,
        });
      } catch (err) {
        console.error("[Dashboard] Error:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-12 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const cards = [
    {
      title: "Funcionários Ativos",
      value: metrics?.totalFuncionarios ?? 0,
      icon: Users,
      color: "text-primary",
      bg: "bg-primary/10",
    },
    {
      title: "Empresas",
      value: metrics?.totalEmpresas ?? 0,
      icon: Building2,
      color: "text-chart-2",
      bg: "bg-chart-2/10",
    },
    {
      title: "Municípios",
      value: metrics?.totalMunicipios ?? 0,
      icon: MapPin,
      color: "text-chart-3",
      bg: "bg-chart-3/10",
    },
    {
      title: "PDFs Gerados",
      value: metrics?.totalPdfsGerados ?? 0,
      icon: FileText,
      color: "text-chart-4",
      bg: "bg-chart-4/10",
    },
    {
      title: "Taxa de Sucesso",
      value: metrics?.taxaSucesso != null ? `${metrics.taxaSucesso}%` : "—",
      icon: TrendingUp,
      color: "text-chart-5",
      bg: "bg-chart-5/10",
    },
    {
      title: "Último Processamento",
      value: metrics?.ultimoProcessamento
        ? new Date(metrics.ultimoProcessamento).toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "Nenhum",
      icon: Clock,
      color: "text-muted-foreground",
      bg: "bg-muted",
    },
  ];

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Visão geral do sistema</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
              <div className={`h-9 w-9 rounded-lg ${card.bg} flex items-center justify-center`}>
                <card.icon className={`h-5 w-5 ${card.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-foreground">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
