import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { User, Mail, Lock, LogOut } from "lucide-react";

const Account = () => {
  const { user, profile, role, signOut } = useAuth();
  const { toast } = useToast();

  const [fullName, setFullName] = useState(profile?.full_name || "");
  const [newEmail, setNewEmail] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [changingEmail, setChangingEmail] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const handleSaveName = async () => {
    if (!user) return;

    const trimmed = fullName.trim();
    if (!trimmed || trimmed.length < 2) {
      toast({ title: "Erro", description: "O nome deve ter pelo menos 2 caracteres.", variant: "destructive" });
      return;
    }
    if (trimmed.length > 100) {
      toast({ title: "Erro", description: "O nome deve ter no máximo 100 caracteres.", variant: "destructive" });
      return;
    }
    if (!/^[a-zA-ZÀ-ÿ\s'-]+$/.test(trimmed)) {
      toast({ title: "Erro", description: "O nome contém caracteres inválidos.", variant: "destructive" });
      return;
    }

    setSavingName(true);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: trimmed })
      .eq("id", user.id);

    if (error) {
      toast({ title: "Erro", description: "Não foi possível salvar o nome.", variant: "destructive" });
    } else {
      toast({ title: "Salvo", description: "Nome atualizado com sucesso." });
    }
    setSavingName(false);
  };

  const handleChangePassword = async () => {
    if (!user?.email) return;
    setChangingPassword(true);
    await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    toast({
      title: "Email enviado",
      description: "Verifique seu email para redefinir sua senha.",
    });
    setChangingPassword(false);
  };

  const handleChangeEmail = async () => {
    if (!newEmail) return;
    setChangingEmail(true);
    const { error } = await supabase.auth.updateUser({ email: newEmail });
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      toast({
        title: "Confirmação necessária",
        description: "Verifique ambos os emails (antigo e novo) para confirmar a mudança.",
      });
      setNewEmail("");
    }
    setChangingEmail(false);
  };

  const handleLogout = async () => {
    await signOut();
  };

  return (
    <div className="p-4 md:p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Minha Conta</h1>

        {/* Profile Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <User className="h-5 w-5" />
              Perfil
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Função:</span>
              <Badge variant={role === "admin" ? "default" : "secondary"}>
                {role === "admin" ? "Administrador" : "Funcionário"}
              </Badge>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fullName">Nome completo</Label>
              <div className="flex gap-2">
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Seu nome"
                />
                <Button onClick={handleSaveName} disabled={savingName}>
                  {savingName ? "Salvando..." : "Salvar"}
                </Button>
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              Email: {user?.email}
            </div>
          </CardContent>
        </Card>

        {/* Change Email */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Mail className="h-5 w-5" />
              Trocar Email
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newEmail">Novo email</Label>
              <div className="flex gap-2">
                <Input
                  id="newEmail"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="novo@email.com"
                />
                <Button onClick={handleChangeEmail} disabled={changingEmail || !newEmail}>
                  {changingEmail ? "Enviando..." : "Trocar"}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Você receberá um email de confirmação em ambos os endereços.
            </p>
          </CardContent>
        </Card>

        {/* Change Password */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Lock className="h-5 w-5" />
              Trocar Senha
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button onClick={handleChangePassword} disabled={changingPassword} variant="outline">
              {changingPassword ? "Enviando..." : "Enviar email para trocar senha"}
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              Você receberá um link por email para definir uma nova senha.
            </p>
          </CardContent>
        </Card>

        <Separator />

        <Button variant="destructive" onClick={handleLogout} className="w-full">
          <LogOut className="h-4 w-4 mr-2" />
          Sair
        </Button>
      </div>
    </div>
  );
};

export default Account;
