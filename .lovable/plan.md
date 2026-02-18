
# Cadastro de Usuarios pelo Admin

## Resumo

Criar uma nova pagina de administracao para gerenciar usuarios, acessivel pelo botao "Admin" no header. O botao Admin passara a abrir um dropdown com duas opcoes: "IP Whitelist" e "Usuarios". A nova pagina permitira ao admin cadastrar novos usuarios (via Edge Function com service_role) e visualizar os usuarios existentes.

## Alteracoes

### 1. Nova Edge Function: `admin-create-user`

Arquivo: `supabase/functions/admin-create-user/index.ts`

- Recebe `email`, `password`, `full_name` e `role` (admin ou employee) no body
- Valida que o usuario autenticado e admin (consulta `user_roles` com service_role)
- Usa `supabase.auth.admin.createUser()` com service_role para criar o usuario
- O trigger `handle_new_user` ja existente cuida de criar o profile e user_role automaticamente
- Se role enviado for "admin", atualiza `user_roles` para `admin` apos a criacao
- Retorna sucesso ou erro

### 2. Nova pagina: `src/pages/AdminUsers.tsx`

- Layout similar ao AdminIpWhitelist (header com seta voltar + titulo)
- Formulario de cadastro com campos: Nome Completo, Email, Senha, Role (select: Funcionario/Administrador)
- Tabela listando usuarios existentes (busca `profiles` + `user_roles` via joins)
- Cada linha mostra: nome, email (do auth), role, data de criacao

### 3. Atualizar `src/App.tsx`

- Adicionar rota `/admin/users` protegida com `AdminRoute`
- Importar novo componente `AdminUsers`

### 4. Atualizar `src/pages/Index.tsx`

- Transformar o botao "Admin" em um `DropdownMenu` com duas opcoes:
  - "IP Whitelist" -> `/admin/ip-whitelist`
  - "Usuarios" -> `/admin/users`

### 5. Atualizar `supabase/config.toml`

- Adicionar configuracao da nova edge function com `verify_jwt = false`

## Detalhes tecnicos

### Edge Function `admin-create-user`

```text
POST /admin-create-user
Headers: Authorization: Bearer <token>
Body: { email, password, full_name, role }

Fluxo:
1. Extrai token JWT do header Authorization
2. Verifica usuario com supabase.auth.getUser(token)
3. Consulta user_roles para confirmar role = 'admin'
4. Cria usuario com supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name } })
5. Se role = 'admin', atualiza user_roles SET role = 'admin' WHERE user_id = novo_id
6. Retorna { success: true, user_id }
```

### Listagem de usuarios

A pagina fara duas queries:
1. `profiles` -> id, full_name, created_at
2. `user_roles` -> user_id, role

Como o admin ja tem permissao de SELECT em ambas as tabelas (via RLS com has_role), nao precisa de migracao adicional.

Obs: O email do usuario nao esta na tabela `profiles` (esta em `auth.users`). Para exibir o email, a Edge Function tambem tera um endpoint GET que lista usuarios via `supabase.auth.admin.listUsers()`.

### Validacao do formulario

- Email: formato valido, obrigatorio
- Senha: minimo 6 caracteres, obrigatorio
- Nome: obrigatorio, max 100 caracteres
- Role: select com opcoes pre-definidas
