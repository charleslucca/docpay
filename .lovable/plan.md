

# Selecao em massa + Exclusao em lote + Paginacao na pagina Funcionarios

## Alteracoes em `src/pages/AdminFuncionarios.tsx`

### 1. Selecao em massa e exclusao em lote

- Adicionar estado `selectedIds: Set<string>` para rastrear selecao
- Checkbox "Selecionar todos" no header da tabela (seleciona apenas os da pagina atual)
- Checkbox individual em cada linha
- Toolbar condicional: quando houver selecionados, exibir botao "Excluir selecionados (N)" com icone destrutivo
- AlertDialog de confirmacao para exclusao em lote, executando `.delete().in('id', [...])`
- Limpar selecao apos exclusao ou mudanca de filtro/pagina
- Import: `Checkbox` de `@/components/ui/checkbox`

### 2. Paginacao

- Adicionar estados: `currentPage` (numero) e `pageSize` (10 | 25 | 50, default 10)
- Calcular `paginatedItems` a partir de `filtered.slice(start, end)`
- Abaixo da tabela: barra com Select para escolher itens por pagina (10, 25, 50), indicador "Mostrando X-Y de Z", e botoes Anterior/Proximo
- Resetar `currentPage` para 1 ao mudar busca ou pageSize
- Import: `ChevronLeft`, `ChevronRight` de lucide

### Arquivo alterado

| Arquivo | Alteracao |
|---------|-----------|
| `src/pages/AdminFuncionarios.tsx` | Adicionar selecao em massa, exclusao em lote e paginacao |

