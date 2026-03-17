

## Análise da Nova Planilha

### Formato identificado: "Relação da Folha por Empregado"

É um relatório de folha de pagamento com estrutura completamente diferente das planilhas anteriores.

**Cabeçalho (linhas 1-4):**
| Linha | Campo | Exemplo |
|---|---|---|
| 1 | Empresa | 2 - B SERVICE PRESTADORA DE SERVICOS EIRELI |
| 2 | CNPJ | 29.639.536/0001-33 |
| 3 | Cálculo | Folha Mensal |
| 4 | Competência | 02/2026 |

**Colunas de dados (linha 8):**
Código | Nome do empregado | Salário | Out.Prov | Sal.Fam | INSS | IRRF | Out.Des | Líquid | FGTS

**Agrupamento:** Dados agrupados por linhas `Serviço: N-NOME DO SERVIÇO/MUNICÍPIO`, com sub-seções "Empregados" e "Contribuintes". Cada grupo tem uma linha "Total" no final.

### Comparação com formato anterior

| Aspecto | Formato anterior | Novo formato |
|---|---|---|
| Estrutura | Aba "Todos" + abas por cidade | Única aba, agrupado por "Serviço" |
| Empresa | Coluna EMPRESA | Cabeçalho fixo (linha 1) |
| Cidade | Coluna CIDADE ou nome da aba | Extraída de "Serviço: N-MUNICIPIO DE X" |
| Contrato | Coluna CONTRATO | Número/nome do Serviço |
| Colaborador | Coluna COLABORADOR | Coluna "Nome do empregado" |
| Banco | Coluna BANCO | Não existe |
| Observações | Coluna OBSERVAÇÕES | Não existe |
| Salário | Coluna SALARIO | Coluna "Salário" |
| Código funcionário | Não existia | Coluna "Código" (NOVO) |
| Dados financeiros | Não existiam | Out.Prov, Sal.Fam, INSS, IRRF, Out.Des, Líquid, FGTS (NOVOS) |
| CNPJ | Não existia | Cabeçalho (NOVO) |
| Competência | Não existia | Cabeçalho (NOVO) |

---

## Mapeamento dos campos

| Coluna da planilha | Campo EmployeeRecord | Campo DB (funcionarios) | Observação |
|---|---|---|---|
| Empresa (header) | `empresa` | `empresa_id` → tabela `empresas` | Extrair nome limpo (sem o prefixo numérico) |
| Serviço (agrupador) | `cidade` | `municipio_id` → tabela `municipios` | Extrair nome do município da linha "Serviço:" |
| Serviço (agrupador) | `contrato` | `contrato` | Usar o texto completo do serviço |
| Nome do empregado | `colaborador` | `nome` / `nome_normalizado` | Igual ao fluxo atual |
| Código | `codigo` (novo) | `codigo` (novo campo) | Código do empregado na folha |
| Salário | `salario` | `funcionarios_salario.salario` | Dado sensível, tabela separada |
| CNPJ | metadado | não armazenado | Metadata do header |
| Out.Prov, Sal.Fam, INSS, IRRF, Out.Des, Líquid, FGTS | dados financeiros | `funcionarios_salario` (novas colunas) | Dados sensíveis, mesma tabela de salário |

---

## Plano de Implementação

### Etapa 1: Migração do banco de dados

- Adicionar coluna `codigo` (text, nullable) à tabela `funcionarios`
- Adicionar colunas financeiras à tabela `funcionarios_salario`: `outros_proventos`, `salario_familia`, `inss`, `irrf`, `outros_descontos`, `liquido`, `fgts` (todas numeric, nullable)

Não criar novas tabelas. Reutilizar `funcionarios_salario` que já tem RLS configurada para admin/financeiro.

### Etapa 2: Novo parser em `excelUtils.ts`

Adicionar função `parsePayrollReport()` que:
1. Detecta o formato pela presença de "RELAÇÃO DA FOLHA POR EMPREGADO" no texto
2. Extrai empresa do header (linha 1), limpando prefixo numérico "2 - "
3. Itera pelas linhas, detectando "Serviço:" para trocar cidade/contrato atual
4. Para cada linha de empregado (tem código numérico na coluna A), extrai nome e dados financeiros
5. Ignora linhas de total, subtotal, cabeçalho "Empregados", "Contribuintes"
6. Retorna `SpreadsheetData` no mesmo formato que os parsers existentes

Extração de cidade do "Serviço:":
- `"6-MUNICIPIO DE SANTO ANTONIO DA PATRULHA"` → cidade = `"SANTO ANTONIO DA PATRULHA"`
- `"1-B SERVICE PRESTADORA DE SERVICOS EIRELI"` → cidade = empresa (serviço interno)
- `"14-IPAM INST DE PREV E ASS MUNICIPAL"` → cidade = `"IPAM INST DE PREV E ASS MUNICIPAL"`

### Etapa 3: Atualizar `EmployeeRecord` e detecção de formato

- Adicionar `codigo?: string` ao `EmployeeRecord`
- Adicionar campos financeiros opcionais
- Na função `parseExcelFile()`, adicionar detecção do novo formato ANTES dos parsers existentes:
  - Se encontra "RELAÇÃO DA FOLHA" → usa `parsePayrollReport()`
  - Senão → fluxo atual (Todos → Municipality sheets)

### Etapa 4: Atualizar sincronização (`supabaseExcelSync.ts`)

- Incluir `codigo` no insert/update de funcionarios
- Incluir campos financeiros no upsert de `funcionarios_salario`
- Sanitizar logs (nunca expor valores financeiros)

### Etapa 5: UI (`AdminFuncionarios.tsx`)

- Exibir coluna "Código" na tabela de funcionários
- Exibir colunas financeiras apenas para admin/financeiro (junto com salário)

### Preservação do fluxo de PDFs

`findEmployeeInSpreadsheet` e `enrichNamesWithSpreadsheet` continuam funcionando sem alteração — operam sobre `colaborador`, `empresa`, `cidade` que são preenchidos normalmente pelo novo parser.

---

## Alterações por arquivo

| Arquivo | Alteração |
|---|---|
| Migration SQL | `codigo` em funcionarios; colunas financeiras em funcionarios_salario |
| `src/lib/excelUtils.ts` | Nova função `parsePayrollReport()`; campos novos no interface; detecção de formato |
| `src/lib/supabaseExcelSync.ts` | Sync de `codigo` e dados financeiros |
| `src/pages/AdminFuncionarios.tsx` | Exibir código e dados financeiros (condicional) |
| `src/integrations/supabase/types.ts` | Auto-atualizado após migration |

