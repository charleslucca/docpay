

# Exibir Contagem de Funcionários por Cidade

## Objetivo

Mostrar quantos funcionários existem em cada aba/cidade da planilha Excel, para validar que o total de 21 funcionários está distribuído corretamente entre as 9 cidades.

---

## Mudanças Técnicas

### 1. Atualizar Interface `SpreadsheetData`

Adicionar um novo campo `funcionariosPorCidade` que mapeia cada cidade para sua contagem:

```typescript
export interface SpreadsheetData {
  records: EmployeeRecord[];
  empresas: string[];
  cidades: string[];
  funcionariosPorCidade: Record<string, number>;  // ← NOVO
  fileName: string;
}
```

### 2. Calcular Contagem no Parser

Modificar `parseMunicipalitySheets` e `parseTodosSheet` para contar funcionários por cidade:

```typescript
// Após parsear todos os records
const funcionariosPorCidade: Record<string, number> = {};
for (const record of records) {
  funcionariosPorCidade[record.cidade] = (funcionariosPorCidade[record.cidade] || 0) + 1;
}
```

### 3. Exibir Contagem no Componente Visual

Modificar `ExcelDropzone.tsx` para mostrar a contagem ao lado de cada cidade:

```
┌─────────────────────────────────────────────────────────────────┐
│  Cidades encontradas:                                           │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐   │
│  │ CARAZINHO (3)   │ │ ALEGRETE (2)    │ │ DOM PEDRITO (4) │   │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘   │
│  ┌─────────────────┐ ┌─────────────────┐ ...                   │
│  │ FLORES (2)      │ │ CACHOEIRA (3)   │                       │
│  └─────────────────┘ └─────────────────┘                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Arquivos a Modificar

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/excelUtils.ts` | Adicionar `funcionariosPorCidade` à interface e calcular no parser |
| `src/components/ExcelDropzone.tsx` | Exibir contagem ao lado de cada badge de cidade |

---

## Resultado Esperado

Após o upload da planilha, ao clicar em "Cidades", cada badge mostrará:
- Nome da cidade
- Quantidade de funcionários entre parênteses

Exemplo: `CARAZINHO (3)` | `ALEGRETE (2)` | `DOM PEDRITO (4)`

Isso permitirá validar rapidamente se os 21 funcionários estão distribuídos corretamente nas 9 cidades.

