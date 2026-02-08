

# Correção: Extração Inteligente do Município

## Entendimento do Padrão

A linha do município segue o formato: `[PARTE1] - [PARTE2] - [BANCO]`

| Exemplo | Parte 1 | Parte 2 | Banco | Cidade Real |
|---------|---------|---------|-------|-------------|
| `GRAMADO - PORTEIROS - ITAÚ` | GRAMADO | PORTEIROS | ITAÚ | **GRAMADO** (1a posição) |
| `IPAM - CAXIAS DO SUL - ITAÚ` | IPAM | CAXIAS DO SUL | ITAÚ | **CAXIAS DO SUL** (2a posição) |

A diferença: **IPAM** é um prefixo/sigla (tipo de contrato), não um município. Precisamos identificar esses prefixos.

---

## Regras de Extração

### Estrutura da Planilha
```
Linha 1: Empresa (B SERVICE, SPACE, FORTCLEAN, INTERCLEAN)
         OU "Colunas1" (nesse caso, empresa na Linha 2)

Linha 2: Município no formato "[CIDADE ou PREFIXO] - [DESCRICAO] - [BANCO]"
         (ou Linha 3 se Linha 1 = "Colunas1")

Linha 3+: Funcionários (pulando linha "NOME" se existir)
```

### Prefixos Conhecidos (NÃO são cidades)
Estes termos na primeira posição indicam que a cidade está na segunda posição:
- IPAM
- IFRS
- SESI
- MIN AGRIC (Ministério Agricultura)
- FARMACIA
- METROPOLITANA

### Funções (aparecem na segunda posição quando cidade está na primeira)
- PORTEIROS
- LIMPEZA
- COZINHA
- VIGILANCIA
- MANUTENCAO
- CAMARA
- PACO

---

## Mudanças Técnicas

### Nova Funcao: `extractCityFromLine()`

```typescript
/**
 * Extrai o município de uma linha no formato:
 * "[CIDADE] - [FUNCAO] - [BANCO]" ou "[PREFIXO] - [CIDADE] - [BANCO]"
 */
function extractCityFromLine(line: string): string {
  const parts = line.split(/\s*-\s*/);
  
  if (parts.length < 2) {
    return parts[0]?.trim() || "";
  }
  
  const firstPart = normalizeForComparison(parts[0] || "");
  const secondPart = parts[1]?.trim() || "";
  
  // Lista de prefixos conhecidos (NÃO são cidades)
  const knownPrefixes = [
    "IPAM",
    "IFRS", 
    "SESI",
    "MIN AGRIC",
    "MINISTERIO",
    "FARMACIA",
    "METROPOLITANA",
    "SS CAI",        // São Sebastião do Caí (abreviado)
  ];
  
  // Se primeira parte é um prefixo conhecido, cidade está na segunda parte
  if (knownPrefixes.some(prefix => firstPart.startsWith(prefix) || firstPart === prefix)) {
    return secondPart;
  }
  
  // Lista de funções/cargos (indicam que cidade está na primeira parte)
  const knownFunctions = [
    "PORTEIRO",
    "LIMPEZA",
    "COZINHA",
    "VIGILANCIA",
    "MANUTENCAO",
    "CAMARA",
    "PACO",
    "OBRAS",
    "RECEPCAO",
    "ASSISTENCIA",
    "ZELADOR",
  ];
  
  // Se segunda parte é função, cidade está na primeira parte
  const secondNorm = normalizeForComparison(secondPart);
  if (knownFunctions.some(func => secondNorm.startsWith(func) || secondNorm.includes(func))) {
    return parts[0]?.trim() || "";
  }
  
  // Bancos conhecidos (aparecem na última posição)
  const knownBanks = ["ITAU", "SICREDI", "BRADESCO", "CAIXA", "BB", "SANTANDER", "BANRISUL", "PREFEITURA"];
  
  // Se segunda parte é banco, cidade está na primeira
  if (knownBanks.some(bank => secondNorm.includes(bank))) {
    return parts[0]?.trim() || "";
  }
  
  // Default: primeira parte é a cidade
  return parts[0]?.trim() || "";
}
```

### Atualizar `looksLikeCompany()`

Adicionar todas as empresas conhecidas:

```typescript
function looksLikeCompany(value: string): boolean {
  const normalized = value.trim().toUpperCase();
  const companies = ["B SERVICE", "SPACE", "FORTCLEAN", "INTERCLEAN"];
  return companies.some(c => normalized.startsWith(c) || normalized === c);
}
```

### Atualizar `parseMunicipalitySheets()`

Simplificar a lógica de extração:

```typescript
// Passo 1: Detectar offset (Colunas1)
let offset = 0;
const firstCellValue = String(jsonData[0]?.[0] || "").trim().toUpperCase();
if (/^COLUNA[S]?\d*$/i.test(firstCellValue) || firstCellValue === "") {
  offset = 1;
}

// Passo 2: Empresa SEMPRE na linha após offset
const empresaRow = jsonData[offset] as unknown[];
const empresaValue = String(empresaRow?.[0] || "").trim();

let empresa = "";
let cidadeRowIndex = offset + 1;

if (looksLikeCompany(empresaValue)) {
  empresa = empresaValue;
} else {
  // Se linha não é empresa conhecida, pode ser empresa nova ou erro
  empresa = empresaValue;
}

// Passo 3: Município na linha seguinte
const cidadeRow = jsonData[cidadeRowIndex] as unknown[];
const cidadeValue = String(cidadeRow?.[0] || "").trim();

// Usar nova função para extrair cidade corretamente
const cidade = extractCityFromLine(cidadeValue);

// Passo 4: Funcionários começam após a linha de cidade
let startIndex = cidadeRowIndex + 1;

// Pular linha "NOME" se existir
// ... resto da lógica
```

---

## Arquivo a Modificar

| Arquivo | Alteracoes |
|---------|-----------|
| `src/lib/excelUtils.ts` | Adicionar `extractCityFromLine()`, atualizar `looksLikeCompany()`, simplificar `parseMunicipalitySheets()` |

---

## Exemplos de Extração

| Linha Original | Parte 1 | Parte 2 | Resultado |
|----------------|---------|---------|-----------|
| `GRAMADO - PORTEIROS - ITAÚ` | GRAMADO | PORTEIROS | cidade = **GRAMADO** |
| `IPAM - CAXIAS DO SUL - ITAÚ` | IPAM | CAXIAS DO SUL | cidade = **CAXIAS DO SUL** |
| `ALEGRETE - CÂMARA - SICREDI` | ALEGRETE | CÂMARA | cidade = **ALEGRETE** |
| `SESI - PORTO ALEGRE - ITAÚ` | SESI | PORTO ALEGRE | cidade = **PORTO ALEGRE** |
| `TORRES - LIMPEZA - PREFEITURA` | TORRES | LIMPEZA | cidade = **TORRES** |

---

## Resultado Esperado

- Empresas detectadas: B SERVICE, SPACE, FORTCLEAN, INTERCLEAN
- IPAM, IFRS, SESI serão reconhecidos como prefixos (não cidades)
- Cada município terá contagem correta de funcionários
- Total: ~1004 funcionários

