import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Pencil, Plus, Trash2, Users } from "lucide-react";

interface UserEntry {
  id: string;
  email: string;
  full_name: string;
  role: string;
  created_at: string;
}

const FUNCTION_URL = `https://zouizzfomwrxfptgxkwj.supabase.co/functions/v1/admin-create-user`;

const AdminUsers = () => {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  // Create form
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<string>("employee");

  // Edit dialog
  const [editUser, setEditUser] = useState<UserEntry | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("employee");
  const [editPassword, setEditPassword] = useState("");
  const [saving, setSaving] = useState(false);

  // Delete dialog
  const [deleteUser, setDeleteUser] = useState<UserEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  const getToken = async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token;
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setCurrentUserId(data.session?.user?.id ?? null);
    });
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;

      const res = await fetch(FUNCTION_URL, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      const json = await res.json();
      if (res.ok && json.users) {
        setUsers(json.users);
      } else {
        toast({
          title: "Erro",
          description: json.error || "Não foi possível carregar os usuários.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error("fetchUsers error:", error);
      toast({ title: "Erro", description: "Falha ao carregar usuários.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleAdd = async () => {
    if (!fullName.trim() || !email.trim() || !password.trim()) {
      toast({ title: "Campos obrigatórios", description: "Preencha todos os campos.", variant: "destructive" });
      return;
    }
    if (fullName.trim().length > 100) {
      toast({ title: "Nome muito longo", description: "O nome deve ter no máximo 100 caracteres.", variant: "destructive" });
      return;
    }
    if (password.length < 6) {
      toast({ title: "Senha curta", description: "A senha deve ter no mínimo 6 caracteres.", variant: "destructive" });
      return;
    }

    setAdding(true);
    try {
      const token = await getToken();
      const res = await fetch(FUNCTION_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, full_name: fullName.trim(), role }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast({ title: "Usuário criado com sucesso" });
        setFullName(""); setEmail(""); setPassword(""); setRole("employee");
        fetchUsers();
      } else {
        toast({ title: "Erro ao criar usuário", description: json.error || "Erro desconhecido.", variant: "destructive" });
      }
    } catch (error: any) {
      console.error("handleAdd error:", error);
      toast({ title: "Erro ao criar usuário", description: "Falha na requisição.", variant: "destructive" });
    } finally {
      setAdding(false);
    }
  };

  // Edit
  const openEdit = (u: UserEntry) => {
    setEditUser(u);
    setEditName(u.full_name);
    setEditRole(u.role);
    setEditPassword("");
  };

  const handleEdit = async () => {
    if (!editUser) return;
    if (!editName.trim()) {
      toast({ title: "Nome obrigatório", variant: "destructive" });
      return;
    }
    if (editPassword && editPassword.length < 6) {
      toast({ title: "Senha curta", description: "Mínimo 6 caracteres.", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const token = await getToken();
      const payload: Record<string, string> = { user_id: editUser.id, full_name: editName.trim(), role: editRole };
      if (editPassword) payload.password = editPassword;

      const res = await fetch(FUNCTION_URL, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast({ title: "Usuário atualizado" });
        setEditUser(null);
        fetchUsers();
      } else {
        toast({ title: "Erro ao atualizar", description: json.error || "Erro desconhecido.", variant: "destructive" });
      }
    } catch (error: any) {
      console.error("handleEdit error:", error);
      toast({ title: "Erro ao atualizar", description: "Falha na requisição.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Delete
  const handleDelete = async () => {
    if (!deleteUser) return;
    setDeleting(true);
    try {
      const token = await getToken();

      const res = await fetch(FUNCTION_URL, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: deleteUser.id }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast({ title: "Usuário excluído" });
        setDeleteUser(null);
        fetchUsers();
      } else {
        toast({ title: "Erro ao excluir", description: json.error || "Erro desconhecido.", variant: "destructive" });
      }
    } catch (error: any) {
      console.error("handleDelete error:", error);
      toast({ title: "Erro ao excluir", description: "Falha na requisição.", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Users className="h-6 w-6" />
            Gerenciar Usuários
          </h1>
        </div>

        {/* Add new user */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Cadastrar Usuário
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="fullName">Nome Completo</Label>
                <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="João da Silva" maxLength={100} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="joao@exemplo.com" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="password">Senha</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="role">Função</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">Funcionário</SelectItem>
                    <SelectItem value="admin">Administrador</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={handleAdd} disabled={adding}>
                {adding ? "Criando..." : "Criar Usuário"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* User list */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Usuários Cadastrados</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground text-center py-4">Carregando...</p>
            ) : users.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">Nenhum usuário cadastrado.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Função</TableHead>
                    <TableHead>Criado em</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>{u.full_name || "—"}</TableCell>
                      <TableCell>{u.email}</TableCell>
                      <TableCell>
                        <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                          {u.role === "admin" ? "Admin" : "Funcionário"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(u.created_at).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(u)} title="Editar">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteUser(u)}
                          disabled={u.id === currentUserId}
                          title={u.id === currentUserId ? "Não é possível excluir a si mesmo" : "Excluir"}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editUser} onOpenChange={(open) => !open && setEditUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Usuário</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Email</Label>
              <Input value={editUser?.email ?? ""} disabled className="opacity-60" />
            </div>
            <div className="space-y-1">
              <Label>Nome Completo</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={100} />
            </div>
            <div className="space-y-1">
              <Label>Função</Label>
              <Select value={editRole} onValueChange={setEditRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">Funcionário</SelectItem>
                  <SelectItem value="admin">Administrador</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Nova Senha (opcional)</Label>
              <Input type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="Deixe vazio para manter" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>Cancelar</Button>
            <Button onClick={handleEdit} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteUser} onOpenChange={(open) => !open && setDeleteUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuário?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir <strong>{deleteUser?.full_name || deleteUser?.email}</strong>? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AdminUsers;
