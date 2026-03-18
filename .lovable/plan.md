

# Auditoria e Correção: Normalização de Nomes

## Diagnóstico

Existem **duas funções de normalização independentes** no sistema que tratam nomes de forma diferente:

| Função | Arquivo | Usado para | Remove não-letras? | Remove chars invisíveis? |
|--------|---------|------------|---------------------|--------------------------|
| `normalizeForMatch` | pdfUtils.ts | PDFs | Sim (`[^A-Z\s]`) | Parcial (via regex) |
| `normalizeForComparison` | excelUtils.ts | Excel/DB | **Não** | **Não** |

### Problemas identificados

1. **`normalizeForComparison` não remove caracteres invisíveis**: Zero-width spaces (`\u200B`), BOM (`\uFEFF`), zero-width joiners (`\u200D`), soft hyphens (`\u00AD`) sobrevivem à normalização. Esses chars são comuns em copiar/colar de sistemas bancários e ERPs.

2. **`normalizeForComparison` mantém dígitos e pontuação**: Se um nome no Excel tiver `"JOAO.SILVA"` ou `"JOAO1SILVA"`, eles não são removidos — mas em `normalizeForMatch` seriam.

3. **Não há função centralizada de sanitização**: Cada ponto do pipeline aplica sua própria normalização, criando inconsistências quando nomes passam de Excel → DB → comparação com PDF.

4. **Non-breaking spaces (`\u00A0`)**: Ambas as funções tratam via `\s+`, mas tabs e `\r\n` só são tratados por `normalizeForMatch` (via `[^A-Z\s]`).

## Correções

### 1. Criar função centralizada `sanitizeName` (`src/lib/nameUtils.ts`)

Novo arquivo com uma única função de sanitização usada por todo o pipeline:

```
sanitizeName(raw: string): string
  1. Strip BOM, zero-width chars, soft hyphens
  2. Replace non-breaking spaces, tabs, newlines → space
  3. NFD + remove combining marks (accents)
  4. Uppercase
  5. Replace hyphens/apostrophes → space
  6. Remove tudo que não é A-Z ou espaço
  7. Collapse múltiplos espaços → um
  8. Trim
```

Exportar também `debugNameBytes(name: string): string` que retorna representação hex para diagnóstico.

### 2. Unificar normalização (`pdfUtils.ts` + `excelUtils.ts`)

- `normalizeForMatch` → delegar para `sanitizeName` (manter OCR fixes 0→O, 1→I, 5→S como passo adicional)
- `normalizeForComparison` → delegar para `sanitizeName` (sem OCR fixes)
- Garantir que ambos os caminhos produzem output identico para o mesmo input

### 3. Sanitizar na entrada de dados (`excelUtils.ts`)

- Aplicar `sanitizeName` ao campo `colaborador` no momento do parsing (antes de armazenar)
- Adicionar log `[SANITIZE]` quando o valor sanitizado difere do original, mostrando bytes hex da diferença

### 4. Adicionar testes de regressão (`src/test/matching.test.ts`)

- Teste com non-breaking space: `"DENIZE\u00A0BERNARDES"` vs `"DENIZE BERNARDES"`
- Teste com zero-width space: `"DENIZE\u200BBERNARDES"` vs `"DENIZE BERNARDES"`
- Teste com BOM: `"\uFEFFDENIZE"` vs `"DENIZE"`
- Teste com tab: `"DENIZE\tBERNARDES"` vs `"DENIZE BERNARDES"`
- Confirmar que todos os 31 testes existentes continuam passando

## Arquivos

| Arquivo | Ação |
|---------|------|
| `src/lib/nameUtils.ts` | **Novo** — sanitizeName + debugNameBytes |
| `src/lib/pdfUtils.ts` | Refatorar normalizeForMatch para usar sanitizeName |
| `src/lib/excelUtils.ts` | Refatorar normalizeForComparison para usar sanitizeName; sanitizar colaborador no parsing |
| `src/test/matching.test.ts` | Adicionar testes de chars invisíveis |

## Resultado esperado

Nomes visualmente idênticos serão sempre tratados como iguais, independente de chars invisíveis, encoding ou origem (Excel vs PDF). Log automático detecta e reporta inconsistências em novos uploads.

