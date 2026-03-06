

# Corrigir contagem de funcionários travada no upload

## Causa raiz

Em `src/hooks/useDocumentProcessor.ts` (linhas 406-416), o `pageCount` e `estimatedEmployees` são definidos **juntos** em uma única atualização de estado, **após** `countEmployeesInDocument` terminar. Para um PDF de 690 páginas, essa função lê todas as páginas sequencialmente, demorando muito. A UI fica presa em "Contando páginas..." porque `pageCount` permanece `undefined` até toda a contagem acabar.

## Correção

### Arquivo: `src/hooks/useDocumentProcessor.ts` (linhas 404-416)

Separar em duas atualizações de estado:
1. Definir `pageCount` **imediatamente** após `getCachedPdf` (instantâneo)
2. Definir `estimatedEmployees` **depois** da contagem completa

```typescript
const countPagePromises = newFiles.map(async (uploadedFile) => {
  try {
    const pdf = await getCachedPdf(uploadedFile.file);
    const pageCount = pdf.numPages;

    // Atualizar pageCount IMEDIATAMENTE (instantâneo)
    const setter = type === "holerite" ? setHolerites : setComprovantes;
    setter((prev) =>
      prev.map((f) => (f.id === uploadedFile.id ? { ...f, pageCount } : f)),
    );

    // Contagem precisa em background (pode demorar para PDFs grandes)
    const employeeCount = await countEmployeesInDocument(uploadedFile.file, type, pdf);

    setter((prev) =>
      prev.map((f) => (f.id === uploadedFile.id ? { ...f, estimatedEmployees: employeeCount } : f)),
    );
  } catch (error) {
    console.warn(`[PageCount] Error counting for ${uploadedFile.name}:`, error);
  }
});
```

## Impacto

- O `pageCount` aparece instantaneamente na UI (ex: "690 páginas")
- O `estimatedEmployees` aparece depois, quando a contagem terminar
- A UI do `FileDropzone` já lida com `estimatedEmployees` undefined — mostra apenas o número de páginas até a contagem completar
- Nenhuma outra funcionalidade é afetada

## Arquivo alterado

| Arquivo | Alteração |
|---|---|
| `src/hooks/useDocumentProcessor.ts` | Separar atualização de `pageCount` (imediata) e `estimatedEmployees` (assíncrona) |

