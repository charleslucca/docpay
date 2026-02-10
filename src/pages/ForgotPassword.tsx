import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AuthLayout from "@/components/AuthLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    // Always show success (don't reveal if email exists)
    setSent(true);
    toast({
      title: "Email enviado",
      description: "Se o email estiver cadastrado, você receberá um link para redefinir sua senha.",
    });
    setLoading(false);
  };

  return (
    <AuthLayout title="Esqueci minha senha" description="Informe seu email para receber um link de recuperação">
      {sent ? (
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">
            Verifique sua caixa de entrada. Se o email estiver cadastrado, você receberá um link.
          </p>
          <Link to="/login" className="text-primary hover:underline text-sm">
            Voltar ao login
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Enviando..." : "Enviar link de recuperação"}
          </Button>
          <div className="text-center text-sm">
            <Link to="/login" className="text-primary hover:underline">
              Voltar ao login
            </Link>
          </div>
        </form>
      )}
    </AuthLayout>
  );
};

export default ForgotPassword;
