

## Diagnóstico

### 1. Senha travando indefinidamente (bug principal)

O problema está em **duas camadas**:

**Frontend (`AdminUsers.tsx`, linhas 162-193)**: A função `handleEdit` não tem `try/catch`. Se o `fetch` ou `res.json()` lançar exceção (ex: resposta não-JSON da edge function), `setSaving(false)` na linha 192 nunca executa, deixando o botão em loading infinito.

**Edge Function (`admin-create-user/index.ts`, linha 32)**: Usa `anonClient.auth.getClaims(token)` — este método **não existe** na API padrão do Supabase JS v2. O método correto é `getUser(token)`. Se `getClaims` falhar, a edge function retorna erro/crash, e o frontend sem try/catch trava.

Obs: os logs da edge function mostram apenas boot/shutdown sem saída, confirmando crash silencioso.

### 2. Layout inconsistente (todas as páginas)

Cada página tem seu próprio layout independente:
- `Index.tsx` — Header customizado com dropdown de navegação admin
- `AdminUsers.tsx` — Botão "Voltar" simples
- `AdminFuncionarios.tsx` — Botão "Voltar" simples  
- `AdminIpWhitelist.tsx` — Botão "Voltar" simples
- `Account.tsx` — Botão "Voltar" simples

Não existe sidebar nem componente de layout compartilhado.

---

## Plano de Correção

### Parte 1: Corrigir atualização de senha

**Arquivo: `supabase/functions/admin-create-user/index.ts`**
- Substituir `anonClient.auth.getClaims(token)` por `adminClient.auth.getUser(token)` — método válido e confiável
- Isso corrige a autenticação do chamador para todas as operações (GET, POST, PUT, DELETE)

**Arquivo: `src/pages/AdminUsers.tsx`**
- Envolver `handleEdit` em try/catch para garantir que `setSaving(false)` sempre execute
- Exibir toast de erro se a requisição falhar por qualquer motivo
- Aplicar o mesmo padrão de try/catch em `handleAdd`, `handleDelete` e `fetchUsers`

### Parte 2: Layout unificado com sidebar

**Novo arquivo: `src/components/AppLayout.tsx`**
- Componente de layout com `SidebarProvider` + `Sidebar`
- Menu lateral com links para: Início, Funcionários, Usuários, IP Whitelist, Minha Conta
- Itens admin visíveis apenas quando `role === 'admin'`
- Header com `SidebarTrigger` + nome do usuário + botão sair
- Sidebar colapsável com ícones visíveis no modo mini

**Arquivo: `src/App.tsx`**
- Envolver todas as rotas protegidas com `AppLayout`
- Remover headers/botões "Voltar" individuais de cada página

**Arquivos afetados pela remoção de header/navegação individual:**
- `src/pages/Index.tsx` — remover componente `Header` interno, manter apenas conteúdo
- `src/pages/AdminUsers.tsx` — remover botão "Voltar" e header
- `src/pages/AdminFuncionarios.tsx` — remover botão "Voltar" e header  
- `src/pages/AdminIpWhitelist.tsx` — remover botão "Voltar" e header
- `src/pages/Account.tsx` — remover botão "Voltar" e header

---

## Arquivos alterados (resumo)

| Arquivo | Alteração |
|---------|-----------|
| `supabase/functions/admin-create-user/index.ts` | Trocar `getClaims` por `getUser` |
| `src/pages/AdminUsers.tsx` | Adicionar try/catch em todas as operações assíncronas; remover header individual |
| `src/components/AppLayout.tsx` | **Novo** — layout compartilhado com sidebar |
| `src/App.tsx` | Envolver rotas protegidas com `AppLayout` |
| `src/pages/Index.tsx` | Remover Header interno |
| `src/pages/AdminFuncionarios.tsx` | Remover header/botão voltar |
| `src/pages/AdminIpWhitelist.tsx` | Remover header/botão voltar |
| `src/pages/Account.tsx` | Remover header/botão voltar |

