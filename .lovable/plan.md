

## Diagnóstico

O padrão 7 da extração de nomes (`\b([A-Z]{3,15}(?:\s+[A-Z]{2,15}){1,4})\b`) é genérico demais e captura fragmentos de texto como "DE SETEMBRO", "DE OUTUBRO", etc. como nomes válidos. Isso ocorre porque:

1. "SETEMBRO", "OUTUBRO" e outros meses **não estão** na lista `invalidWords`
2. "DE" tem 2 caracteres e passa no filtro `w.length > 1`
3. Essas palavras são todas maiúsculas, então o padrão genérico as captura

Resultado: o sistema extrai "DE SETEMBRO" como nome de funcionário, tenta fazer matching com os comprovantes, falha, e aparece no relatório de não processados.

## Correção

### Arquivo: `src/lib/pdfUtils.ts`, lista `invalidWords` (linhas 303-349)

Adicionar à lista de palavras inválidas:

**Meses do ano:**
`JANEIRO`, `FEVEREIRO`, `MARCO`, `ABRIL`, `MAIO`, `JUNHO`, `JULHO`, `AGOSTO`, `SETEMBRO`, `OUTUBRO`, `NOVEMBRO`, `DEZEMBRO`

**Palavras de calendário/período:**
`SEMESTRE`, `TRIMESTRE`, `BIMESTRE`, `QUINZENA`, `MENSALISTA`, `HORISTA`

**Preposições isoladas que nunca iniciam nomes válidos (validação extra):**
Adicionar validação: se a primeira palavra do nome for uma preposição curta (`DE`, `DA`, `DO`, `DAS`, `DOS`, `EM`, `NO`, `NA`, `AO`, `AS`, `OS`, `POR`), rejeitar — nomes de pessoas nunca começam com preposição.

### Lógica adicional (após validação 3):

```typescript
// Validação 4: nome não pode começar com preposição
const prepositions = ["DE", "DA", "DO", "DAS", "DOS", "EM", "NO", "NA", "AO", "AS", "OS", "POR", "ATE", "COM", "SEM", "SOB"];
if (prepositions.includes(words[0])) {
  if (debug) console.log("[DEBUG] Ignorando - começa com preposição:", name);
  continue;
}
```

## Impacto

- "DE SETEMBRO", "DE OUTUBRO", etc. serão rejeitados por ambas as validações (mês na invalidWords + começa com preposição)
- Nomes reais como "MARIA DE SETEMBRO" (improvável mas possível) seriam aceitos pois "MARIA" não é preposição
- Reduz ruído no relatório de não processados, mostrando apenas funcionários reais

## Arquivo alterado

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/pdfUtils.ts` | Adicionar meses e termos de período à `invalidWords`; adicionar validação contra nomes iniciando com preposição |

