

# Correção: Texto Destacado/Comentado no PDF Impedindo Match

## Problema

Nomes de funcionários no comprovante bancário estão **destacados (realçados)** com cor de fundo ou possuem comentários/anotações no PDF. Quando um PDF é editado com destaque ou comentários, algumas ferramentas movem o texto para a camada de anotações (annotations) do PDF, fazendo com que `page.getTextContent()` do PDF.js **não extraia esse texto**. O resultado é que o nome do FAVORECIDO não aparece no texto extraído e o match falha.

## Causa Raiz

O sistema usa apenas `page.getTextContent()` para extrair texto. Essa API lê apenas a camada de conteúdo (content stream) da página. Texto que faz parte de **anotações** (highlights, comments, popups, free text annotations) não é retornado por essa API — é necessário chamar `page.getAnnotations()` separadamente.

## Correção

### 1. Extrair texto de anotações do PDF (`src/lib/pdfUtils.ts` e `src/lib/pdfCache.ts`)

Criar uma função auxiliar que, após extrair o texto normal via `getTextContent()`, também chama `page.getAnnotations()` e concatena qualquer texto encontrado nas anotações (campos `contents`, `title`, `fieldValue`, e conteúdo de anotações do tipo FreeText, Highlight, Popup, Widget).

Isso será aplicado em todos os pontos de extração de texto:
- `extractTextFromPdf()` em pdfUtils.ts
- `extractTextFromPage()` em pdfUtils.ts  
- `extractSinglePageText()` em pdfCache.ts

### 2. Lógica de extração de anotações

```
Para cada página:
  1. Extrair texto normal (getTextContent) — já existente
  2. Chamar page.getAnnotations()
  3. Para cada anotação, extrair:
     - annotation.contents (texto do comentário/popup)
     - annotation.fieldValue (campos de formulário)
     - annotation.alternativeText
  4. Concatenar texto das anotações ao texto da página
  5. Log: "[Annotations] Página X: Y anotações, Z chars extras"
```

### 3. Sem alteração na lógica de matching

A extração de FAVORECIDO e todo o pipeline de matching permanecem inalterados — apenas o texto de entrada será mais completo.

## Arquivos Alterados

- `src/lib/pdfUtils.ts` — funções `extractTextFromPdf` e `extractTextFromPage`
- `src/lib/pdfCache.ts` — função `extractSinglePageText`

## Resultado Esperado

Nomes destacados ou comentados no PDF serão incluídos no texto extraído, permitindo o match correto com os funcionários do holerite.

