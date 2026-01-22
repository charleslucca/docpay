
# Plano de Correção do Botão Cancelar

## Problema Identificado

O botão "Cancelar" não funciona porque:

1. **A função `processInBatches`** não recebe o flag de cancelamento e continua processando todo o batch
2. **Loops internos** em `getCachedPageTexts` e outros lugares não verificam o cancelamento
3. **Previews em background** continuam gerando mesmo após cancelar

---

## Correções a Implementar

### Correção 1: Passar o flag de cancelamento para `processInBatches`

A função precisa aceitar um `cancelledRef` e verificá-lo antes de processar cada item.

**Arquivo:** `src/hooks/useDocumentProcessor.ts`

Modificar a função `processInBatches` para:
- Receber `cancelledRef: React.MutableRefObject<boolean>` como parâmetro
- Verificar `if (cancelledRef.current)` antes de cada batch e cada item
- Retornar imediatamente se cancelado

### Correção 2: Cache de páginas com suporte a cancelamento

O loop em `getCachedPageTexts` precisa poder ser interrompido.

**Arquivo:** `src/lib/pdfCache.ts`

Modificar `getCachedPageTexts` para:
- Aceitar um callback opcional `shouldCancel?: () => boolean`
- Verificar antes de processar cada página
- Lançar erro ou retornar parcialmente se cancelado

### Correção 3: Cancelar geração de previews

A geração lazy de previews no `requestIdleCallback` não para quando o usuário cancela.

**Arquivo:** `src/hooks/useDocumentProcessor.ts`

Modificar `generatePreviewsLazy` para:
- Verificar `cancelledRef.current` antes de cada preview
- Parar imediatamente se cancelado

### Correção 4: Verificação imediata no loop de matching

O loop de matching em memória (linhas 214-259) só verifica `if (cancelledRef.current) break;` no início do loop de comprovantes, mas não sai completamente da função.

**Arquivo:** `src/hooks/useDocumentProcessor.ts`

Adicionar:
- Verificação após cada matching encontrado
- Return imediato se cancelado, não apenas break

---

## Arquivos a Modificar

1. **`src/hooks/useDocumentProcessor.ts`** - Passar cancelledRef para processInBatches e corrigir loops
2. **`src/lib/pdfCache.ts`** - Adicionar suporte a cancelamento em getCachedPageTexts

---

## Código das Correções

### Correção em processInBatches

A função passará a receber o ref e verificar cancelamento:

```text
async function processInBatches<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  concurrency: number,
  cancelledRef?: React.MutableRefObject<boolean>  // NOVO
): Promise<R[]> {
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i += concurrency) {
    // NOVO: Verificar antes de cada batch
    if (cancelledRef?.current) break;
    
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(...);
    
    // NOVO: Verificar após cada batch
    if (cancelledRef?.current) break;
    
    // ... resto
  }
  
  return results;
}
```

### Correção em getCachedPageTexts

Adicionar callback de cancelamento:

```text
export async function getCachedPageTexts(
  file: File, 
  shouldCancel?: () => boolean  // NOVO
): Promise<string[]> {
  // ...
  for (let i = 1; i <= pdf.numPages; i++) {
    // NOVO: Verificar cancelamento antes de cada página
    if (shouldCancel?.()) {
      break;
    }
    // processar página...
  }
}
```

### Correção no loop de previews

```text
const generatePreviewsLazy = async () => {
  for (const pair of pairs) {
    // NOVO: Verificar cancelamento
    if (cancelledRef.current) break;
    
    // gerar preview...
  }
};
```

---

## Resultado Esperado

Após as correções:
- O botão "Cancelar" irá interromper o processamento em até 1-2 segundos
- Nenhum trabalho adicional será feito após cancelar
- O status voltará para "idle" imediatamente
- A memória será preservada (itens já processados ficam disponíveis)
