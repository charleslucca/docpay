

# Correção: 1 Página = 1 Funcionário (com 2 Holerites por Página)

## Problema Identificado

Analisando a imagem, cada **página** contém **2 holerites do MESMO funcionário** (um na parte superior, um na inferior). Isso significa:

- **1 página = 1 funcionário** (não 2)
- O layout mostra 2 cópias do mesmo holerite por página (via/empresa e via/funcionário)
- Para 691 páginas (com 1 de resumo): **690 funcionários**

O código atual tenta calcular `pagesPerEmployee` usando amostragem distribuída, o que gera resultados incorretos (552 em vez de 690).

---

## Solução

Simplificar a lógica: para PDFs escaneados, **cada página = 1 funcionário** (menos página de resumo). A amostragem OCR serve apenas para **confirmar** que o PDF contém holerites válidos (extrai pelo menos 1 nome), não para calcular proporção.

---

## Mudanças no Código

### Arquivo: `src/lib/pdfUtils.ts`

**Antes (linhas 255-264):**
```typescript
if (uniqueNames > 0) {
  // Calcular páginas por funcionário baseado na amostra
  const pagesPerEmployee = ocrSamplePages.length / uniqueNames;
  // Estimar total (menos 1-2 páginas para capa/resumo)
  const pagesToCount = totalPages - 1;
  const estimated = Math.round(pagesToCount / pagesPerEmployee);
  console.log(`...`);
  return Math.max(1, estimated);
}
```

**Depois:**
```typescript
if (uniqueNames > 0) {
  // PDF escaneado válido confirmado - cada página = 1 funcionário
  // (Cada página contém 2 holerites do MESMO funcionário: via empresa + via funcionário)
  const estimated = totalPages - 1; // Descontar página de resumo
  console.log(`[countEmployees] OCR confirmou PDF válido: ${uniqueNames} nomes em ${ocrSamplePages.length} páginas amostradas`);
  console.log(`[countEmployees] Cada página = 1 funcionário → ${totalPages} - 1 (resumo) = ${estimated} funcionários`);
  return Math.max(1, estimated);
}
```

---

## Lógica Final

```text
┌─────────────────────────────────────────────────────────────────┐
│  Upload de Holerite (691 páginas)                               │
├─────────────────────────────────────────────────────────────────┤
│  1. Detectar PDF escaneado (sem padrões no texto nativo)        │
│  2. OCR em 5 páginas para CONFIRMAR que são holerites válidos   │
│     - Se extrair pelo menos 1 nome → PDF válido                 │
│  3. Contagem: totalPages - 1 (página de resumo)                 │
│     - 691 - 1 = 690 funcionários ✓                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Resultado Esperado

| Cenário | Antes | Depois |
|---------|-------|--------|
| 691 páginas escaneadas | 552 funcionários ❌ | 690 funcionários ✓ |
| 50 páginas escaneadas | ~40 funcionários ❌ | 49 funcionários ✓ |

A contagem agora reflete corretamente que **1 página = 1 funcionário** independente de ter 2 cópias do holerite na página.

