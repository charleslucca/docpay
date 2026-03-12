

# Diagnóstico: Matching falha em computadores diferentes

## Problema Identificado

O algoritmo de matching em `findNameInPreparedPage` (pdfUtils.ts, linha 843-856) depende **exclusivamente** da extração de FAVORECIDO via regex. Se nenhum nome FAVORECIDO for extraído de uma página do comprovante, o sistema retorna `false` imediatamente — sem fallback.

```typescript
// Código atual — linha 854-855
// No favorecido names extracted = no match possible
return false;
```

Isso significa que se o OCR produzir texto ligeiramente diferente em outro computador (qualidade de renderização, versão do navegador, memória disponível), a regex de FAVORECIDO pode falhar, e **zero matches** serão encontrados.

### Evidência nos dados
- Processamentos recentes: `pdf_count=1`, `unprocessed_data=null` — indica que apenas 1 funcionário foi extraído/matched
- Duração de 11-12 segundos — processamento muito rápido, sugere poucos dados ou OCR mínimo

## Causa Raiz

1. **`findNameInPreparedPage` sem fallback**: Quando `page.favorecidoNames` está vazio, retorna `false` sem tentar substring match ou word overlap
2. **OCR inconsistente entre máquinas**: Tesseract.js (WASM) pode produzir texto com qualidade diferente dependendo do navegador, GPU, memória e sistema operacional
3. **Regex de FAVORECIDO frágil**: O lookahead exige anchors específicos (CPF, CNPJ, DATA, etc.) — se o OCR não produzir esses anchors, a regex falha

## Alterações Propostas

### 1. `src/lib/pdfUtils.ts` — `findNameInPreparedPage`
Restaurar fallback de matching quando FAVORECIDO não é extraído:
- Se `favorecidoNames` está vazio, tentar **substring match** do nome normalizado no texto da página
- Se substring match falhar, tentar **word overlap** (≥70% das palavras do nome presentes na página)
- Manter log detalhado do método de match utilizado

### 2. `src/lib/pdfUtils.ts` — `extractFavorecidoNames`
Tornar a regex mais resiliente a variações de OCR:
- Adicionar mais anchors ao lookahead: "COMP", "RECIBO", "TRANSF", "R$", "BRL"
- Adicionar fallback para OCR ruidoso: buscar padrão `FAVORECIDO` seguido de texto em maiúsculas sem exigir anchor de término específico (limitar a 80 chars e parar em números/lowercase)

### 3. `src/hooks/useDocumentProcessor.ts` — Diagnóstico
Adicionar log resumido no final do matching mostrando:
- Quantas páginas de comprovante tiveram FAVORECIDO extraído vs. não
- Método de match utilizado para cada correspondência (FAVORECIDO vs. substring vs. word-overlap)
- Informação do User-Agent para identificar diferenças entre máquinas

### 4. `src/lib/pdfUtils.ts` — `extractFavorecidoNames` fallback adicional
Quando o fallback word-by-word falha, tentar extrair qualquer sequência de 2+ palavras em maiúsculas (3+ chars cada) que apareça após qualquer das labels FAVORECIDO/BENEFICIARIO, ignorando anchors de término — apenas limitando por tamanho máximo.

## Resumo do Impacto
- Restaura fallback de matching que existia antes e foi removido (linha 854-856)
- Matching não depende mais 100% da extração de FAVORECIDO
- Funciona de forma consistente independente da qualidade do OCR

