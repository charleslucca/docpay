

# Renomear arquivos gerados: EMPRESA_CIDADE_CONTRATO_COLABORADOR.pdf

## Mudança

Substituir o padrão atual `2026_Marco_ARIANE_CASTRO_FERNANDES.pdf` por `BSERVICE_ALVORADA_CEMITERIO_VAI_COM_DEUS_ARIANE_CASTRO_FERNANDES.pdf`, onde espaços viram `_`.

## Fonte de dados

1. **Planilha (spreadsheetData)** -- já existe lookup via `findEmployeeInSpreadsheet` que retorna `empresa`, `cidade`, `contrato`
2. **Banco de dados (funcionarios + empresas + municipios)** -- fallback quando planilha não tem o funcionário

## Alterações no arquivo `src/hooks/useDocumentProcessor.ts`

### 1. Batch lookup no banco de dados (antes do loop de geração, ~linha 1555)

Fazer uma query única buscando todos funcionários ativos com joins em empresas e municipios:

```typescript
const { data: dbEmployees } = await supabase
  .from("funcionarios")
  .select("nome_normalizado, contrato, empresas:empresa_id(nome), municipios:municipio_id(nome)")
  .eq("ativo", true);

const dbLookup = new Map<string, { empresa: string; cidade: string; contrato: string }>();
dbEmployees?.forEach(emp => {
  dbLookup.set(emp.nome_normalizado, {
    empresa: emp.empresas?.nome || "",
    cidade: emp.municipios?.nome || "",
    contrato: emp.contrato || "",
  });
});
```

### 2. Construir fileName com novo padrão (~linha 1580)

```typescript
// Buscar na planilha (prioridade) ou no banco de dados (fallback)
let empresa = "", cidade = "", contrato = "";

if (spreadsheetData?.records) {
  const record = findEmployeeInSpreadsheet(pair.employeeName, spreadsheetData.records);
  if (record) {
    empresa = record.empresa;
    cidade = record.cidade;
    contrato = record.contrato;
  }
}

// Fallback: banco de dados
if (!empresa || !cidade || !contrato) {
  const normalized = normalizeForMatch(pair.employeeName);
  const dbInfo = dbLookup.get(normalized);
  if (dbInfo) {
    empresa = empresa || dbInfo.empresa;
    cidade = cidade || dbInfo.cidade;
    contrato = contrato || dbInfo.contrato;
  }
}

const sanitized = (s: string) => sanitizeForStorage(s.replace(/\s+/g, "_"));
const namePart = sanitized(pair.employeeName);

let fileName: string;
if (empresa && cidade && contrato) {
  fileName = `${sanitized(empresa)}_${sanitized(cidade)}_${sanitized(contrato)}_${namePart}.pdf`;
} else {
  // Fallback mínimo
  fileName = `${sanitized(empresa || "EMPRESA")}_${sanitized(cidade || "CIDADE")}_${sanitized(contrato || "CONTRATO")}_${namePart}.pdf`;
}
```

### 3. Atualizar nome do ZIP (~linha 1656)

De `2026_Marco_PDFs.zip` para algo como `BSERVICE_Marco_2026_PDFs.zip` (usando a empresa mais frequente).

## Arquivos alterados

| Arquivo | Alteração |
|---|---|
| `src/hooks/useDocumentProcessor.ts` | DB batch lookup + novo padrão de fileName + import normalizeForMatch |

