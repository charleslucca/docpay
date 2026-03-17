

## Diagnóstico da Planilha

### Aba "Todos" (Page 1) — Novo formato de colunas:
| Coluna Atual | Coluna Nova | Status |
|---|---|---|
| EMPRESA | EMPRESA | Igual |
| CIDADE | CIDADE | Igual |
| CONTRATO | CONTRATO | Igual |
| COLABORADOR | COLABORADOR | Igual |
| TOTAL FUNCIONARIOS | *(removida)* | Não existe mais |
| TIPO | *(removida)* | Não existe mais |
| BANCO | BANCO | Igual |
| *(nova)* | OBSERVAÇÕES | Nova coluna (emails, CPFs, telefones) |
| *(nova)* | SALARIO | Nova coluna (dado sensível) |

### Abas por cidade — Formato:
```
SPACE - ESTEIO - SICREDI
NOME | SALARIO | (numeração)
```
Cada aba de cidade contém NOME e SALARIO dos funcionários daquela localidade.

---

## Plano de Implementação

### Etapa 1: Migração do banco de dados

Adicionar colunas à tabela `funcionarios`:
- `observacoes` (text, nullable) — armazena observações/contatos
- `salario` (numeric, nullable) — dado sensível

Adicionar nova role ao enum `app_role`:
- `financeiro` — para controle de acesso ao salário

Criar política RLS para proteger o campo salário:
- Criar uma view ou usar política que exclui o campo salário para não-financeiros
- Alternativa mais segura: criar uma tabela separada `funcionarios_salario` com RLS restrita a `financeiro` e `admin`

**Decisão arquitetural: tabela separada para salário.** Isso é mais seguro porque:
- RLS no Postgres não opera por coluna, apenas por linha
- Uma tabela separada permite bloquear completamente o acesso SELECT para não-autorizados
- Evita vazamento acidental em qualquer query que selecione `*`

Estrutura:
```sql
-- Nova tabela para salários (isolada por segurança)
CREATE TABLE public.funcionarios_salario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id uuid REFERENCES public.funcionarios(id) ON DELETE CASCADE NOT NULL,
  salario numeric,
  UNIQUE(funcionario_id)
);

-- RLS: apenas admin e financeiro podem ler
ALTER TABLE public.funcionarios_salario ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance and admin read salario"
  ON public.funcionarios_salario FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'financeiro'));

CREATE POLICY "Admin insert salario"
  ON public.funcionarios_salario FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin update salario"
  ON public.funcionarios_salario FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Adicionar observacoes à tabela funcionarios
ALTER TABLE public.funcionarios ADD COLUMN observacoes text;

-- Adicionar 'financeiro' ao enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'financeiro';
```

### Etapa 2: Atualizar importação Excel (`src/lib/excelUtils.ts`)

1. Atualizar `REQUIRED_COLUMNS` — remover "TOTAL FUNCIONARIOS" e "TIPO", adicionar "OBSERVAÇÕES" (opcional) e "SALARIO" (opcional)
2. Atualizar `EmployeeRecord` interface — adicionar `observacoes?: string` e `salario?: number`
3. Adicionar aliases: `OBSERVACOES_ALIASES = ["OBSERVACOES", "OBSERVAÇÕES", "OBS"]` e `SALARIO_ALIASES = ["SALARIO", "SALÁRIO", "SAL", "REMUNERACAO"]`
4. Atualizar `parseTodosSheet` para extrair as novas colunas
5. Atualizar `parseMunicipalitySheets` para extrair SALARIO das abas por cidade
6. **Sanitizar logs**: nunca logar o valor do salário. Substituir `console.log` que possam incluir records completos

### Etapa 3: Atualizar sincronização (`src/lib/supabaseExcelSync.ts`)

1. Adicionar `observacoes` ao fluxo de insert/update de `funcionarios`
2. Após inserir/atualizar funcionários, fazer upsert em `funcionarios_salario` para registros que possuem salário
3. Sanitizar todos os `console.log` para não expor salários
4. Nunca incluir salário em mensagens de erro

### Etapa 4: Atualizar `useAuth.tsx`

1. Expandir `AppRole` para incluir `"financeiro"`

### Etapa 5: UI — AdminFuncionarios

1. Exibir coluna "Observações" na tabela de funcionários
2. Exibir coluna "Salário" APENAS se o usuário tem role `admin` ou `financeiro`
3. Buscar dados de `funcionarios_salario` em query separada (só se autorizado)

### Etapa 6: Lógica de geração de PDFs — Sem alteração

A busca de funcionários para geração de PDFs usa `findEmployeeInSpreadsheet` e `enrichNamesWithSpreadsheet`, que operam sobre `colaborador`, `empresa`, `cidade`. Esses campos não mudam. O salário e observações não participam desse fluxo. Nenhuma alteração necessária.

---

## Riscos de segurança mitigados

| Risco | Mitigação |
|---|---|
| Salário exposto via SELECT * | Tabela separada com RLS |
| Salário em logs/console | Sanitização em excelUtils e supabaseExcelSync |
| Salário em payloads do frontend | Query separada, só executada se role permite |
| Escalação de privilégio | Role verificada via `has_role()` server-side |
| Salário em mensagens de erro | Try/catch sem serializar o record |

## Arquivos alterados

| Arquivo | Alteração |
|---|---|
| Migration SQL | Nova tabela `funcionarios_salario`, coluna `observacoes`, enum `financeiro` |
| `src/lib/excelUtils.ts` | Novas colunas, aliases, parsing |
| `src/lib/supabaseExcelSync.ts` | Sync de observacoes + salario (tabela separada) |
| `src/hooks/useAuth.tsx` | Tipo `AppRole` expandido |
| `src/pages/AdminFuncionarios.tsx` | Exibir observacoes; salário condicional |
| `src/integrations/supabase/types.ts` | Auto-gerado após migration |

