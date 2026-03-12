

# Corrigir regressao de matching: 12 matches em vez de 65+

## Diagnostico

O console mostra:
- 146 funcionarios extraidos dos holerites (correto)
- 70 paginas de comprovante com texto nativo (correto)
- **Apenas 12 matches** (deveria ser 65+)

Dois problemas identificados no loop de matching (`useDocumentProcessor.ts`, linhas 1204-1309):

### Problema 1: Bloqueio de paginas com multiplos funcionarios

Na linha 1224, `matchedPages` impede que mais de um funcionario seja associado a mesma pagina do comprovante. Com 70 paginas para 146 funcionarios (~2 por pagina), isso bloqueia metade dos matches legitimos.

O comprovante bancario (SICREDI) tipicamente lista varios favorecidos por pagina. O primeiro funcionario encontrado na pagina "trava" a pagina, e todos os demais que tambem aparecem naquela pagina sao rejeitados.

### Problema 2: Validacao cruzada com `extractEmployeeName` inadequada

Na linha 1266, o codigo extrai um nome do texto do comprovante usando `extractEmployeeName(comprovanteText, false)`. Essa funcao foi projetada para **holerites B SERVICE** (busca padrao "codigo + nome + CBO"). Quando aplicada ao texto de comprovantes bancarios, ela frequentemente extrai o nome errado (outro funcionario na mesma pagina, ou texto de cabecalho), causando rejeicao pelo `namesEquivalent`.

## Correcao

### Arquivo: `src/hooks/useDocumentProcessor.ts`

**Correcao 1** (linhas 1224, 1276-1279): Remover o `matchedPages` Set que bloqueia paginas. Comprovantes bancarios podem conter multiplos funcionarios na mesma pagina -- cada um deve poder ser matched independentemente.

**Correcao 2** (linhas 1265-1269): Remover a validacao cruzada com `extractEmployeeName` no comprovante. O `findNameInPreparedPage` ja faz matching robusto (exato, primeiro+ultimo nome, fuzzy, substring). A validacao adicional com uma funcao projetada para outro formato de documento causa falsos negativos.

### Logica resultante simplificada:

```typescript
for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
  if (findNameInPreparedPage(preparedPages[pageIdx], entry.prepared)) {
    foundPage = pageIdx + 1;
    break;
  }
}
```

## Impacto

| Aspecto | Antes | Depois |
|---------|-------|--------|
| Matches encontrados | 12 | ~65+ (restaurado) |
| Paginas bloqueadas | Sim (1 match/pagina) | Nao (multiplos por pagina) |
| Validacao cruzada | extractEmployeeName (incorreta para comprovantes) | Removida |

## Arquivos alterados

| Arquivo | Alteracao |
|---------|-----------|
| `src/hooks/useDocumentProcessor.ts` | Remover `matchedPages` e validacao `extractEmployeeName` no matching |

