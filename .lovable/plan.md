

# Painel completo de gestao de usuarios (CRUD)

## Estado atual

- A pagina `AdminUsers.tsx` ja tem **criar** e **listar** usuarios
- A edge function `admin-create-user` suporta GET (listar) e POST (criar)
- Falta: **editar** (nome, role, senha) e **remover** usuarios

## Alteracoes

### 1. Edge Function `supabase/functions/admin-create-user/index.ts`

Adicionar dois novos metodos:

**PUT** - Editar usuario:
- Recebe `{ user_id, full_name?, role?, password? }`
- Usa `adminClient.auth.admin.updateUserById()` para atualizar email/senha/metadata
- Atualiza `profiles.full_name` e `user_roles.role` conforme necessario
- Impede que o admin remova o proprio role de admin

**DELETE** - Remover usuario:
- Recebe `{ user_id }` no body
- Usa `adminClient.auth.admin.deleteUser()` para remover do auth
- As tabelas `profiles` e `user_roles` tem `ON DELETE CASCADE`, entao limpam automaticamente
- Impede que o admin delete a si mesmo

### 2. Frontend `src/pages/AdminUsers.tsx`

- Adicionar coluna "Acoes" na tabela com botoes **Editar** e **Excluir**
- **Dialog de edicao**: abre com dados pre-preenchidos (nome, role, senha opcional). Chama PUT na edge function
- **Dialog de confirmacao de exclusao**: AlertDialog pedindo confirmacao antes de chamar DELETE
- Impedir que o admin logado edite/remova a si mesmo (ou pelo menos impedir auto-exclusao)
- Apos cada acao, recarrega a lista com `fetchUsers()`

### Arquivos alterados

| Arquivo | Alteracao |
|---------|-----------|
| `supabase/functions/admin-create-user/index.ts` | Adicionar handlers PUT e DELETE |
| `src/pages/AdminUsers.tsx` | Adicionar edicao inline, exclusao com confirmacao, coluna de acoes |

