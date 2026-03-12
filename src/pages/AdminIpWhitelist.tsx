import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Plus, Trash2, Shield } from "lucide-react";

interface IpEntry {
  id: string;
  ip: string;
  description: string | null;
  active: boolean;
  created_at: string;
}

const AdminIpWhitelist = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [entries, setEntries] = useState<IpEntry[]>([]);
  const [newIp, setNewIp] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const fetchEntries = async () => {
    const { data, error } = await supabase
      .from("ip_whitelist")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast({ title: "Erro", description: "Não foi possível carregar os IPs.", variant: "destructive" });
    } else {
      setEntries((data as IpEntry[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchEntries();
  }, []);

  const validateIp = (ip: string) => {
    const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6 = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
    if (ipv4.test(ip)) {
      return ip.split('.').every((octet) => {
        const num = parseInt(octet, 10);
        return num >= 0 && num <= 255;
      });
    }
    return ipv6.test(ip);
  };

  const handleIpChange = (value: string) => {
    // Allow only digits and dots
    const cleaned = value.replace(/[^0-9.]/g, '');
    
    // Process digit by digit to auto-insert dots
    let result = '';
    let octetCount = 0;
    let currentOctet = '';
    
    for (const char of cleaned) {
      if (char === '.') {
        if (currentOctet.length > 0 && octetCount < 3) {
          result += currentOctet + '.';
          octetCount++;
          currentOctet = '';
        }
        continue;
      }
      
      // Add digit to current octet
      const tentative = currentOctet + char;
      const num = parseInt(tentative, 10);
      
      if (tentative.length <= 3 && num <= 255) {
        currentOctet = tentative;
        // Auto-insert dot after complete octet (3 digits or value > 25 means no more valid digits)
        if (octetCount < 3 && (tentative.length === 3 || num > 25)) {
          result += currentOctet + '.';
          octetCount++;
          currentOctet = '';
        }
      } else if (tentative.length <= 3 && num > 255) {
        // Clamp to 255
        currentOctet = '255';
        if (octetCount < 3) {
          result += currentOctet + '.';
          octetCount++;
          currentOctet = '';
        }
      }
      
      if (octetCount >= 4) break;
    }
    
    result += currentOctet;
    setNewIp(result);
  };

  const handleIpKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  const handleAdd = async () => {
    if (!validateIp(newIp)) {
      toast({ title: "IP inválido", description: "Informe um IPv4 ou IPv6 válido.", variant: "destructive" });
      return;
    }
    setAdding(true);
    const { error } = await supabase.from("ip_whitelist").insert({
      ip: newIp,
      description: newDescription || null,
      created_by: user?.id,
    });
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "IP adicionado" });
      setNewIp("");
      setNewDescription("");
      fetchEntries();
    }
    setAdding(false);
  };

  const handleToggle = async (id: string, active: boolean) => {
    const { error } = await supabase.from("ip_whitelist").update({ active }).eq("id", id);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, active } : e)));
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("ip_whitelist").delete().eq("id", id);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      setEntries((prev) => prev.filter((e) => e.id !== id));
      toast({ title: "IP removido" });
    }
  };

  return (
    <div className="p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Shield className="h-6 w-6" />
          IP Whitelist
        </h1>

        {/* Add new IP */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Adicionar IP
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 space-y-1">
                <Label htmlFor="newIp">Endereço IP</Label>
                <Input
                  id="newIp"
                  value={newIp}
                  onChange={(e) => handleIpChange(e.target.value)}
                  onKeyDown={handleIpKeyDown}
                  placeholder="192.168.1.1"
                  maxLength={15}
                />
              </div>
              <div className="flex-1 space-y-1">
                <Label htmlFor="desc">Descrição</Label>
                <Input
                  id="desc"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Escritório principal"
                />
              </div>
              <div className="flex items-end">
                <Button onClick={handleAdd} disabled={adding || !newIp}>
                  {adding ? "Adicionando..." : "Adicionar"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* IP List */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">IPs Cadastrados</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground text-center py-4">Carregando...</p>
            ) : entries.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">
                Nenhum IP cadastrado. Todos os acessos estão liberados.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>IP</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Ativo</TableHead>
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-mono">{entry.ip}</TableCell>
                      <TableCell>{entry.description || "—"}</TableCell>
                      <TableCell>
                        <Switch
                          checked={entry.active}
                          onCheckedChange={(checked) => handleToggle(entry.id, checked)}
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(entry.id)}
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
    </div>
  );
};

export default AdminIpWhitelist;
