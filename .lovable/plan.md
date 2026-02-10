

# Modulo de Autenticacao, RBAC e IP Whitelist

## Visao Geral

Implementar autenticacao completa com login/logout, perfil de usuario, controle de acesso por roles (admin/employee), troca de senha/email com confirmacao, e bloqueio por IP via edge function.

**Nota importante sobre roles**: Por seguranca, as roles serao armazenadas em uma tabela separada (`user_roles`) em vez de na tabela `profiles`, para evitar ataques de escalacao de privilegios. Uma funcao `security definer` sera usada para verificar roles sem recursao no RLS.

---

## 1. Banco de Dados (Migrations)

### 1.1 Tabela `profiles`
```sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.profiles enable row level security;
```

### 1.2 Tabela `user_roles` (separada de profiles)
```sql
create type public.app_role as enum ('admin', 'employee');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role app_role not null default 'employee',
  unique (user_id, role)
);
alter table public.user_roles enable row level security;
```

### 1.3 Funcao `has_role` (security definer)
```sql
create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;
```

### 1.4 Trigger para criar profile + role ao cadastrar
```sql
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  
  insert into public.user_roles (user_id, role)
  values (new.id, 'employee')
  on conflict (user_id, role) do nothing;
  
  return new;
end; $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
```

### 1.5 Tabela `ip_whitelist`
```sql
create table public.ip_whitelist (
  id uuid primary key default gen_random_uuid(),
  ip text not null,
  description text,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);
alter table public.ip_whitelist enable row level security;
```

### 1.6 Politicas RLS

**profiles**: usuario ve/edita o proprio; admin ve/edita todos.
**user_roles**: somente leitura para o proprio usuario; admin le todos.
**ip_whitelist**: somente admin (todas operacoes).

```sql
-- profiles
create policy "profiles_select" on public.profiles for select
  using (id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "profiles_update" on public.profiles for update
  using (id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- user_roles
create policy "roles_select_own" on public.user_roles for select
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- ip_whitelist
create policy "ip_whitelist_admin" on public.ip_whitelist for all
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));
```

---

## 2. Edge Function: `check-ip`

Criada em `supabase/functions/check-ip/index.ts`:
- Recebe o request, extrai IP de `x-forwarded-for`
- Consulta `ip_whitelist` com service role key
- Retorna `{ allowed: true/false }`
- `verify_jwt = false` no config.toml (validacao manual do JWT em codigo)

---

## 3. Frontend - Novos Arquivos

### Paginas (6 novas)

| Arquivo | Descricao |
|---------|-----------|
| `src/pages/Login.tsx` | Formulario email/senha com `signInWithPassword` |
| `src/pages/ForgotPassword.tsx` | Envia email de reset com `resetPasswordForEmail` |
| `src/pages/ResetPassword.tsx` | Define nova senha com `updateUser({ password })` |
| `src/pages/Account.tsx` | Editar nome, ver role, botoes trocar senha/email |
| `src/pages/AdminIpWhitelist.tsx` | CRUD de IPs (somente admin) |
| `src/pages/Blocked.tsx` | Tela "Acesso nao permitido" |

### Componentes e Hooks (4 novos)

| Arquivo | Descricao |
|---------|-----------|
| `src/hooks/useAuth.tsx` | Context de auth: sessao, profile, role, loading |
| `src/components/ProtectedRoute.tsx` | Wrapper que verifica sessao + IP |
| `src/components/AdminRoute.tsx` | Wrapper que verifica role admin |
| `src/components/AuthLayout.tsx` | Layout para paginas de auth (login, forgot, reset) |

---

## 4. Roteamento Atualizado (App.tsx)

```text
/login              -> Login (publica)
/forgot-password    -> ForgotPassword (publica)
/reset-password     -> ResetPassword (publica)
/blocked            -> Blocked (publica)
/                   -> Index (protegida + IP check)
/account            -> Account (protegida)
/admin/ip-whitelist -> AdminIpWhitelist (protegida + admin)
```

---

## 5. Fluxos Detalhados

### Login
1. Usuario digita email/senha
2. `signInWithPassword` -> sessao criada
3. `ProtectedRoute` verifica IP via edge function `check-ip`
4. Se IP bloqueado -> `/blocked`
5. Se OK -> renderiza pagina

### Troca de Senha (Minha Conta)
1. Clica "Trocar senha"
2. Chama `resetPasswordForEmail` com email do usuario logado
3. Mostra toast: "Verifique seu email"
4. Link no email redireciona para `/reset-password`

### Troca de Email
1. Digita novo email
2. `updateUser({ email: newEmail })`
3. Toast: "Verifique ambos os emails para confirmar"

### IP Whitelist
1. `check-ip` edge function consulta tabela com service role
2. `ProtectedRoute` chama edge function ao montar
3. Se `allowed: false` -> redireciona para `/blocked`

---

## 6. Arquivos Modificados vs Novos

| Acao | Arquivo |
|------|---------|
| Modificar | `src/App.tsx` (adicionar rotas) |
| Modificar | `supabase/config.toml` (adicionar config da edge function) |
| Criar | `src/hooks/useAuth.tsx` |
| Criar | `src/components/ProtectedRoute.tsx` |
| Criar | `src/components/AdminRoute.tsx` |
| Criar | `src/components/AuthLayout.tsx` |
| Criar | `src/pages/Login.tsx` |
| Criar | `src/pages/ForgotPassword.tsx` |
| Criar | `src/pages/ResetPassword.tsx` |
| Criar | `src/pages/Account.tsx` |
| Criar | `src/pages/AdminIpWhitelist.tsx` |
| Criar | `src/pages/Blocked.tsx` |
| Criar | `supabase/functions/check-ip/index.ts` |

---

## 7. Sequencia de Implementacao

1. Criar migrations (tabelas + RLS + triggers)
2. Criar edge function `check-ip`
3. Criar `useAuth` hook
4. Criar componentes de protecao de rota
5. Criar paginas de auth (Login, ForgotPassword, ResetPassword)
6. Criar pagina Account
7. Criar pagina AdminIpWhitelist e Blocked
8. Atualizar App.tsx com todas as rotas
9. Testar fluxo completo

