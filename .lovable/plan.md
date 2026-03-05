

# Preview e Validação de Excel na Página Funcionários

## Objetivo

Ao importar um Excel na página de funcionários, o sistema deve:
1. **Validar a estrutura de colunas** — verificar se o Excel contém as colunas obrigatórias: EMPRESA, CIDADE, CONTRATO, COLABORADOR, TOTAL FUNCIONARIOS, BANCO, TIPO
2. **Mostrar preview tabular** dos dados antes de confirmar a importação, exatamente como na imagem (tabela com todas as colunas visíveis)
3. Se a estrutura não corresponder, alertar o usuário com mensagem clara sobre o formato esperado

## Alterações

### 1. `src/lib/excelUtils.ts`

- Adicionar campos `banco` e `tipo` ao `EmployeeRecord` (atualmente só tem empresa, cidade, contrato, colaborador)
- Adicionar campo `totalFuncionarios` (número sequencial da planilha)
- Na função `parseTodosSheet`, mapear as novas colunas: BANCO, TIPO, TOTAL FUNCIONARIOS
- Criar nova função `validateExcelStructure(workbook)` que verifica se existe uma aba "Todos" com as colunas obrigatórias (EMPRESA, CIDADE, CONTRATO, COLABORADOR, TOTAL FUNCIONARIOS, BANCO, TIPO). Retorna `{ valid: boolean, missingColumns: string[] }`
- Atualizar `parseExcelFile` para usar `parseTodosSheet` quando a aba "Todos" existir e tiver a estrutura correta

### 2. `src/components/ExcelDropzone.tsx`

- Após o parsing, em vez de sincronizar automaticamente, mostrar um **preview em tabela** com os dados extraídos (EMPRESA, CIDADE, CONTRATO, COLABORADOR, TOTAL FUNCIONARIOS, BANCO, TIPO)
- Adicionar estado `previewMode: boolean` — quando true, exibe a tabela de preview com botão "Confirmar Importação"
- Se a validação de colunas falhar, exibir alerta com as colunas faltantes e o formato esperado (listar: EMPRESA, CIDADE, CONTRATO, COLABORADOR, TOTAL FUNCIONARIOS, BANCO, TIPO)
- Botão "Confirmar" dispara a sincronização; botão "Cancelar" limpa os dados
- A tabela de preview usa paginação simples (mostrar primeiros 20 registros com scroll)

### 3. `src/lib/supabaseExcelSync.ts`

- Atualizar para receber os novos campos `banco` e `tipo` do `EmployeeRecord` e salvá-los no banco (campo `banco` já existe na tabela `funcionarios`)

## Fluxo

1. Usuário arrasta/seleciona Excel
2. Sistema valida estrutura de colunas
3. Se inválido → mostra alerta com formato esperado
4. Se válido → mostra preview tabular dos dados
5. Usuário confirma → sincroniza com banco de dados

## Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/excelUtils.ts` | Adicionar campos banco/tipo ao EmployeeRecord, criar validateExcelStructure, atualizar parsing |
| `src/components/ExcelDropzone.tsx` | Adicionar preview tabular com validação antes da sincronização |
| `src/lib/supabaseExcelSync.ts` | Mapear novos campos banco/tipo na sincronização |

