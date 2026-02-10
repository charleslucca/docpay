
# Separar Menu do Usuario e Menu Admin no Header

## O que muda

O menu dropdown atual que combina "Minha Conta", "IP Whitelist" e "Sair" sera dividido em dois elementos separados:

1. **Botao "Perfil"** (renomeado de "Usuario") - dropdown com:
   - Nome do usuario + badge da role
   - "Minha Conta" -> `/account`
   - "Sair"

2. **Botao "Admin"** (visivel apenas para admins) - dropdown ou botao direto com:
   - "IP Whitelist" -> `/admin/ip-whitelist`

## Arquivo a modificar

`src/pages/Index.tsx`

### Alteracoes:

- Renomear o botao trigger do dropdown de `{profile?.full_name || 'Usuário'}` para `"Perfil"`
- Remover o item "IP Whitelist" do dropdown de perfil
- Adicionar um segundo botao separado (visivel somente para `role === 'admin'`) com icone `Shield` e texto "Admin" que navega diretamente para `/admin/ip-whitelist`

### Layout do header:

```text
Antes:
[Logo]                    [Recomecar] [Usuario ▼]
                                        |-- Minha Conta
                                        |-- IP Whitelist (admin)
                                        |-- Sair

Depois:
[Logo]          [Recomecar] [Admin] (so admin) [Perfil ▼]
                                                  |-- Nome + Role
                                                  |-- Minha Conta
                                                  |-- Sair
```
