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
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Users } from "lucide-react";

interface UserEntry {
  id: string;
  email: string;
  full_name: string;
  role: string;
  created_at: string;
}

const AdminUsers = () => {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [users, setUsers] = useState<UserEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<string>("employee");

  const fetchUsers = async () => {
    setLoading(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return;

    const res = await fetch(
      `https://zouizzfomwrxfptgxkwj.supabase.co/functions/v1/admin-create-user`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

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
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleAdd = async () => {
    if (!fullName.trim() || !email.trim() || !password.trim()) {
      toast({
        title: "Campos obrigatórios",
        description: "Preencha todos os campos.",
        variant: "destructive",
      });
      return;
    }

    if (fullName.trim().length > 100) {
      toast({
        title: "Nome muito longo",
        description: "O nome deve ter no máximo 100 caracteres.",
        variant: "destructive",
      });
      return;
    }

    if (password.length < 6) {
      toast({
        title: "Senha curta",
        description: "A senha deve ter no mínimo 6 caracteres.",
        variant: "destructive",
      });
      return;
    }

    setAdding(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    const res = await fetch(
      `https://zouizzfomwrxfptgxkwj.supabase.co/functions/v1/admin-create-user`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: email.trim(),
          password,
          full_name: fullName.trim(),
          role,
        }),
      }
    );

    const json = await res.json();
    if (res.ok && json.success) {
      toast({ title: "Usuário criado com sucesso" });
      setFullName("");
      setEmail("");
      setPassword("");
      setRole("employee");
      fetchUsers();
    } else {
      toast({
        title: "Erro ao criar usuário",
        description: json.error || "Erro desconhecido.",
        variant: "destructive",
      });
    }
    setAdding(false);
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
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
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="João da Silva"
                  maxLength={100}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="joao@exemplo.com"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="role">Função</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
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
              <p className="text-muted-foreground text-center py-4">
                Nenhum usuário cadastrado.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Função</TableHead>
                    <TableHead>Criado em</TableHead>
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AdminUsers;
