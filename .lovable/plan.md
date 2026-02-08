

# Correção: Estimativa de Funcionários por Páginas

## Problema Identificado

O sistema atualmente estima funcionários simplesmente contando páginas do PDF:

```typescript
// src/hooks/useDocumentProcessor.ts - linha 261
estimatedEmployees: pageCount  // 691 páginas = 691 funcionários (ERRADO!)
```

Isso causa estimativas incorretas porque:
- A última página pode ser um resumo/total (não é um holerite)
- Páginas em branco ou de capa são contadas
- Páginas de instruções/cabeçalhos são contadas

## Solução

Melhorar a estimativa inicial usando uma **análise rápida** das primeiras páginas para detectar padrões, e adicionar indicação visual clara de que é uma **estimativa aproximada**.

### Opção 1: Estimativa mais conservadora (rápida de implementar)
Reduzir a estimativa em 1 página automaticamente para PDFs grandes (>10 páginas), já que geralmente a última página é um resumo.

### Opção 2: Validação por amostragem (mais precisa)
Fazer OCR rápido em 2-3 páginas aleatórias para verificar se são holerites válidos e ajustar proporcionalmente.

**Recomendação:** Opção 1 é suficiente para o problema atual e não afeta performance.

---

## Alterações Propostas

### 1. Ajustar estimativa no upload (`src/hooks/useDocumentProcessor.ts`)

Reduzir 1 página da estimativa para PDFs com mais de 10 páginas (assumindo página final de resumo):

```typescript
// Linha 261
const adjustedEstimate = pageCount > 10 ? pageCount - 1 : pageCount;
{ ...f, pageCount, estimatedEmployees: adjustedEstimate }
```

### 2. Melhorar indicação visual (`src/components/FileDropzone.tsx`)

Mudar de `~691 funcionário(s)` para `~690 funcionário(s) (estimado)` para deixar claro que é aproximado:

```tsx
{file.pageCount} páginas • ~{file.estimatedEmployees} funcionário(s) (estimado)
```

### 3. Atualizar estimativa após processamento

Após o OCR real, atualizar `estimatedEmployees` com o número **real** de nomes encontrados (já existe parcialmente na linha 656 com `extractedName: foundCount > 0 ? ...`).

---

## Arquivos a Modificar

| Arquivo | Alteração |
|---------|-----------|
| `src/hooks/useDocumentProcessor.ts` | Ajustar cálculo de `estimatedEmployees` (linha 261) |
| `src/components/FileDropzone.tsx` | Melhorar texto da estimativa (linha 153) |

---

## Resultado Esperado

- **Antes:** 691 páginas → ~691 funcionário(s)
- **Depois:** 691 páginas → ~690 funcionário(s) (estimado)

E após o processamento OCR, a contagem real aparece como `"690 funcionário(s)"` ou `"X funcionário(s)"` baseado nos nomes realmente extraídos.

