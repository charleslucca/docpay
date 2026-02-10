

# Adicionar Menu de Navegacao no Header

## Problema

As paginas `/account` e `/admin/ip-whitelist` existem e funcionam, mas nao ha nenhum link ou menu no header da pagina principal para o usuario acessar seu perfil ou para o admin acessar as funcoes administrativas.

## Solucao

Adicionar um menu dropdown no canto direito do header da pagina `Index.tsx` com:
- Nome do usuario e role visivel
- Link para "Minha Conta" (`/account`)
- Link para "IP Whitelist" (`/admin/ip-whitelist`) - visivel apenas para admins
- Botao "Sair" para logout

## Mudancas

### Arquivo: `src/pages/Index.tsx`

Adicionar no header (ao lado do botao "Recomecar"):

1. Importar `useAuth`, `useNavigate`, e componentes de `DropdownMenu`
2. Criar um menu dropdown com icone de usuario contendo:
   - Texto: nome do usuario + badge da role
   - Separador
   - Item: "Minha Conta" -> navega para `/account`
   - Item (condicional, so admin): "IP Whitelist" -> navega para `/admin/ip-whitelist`
   - Separador
   - Item: "Sair" -> chama `signOut()` e navega para `/login`

### Detalhes Tecnicos

```text
Header atual:
[Logo DocuMerge]                    [Recomecar]

Header novo:
[Logo DocuMerge]          [Recomecar] [Avatar/Menu ▼]
                                        |-- Minha Conta
                                        |-- IP Whitelist (admin)
                                        |-- Sair
```

Sera usado o componente `DropdownMenu` do Radix (ja instalado no projeto) para consistencia com o design system existente. O icone sera um `UserCircle` do Lucide.

### Arquivo unico a modificar

| Arquivo | Alteracao |
|---------|-----------|
| `src/pages/Index.tsx` | Adicionar menu dropdown de usuario no header |

