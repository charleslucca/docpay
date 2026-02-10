import { ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const Blocked = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="text-center space-y-4">
        <ShieldX className="h-16 w-16 text-destructive mx-auto" />
        <h1 className="text-2xl font-bold text-foreground">Acesso não permitido</h1>
        <p className="text-muted-foreground max-w-md">
          Seu endereço IP não está autorizado a acessar este sistema.
          Entre em contato com o administrador.
        </p>
        <Button variant="outline" onClick={() => navigate("/login")}>
          Voltar ao login
        </Button>
      </div>
    </div>
  );
};

export default Blocked;
