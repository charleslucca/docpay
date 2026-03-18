import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2, Search, Users, ChevronLeft, ChevronRight } from "lucide-react";

interface Funcionario {
  id: string;
  nome: string;
  nome_normalizado: string;
  empresa_id: string;
  municipio_id: string;
  cargo: string | null;
  banco: string | null;
  contrato: string | null;
  observacoes: string | null;
  codigo: string | null;
  ativo: boolean;
}

interface Empresa {
  id: string;
  nome: string;
}

interface Municipio {
  id: string;
  nome: string;
}

interface SalarioRecord {
  funcionario_id: string;
  salario: number | null;
  outros_proventos: number | null;
  salario_familia: number | null;
  inss: number | null;
  irrf: number | null;
  outros_descontos: number | null;
  liquido: number | null;
  fgts: number | null;
}

const normalizeText = (text: string) =>
  text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();

const AdminFuncionarios = () => {
  const { toast } = useToast();
  const { role } = useAuth();
  const canSeeSalary = role === "admin" || role === "financeiro";

  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [municipios, setMunicipios] = useState<Municipio[]>([]);
  const [salarioMap, setSalarioMap] = useState<Map<string, SalarioRecord>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteSelectedOpen, setDeleteSelectedOpen] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Dialog states
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingFuncionario, setEditingFuncionario] = useState<Funcionario | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Funcionario | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formNome, setFormNome] = useState("");
  const [formEmpresaId, setFormEmpresaId] = useState("");
  const [formMunicipioId, setFormMunicipioId] = useState("");
  const [formCargo, setFormCargo] = useState("");
  const [formBanco, setFormBanco] = useState("");
  const [formContrato, setFormContrato] = useState("");
  const [formObservacoes, setFormObservacoes] = useState("");
  const [formAtivo, setFormAtivo] = useState(true);

  useEffect(() => {
    fetchAll();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [search]);

  const fetchAll = async () => {
    setLoading(true);
    const [funcRes, empRes, munRes] = await Promise.all([
      supabase.from("funcionarios").select("*").order("nome"),
      supabase.from("empresas").select("id, nome").order("nome"),
      supabase.from("municipios").select("id, nome").order("nome"),
    ]);
    if (funcRes.data) setFuncionarios(funcRes.data as Funcionario[]);
    if (empRes.data) setEmpresas(empRes.data);
    if (munRes.data) setMunicipios(munRes.data);

    // Fetch salary data only if authorized (RLS will block anyway)
    if (canSeeSalary) {
      const { data: salarios } = await supabase
        .from("funcionarios_salario" as any)
        .select("funcionario_id, salario, outros_proventos, salario_familia, inss, irrf, outros_descontos, liquido, fgts") as { data: SalarioRecord[] | null };
      
      if (salarios) {
        const map = new Map<string, SalarioRecord>();
        salarios.forEach(s => map.set(s.funcionario_id, s));
        setSalarioMap(map);
      }
    }

    setLoading(false);
  };

  const empresaMap = Object.fromEntries(empresas.map((e) => [e.id, e.nome]));
  const municipioMap = Object.fromEntries(municipios.map((m) => [m.id, m.nome]));

  const filtered = funcionarios.filter((f) =>
    f.nome_normalizado.includes(normalizeText(search))
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, filtered.length);
  const paginatedItems = filtered.slice(startIndex, endIndex);

  const allPageSelected = paginatedItems.length > 0 && paginatedItems.every((f) => selectedIds.has(f.id));
  const somePageSelected = paginatedItems.some((f) => selectedIds.has(f.id));

  const toggleSelectAll = () => {
    const newSet = new Set(selectedIds);
    if (allPageSelected) {
      paginatedItems.forEach((f) => newSet.delete(f.id));
    } else {
      paginatedItems.forEach((f) => newSet.add(f.id));
    }
    setSelectedIds(newSet);
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const formatSalario = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return "—";
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
  };

  const openCreate = () => {
    setEditingFuncionario(null);
    setFormNome("");
    setFormEmpresaId("");
    setFormMunicipioId("");
    setFormCargo("");
    setFormBanco("");
    setFormContrato("");
    setFormObservacoes("");
    setFormAtivo(true);
    setDialogOpen(true);
  };

  const openEdit = (f: Funcionario) => {
    setEditingFuncionario(f);
    setFormNome(f.nome);
    setFormEmpresaId(f.empresa_id);
    setFormMunicipioId(f.municipio_id);
    setFormCargo(f.cargo || "");
    setFormBanco(f.banco || "");
    setFormContrato(f.contrato || "");
    setFormObservacoes(f.observacoes || "");
    setFormAtivo(f.ativo);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formNome.trim() || !formEmpresaId || !formMunicipioId) {
      toast({ title: "Preencha os campos obrigatórios", description: "Nome, empresa e município são obrigatórios.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      nome: formNome.trim(),
      nome_normalizado: normalizeText(formNome),
      empresa_id: formEmpresaId,
      municipio_id: formMunicipioId,
      cargo: formCargo.trim() || null,
      banco: formBanco.trim() || null,
      contrato: formContrato.trim() || null,
      observacoes: formObservacoes.trim() || null,
      ativo: formAtivo,
    };

    if (editingFuncionario) {
      const { error } = await supabase.from("funcionarios").update(payload as any).eq("id", editingFuncionario.id);
      if (error) {
        toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Funcionário atualizado" });
      }
    } else {
      const { error } = await supabase.from("funcionarios").insert(payload as any);
      if (error) {
        toast({ title: "Erro ao criar", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Funcionário adicionado" });
      }
    }
    setSaving(false);
    setDialogOpen(false);
    fetchAll();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase.from("funcionarios").delete().eq("id", deleteTarget.id);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Funcionário excluído" });
    }
    setDeleteTarget(null);
    fetchAll();
  };

  const handleDeleteSelected = async () => {
    const ids = Array.from(selectedIds);
    const { error } = await supabase.from("funcionarios").delete().in("id", ids);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `${ids.length} funcionário(s) excluído(s)` });
    }
    setSelectedIds(new Set());
    setDeleteSelectedOpen(false);
    fetchAll();
  };

  const handlePageSizeChange = (value: string) => {
    setPageSize(Number(value));
    setCurrentPage(1);
    setSelectedIds(new Set());
  };

  return (
    <>
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Funcionários</h1>
        </div>
        <Badge variant="secondary" className="ml-auto">
          {filtered.length} de {funcionarios.length}
        </Badge>
      </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            Adicionar
          </Button>
        </div>

        {/* Bulk actions bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 mb-4 p-3 rounded-lg border border-destructive/30 bg-destructive/5">
            <span className="text-sm font-medium text-foreground">
              {selectedIds.size} selecionado(s)
            </span>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteSelectedOpen(true)}
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" />
              Excluir selecionados
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedIds(new Set())}
            >
              Limpar seleção
            </Button>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : (
          <div className="rounded-lg border bg-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allPageSelected}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Selecionar todos"
                      {...(somePageSelected && !allPageSelected ? { "data-state": "indeterminate" } : {})}
                    />
                  </TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead className="hidden sm:table-cell">Código</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead className="hidden md:table-cell">Município</TableHead>
                  <TableHead className="hidden lg:table-cell">Cargo</TableHead>
                  <TableHead className="hidden lg:table-cell">Banco</TableHead>
                  <TableHead className="hidden xl:table-cell">Contrato</TableHead>
                  <TableHead className="hidden xl:table-cell">Observações</TableHead>
                  {canSeeSalary && <TableHead className="hidden xl:table-cell">Salário</TableHead>}
                  {canSeeSalary && <TableHead className="hidden xl:table-cell">Líquido</TableHead>}
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canSeeSalary ? 13 : 11} className="text-center py-8 text-muted-foreground">
                      Nenhum funcionário encontrado.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedItems.map((f) => (
                    <TableRow key={f.id} data-state={selectedIds.has(f.id) ? "selected" : undefined}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(f.id)}
                          onCheckedChange={() => toggleSelect(f.id)}
                          aria-label={`Selecionar ${f.nome}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{f.nome}</TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground">{f.codigo || "—"}</TableCell>
                      <TableCell>{empresaMap[f.empresa_id] || "—"}</TableCell>
                      <TableCell className="hidden md:table-cell">{municipioMap[f.municipio_id] || "—"}</TableCell>
                      <TableCell className="hidden lg:table-cell">{f.cargo || "—"}</TableCell>
                      <TableCell className="hidden lg:table-cell">{f.banco || "—"}</TableCell>
                      <TableCell className="hidden xl:table-cell">{f.contrato || "—"}</TableCell>
                      <TableCell className="hidden xl:table-cell max-w-[200px] truncate" title={f.observacoes || ""}>
                        {f.observacoes || "—"}
                      </TableCell>
                      {canSeeSalary && (
                        <TableCell className="hidden xl:table-cell">
                          {formatSalario(salarioMap.get(f.id)?.salario)}
                        </TableCell>
                      )}
                      {canSeeSalary && (
                        <TableCell className="hidden xl:table-cell">
                          {formatSalario(salarioMap.get(f.id)?.liquido)}
                        </TableCell>
                      )}
                      <TableCell>
                        <Badge variant={f.ativo ? "default" : "secondary"}>
                          {f.ativo ? "Ativo" : "Inativo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(f)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(f)} className="text-destructive hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>

            {/* Pagination bar */}
            {filtered.length > 0 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Itens por página:</span>
                  <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                    <SelectTrigger className="w-[70px] h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <span className="text-sm text-muted-foreground">
                  Mostrando {startIndex + 1}–{endIndex} de {filtered.length}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={safePage <= 1}
                    onClick={() => { setCurrentPage(safePage - 1); setSelectedIds(new Set()); }}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm px-2 text-muted-foreground">
                    {safePage} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={safePage >= totalPages}
                    onClick={() => { setCurrentPage(safePage + 1); setSelectedIds(new Set()); }}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingFuncionario ? "Editar Funcionário" : "Adicionar Funcionário"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome *</Label>
              <Input value={formNome} onChange={(e) => setFormNome(e.target.value)} placeholder="Nome completo" />
            </div>
            <div>
              <Label>Empresa *</Label>
              <Select value={formEmpresaId} onValueChange={setFormEmpresaId}>
                <SelectTrigger><SelectValue placeholder="Selecione a empresa" /></SelectTrigger>
                <SelectContent>
                  {empresas.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Município *</Label>
              <Select value={formMunicipioId} onValueChange={setFormMunicipioId}>
                <SelectTrigger><SelectValue placeholder="Selecione o município" /></SelectTrigger>
                <SelectContent>
                  {municipios.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Cargo</Label>
                <Input value={formCargo} onChange={(e) => setFormCargo(e.target.value)} />
              </div>
              <div>
                <Label>Banco</Label>
                <Input value={formBanco} onChange={(e) => setFormBanco(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Contrato</Label>
                <Input value={formContrato} onChange={(e) => setFormContrato(e.target.value)} />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={formAtivo ? "true" : "false"} onValueChange={(v) => setFormAtivo(v === "true")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Ativo</SelectItem>
                    <SelectItem value="false">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Observações</Label>
              <Input value={formObservacoes} onChange={(e) => setFormObservacoes(e.target.value)} placeholder="E-mail, CPF, telefone..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete single confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir funcionário?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir <strong>{deleteTarget?.nome}</strong>? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete selected confirmation */}
      <AlertDialog open={deleteSelectedOpen} onOpenChange={setDeleteSelectedOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {selectedIds.size} funcionário(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir <strong>{selectedIds.size}</strong> funcionário(s) selecionado(s)? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteSelected} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir {selectedIds.size}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default AdminFuncionarios;
