

# Diagnóstico: Dois problemas identificados

## 1. Uploads falhando (problema PRINCIPAL visível nos logs)

Os logs do console mostram que o matching **está funcionando** — o sistema encontrou correspondências para múltiplos funcionários (AGDA, EDIANE, MARILDA, ARIANE, EVERTON, JOSE, LUIS, ADRIANA, CLAUDIO, ERONI, TAIANE...). Porém, **todos os uploads falham** com `StorageApiError: Invalid key`.

**Causa raiz**: O caminho de storage contém "Março" (com `ç`), que é um caractere inválido para chaves do Supabase Storage. Na linha 120:
```
storagePath = `${year}/${monthStr}_${monthName}/${fileName}`
// Resultado: "2026/03_Março/2026_Março_ARIANE_CASTRO_FERNANDES.pdf" ← INVÁLIDO
```

**Correção**: Sanitizar o `storagePath` e `fileName` removendo acentos antes do upload, mantendo os nomes com acento apenas para exibição e metadados no banco.

## 2. Matching pode não estar 100% (secundário)

Embora o matching esteja funcionando melhor que antes (era 1, agora são vários), pode não estar capturando todos os 690 funcionários. Para garantir diagnóstico, ativar `DEBUG_MATCH` temporariamente e melhorar a robustez do regex FAVORECIDO.

## Alterações

### Arquivo: `src/hooks/useDocumentProcessor.ts`

**a) Função utilitária `sanitizeForStorage`**: Criar função que remove acentos e caracteres especiais de strings usadas em paths de storage:
```typescript
function sanitizeForStorage(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_\-./\s]/g, "")
    .replace(/\s+/g, "_");
}
```

**b) Aplicar em `uploadGeneratedPdf`** (linha 120): Sanitizar o `storagePath`:
```typescript
const safeMonthName = sanitizeForStorage(monthName);
const safeFileName = sanitizeForStorage(fileName);
const storagePath = `${year}/${monthStr}_${safeMonthName}/${safeFileName}`;
```

**c) Aplicar na geração do fileName** (linha 1506): Sanitizar o nome do funcionário no fileName:
```typescript
const safeName = sanitizeForStorage(pair.employeeName);
const safeMonth = sanitizeForStorage(monthName);
const fileName = `${year}_${safeMonth}_${safeName}.pdf`;
```

### Arquivo: `src/lib/pdfUtils.ts`

**d) Melhorar regex FAVORECIDO**: Adicionar mais keywords no lookahead (`COOPERATIVA|DATA|MODALIDADE|CODIGO|NUMERO`) e remover patterns com `\d` que nunca funcionam no texto normalizado.

**e) Ativar DEBUG_MATCH**: Mudar `DEBUG_MATCH` para `true` temporariamente para diagnóstico.

## Resumo

| Arquivo | Alteração |
|---------|-----------|
| `src/hooks/useDocumentProcessor.ts` | Sanitizar paths de storage (remover acentos), sanitizar fileNames |
| `src/lib/pdfUtils.ts` | Melhorar regex FAVORECIDO, ativar debug |

