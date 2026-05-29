# Corrigir chamada da função admin-create-user

## Problema
Em `src/pages/AdminUsers.tsx` (linha 51) a URL da edge function está hardcoded para o Supabase Cloud:
```
https://zouizzfomwrxfptgxkwj.supabase.co/functions/v1/admin-create-user
```
Por isso a criação de usuário retorna 401 — está batendo no projeto cloud (que não tem JWT válido do seu VPS), e não no seu servidor `191.101.234.62:8443`.

## Solução
Substituir a chamada `fetch` direta por `supabase.functions.invoke('admin-create-user', { body })`, usando o client já configurado em `src/integrations/supabase/client.ts` (que aponta para o VPS). Assim a URL passa a ser dinâmica e o token de sessão do usuário é enviado automaticamente.

## Arquivo afetado
- `src/pages/AdminUsers.tsx` — remover `FUNCTION_URL`, remover montagem manual do header `Authorization`/`apikey`, usar `supabase.functions.invoke`.

## Validação
1. Recarregar a página de admin
2. Criar um usuário de teste
3. Confirmar na aba Network que a requisição vai para `https://191.101.234.62:8443/functions/v1/admin-create-user` com status 200
