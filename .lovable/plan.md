

# Painel de Administracao de Funcionarios (CRUD)

## Objetivo

Criar uma nova pagina `/admin/funcionarios` para gerenciar os registros da tabela `funcionarios`, com listagem, busca, edicao, exclusao e adicao manual.

## Estrutura

A tabela `funcionarios` ja possui: `id`, `nome`, `nome_normalizado`, `empresa_id`, `municipio_id`, `cargo`, `banco`, `contrato`, `ativo`. As tabelas `empresas` e `municipios` fornecem os nomes para exibicao e selecao.

## Alteracoes

### 1. Novo arquivo: `src/pages/AdminFuncionarios.tsx`

Pagina com:
- **Listagem** em tabela: nome, empresa, municipio, cargo, banco, contrato, status (ativo/inativo), acoes
- **Busca** por nome com input de filtro
- **Botao "Adicionar"**: abre Dialog com formulario (nome, empresa via Select, municipio via Select, cargo, banco, contrato)
- **Botao "Editar"** por linha: abre Dialog pre-preenchido com os dados do funcionario
- **Botao "Excluir"** por linha: AlertDialog de confirmacao, deleta o registro
- Carrega empresas e municipios para popular os Selects
- `nome_normalizado` gerado automaticamente a partir do `nome` (uppercase, sem acentos)

### 2. Arquivo: `src/App.tsx`

- Importar `AdminFuncionarios` e adicionar rota `/admin/funcionarios` dentro de `AdminRoute`

### 3. Navegacao

- Adicionar link para o painel de funcionarios no header da pagina Index (junto aos links de admin existentes)

### Arquivos alterados

| Arquivo | Alteracao |
|---------|-----------|
| `src/pages/AdminFuncionarios.tsx` | Novo - pagina CRUD completa |
| `src/App.tsx` | Adicionar rota `/admin/funcionarios` |
| `src/pages/Index.tsx` | Adicionar link de navegacao no menu admin |

