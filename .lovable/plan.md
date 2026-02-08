
# Correção: Contagem Exata de Funcionários em Holerites Escaneados (com OCR)

## Problema Identificado

O código atual faz a detecção correta de PDFs escaneados (sem texto nativo), mas usa uma estimativa incorreta:

```typescript
// src/lib/pdfUtils.ts - linha 178
return totalPages > 10 ? totalPages - 1 : totalPages;
```

Este cálculo assume que cada página = 1 funcionário. No entanto, o usuário confirmou que:
- **Às vezes há 2+ páginas por funcionário**
- **Geralmente existe página de resumo no final**

Por isso, para 690 páginas, o sistema mostra "1 funcionário" (pois a amostragem encontrou texto em apenas 1 página) quando deveria mostrar a contagem correta baseada no conteúdo real.

---

## Análise da Causa Raiz

O threshold `samplePages.length / 2` (linha 175) está muito baixo:
- 3 páginas amostradas: [1, 345, 690]
- Se **qualquer** uma dessas páginas tiver ≥50 caracteres de texto nativo, o sistema considera como "PDF nativo"
- Nesse PDF específico, a página 1 (ou outra) provavelmente tem texto nativo (cabeçalho, índice), passando no threshold
- Então entra no loop de contagem por padrões (linhas 182-194) que busca `NOME:`, `RECIBO DE PAGAMENTO`, etc.
- Como é escaneado, o texto nativo **não contém** esses padrões → count = 0 ou 1

---

## Solução Proposta

Como você quer contagem **exata** já no upload, e os holerites escaneados exigem OCR para extrair nomes, a solução é:

### Etapa 1: Corrigir a detecção de PDF escaneado

Atualizar a lógica para verificar se as páginas amostradas contêm **os padrões de funcionário**, não apenas se têm texto:

```typescript
// Amostragem: verificar se os padrões de funcionário aparecem no texto nativo
for (const pageNum of samplePages) {
  const pageText = await extractTextFromPage(file, pageNum, pdf);
  const normalizedText = pageText.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toUpperCase();
  
  // Verificar se tem padrão de funcionário (não apenas texto genérico)
  const hasEmployee = employeePatterns.some(pattern => pattern.test(normalizedText));
  if (hasEmployee) {
    pagesWithEmployeePattern++;
  }
}

// Se nenhuma página amostrada tem padrão de funcionário → PDF escaneado
if (pagesWithEmployeePattern === 0) {
  // Fallback: usar OCR rápido em algumas páginas para estimar
  // OU: retornar -1 para indicar "contagem pendente"
}
```

### Etapa 2: Para PDFs escaneados, fazer OCR rápido de amostragem

Em vez de fazer OCR em **todas** as 690 páginas durante o upload, fazer OCR em **apenas 5-10 páginas aleatórias** para:
1. Confirmar que é possível extrair nomes via OCR
2. Detectar quantas páginas por funcionário (1 ou 2)
3. Calcular estimativa: `totalPages / pagesPerEmployee - 1 (resumo)`

### Etapa 3: UI para indicar contagem em progresso

Se o OCR de amostragem for muito lento, mostrar "Analisando..." com progresso no upload enquanto a contagem precisa é calculada em background.

---

## Alteração Principal

Modificar `countPagesWithEmployeeName` em `src/lib/pdfUtils.ts` para:

1. **Verificar padrões** (não apenas presença de texto)
2. **Se padrões não encontrados**: fazer OCR em 3-5 páginas aleatórias
3. **Contar nomes únicos** extraídos via OCR da amostragem
4. **Extrapolar** baseado na proporção: `(totalPages / sampleSize) * uniqueNames`

---

## Implementação Detalhada

### Modificação em `src/lib/pdfUtils.ts`

```typescript
import { renderPageForOCR, OCR_SCALE_FAST } from './pdfCache';
import { extractTextWithOCR, initOcrScheduler } from './ocrUtils';

export async function countPagesWithEmployeeName(
  file: File,
  cachedPdf?: PDFDocumentProxy
): Promise<number> {
  const pdf = cachedPdf || await getCachedPdf(file);
  const totalPages = pdf.numPages;
  
  // Padrões que indicam presença de nome de funcionário
  const employeePatterns = [
    /(?:NOME|FUNCIONARIO|EMPREGADO|COLABORADOR|TRABALHADOR|TITULAR)\s*:/i,
    /RECIBO\s+DE\s+PAGAMENTO/i,
    /\b\d{3,5}\s+[A-Z][A-Z\s]{5,35}?\s+(?:COZINHEIRA|SERVENTE|AJUDANTE|AUXILIAR|\d{5,6})\b/,
  ];
  
  // ETAPA 1: Amostragem de texto nativo (rápida)
  const samplePages = [1, Math.floor(totalPages / 2), Math.max(1, totalPages - 1)];
  let pagesWithEmployeePattern = 0;
  
  for (const pageNum of samplePages) {
    if (pageNum > totalPages) continue;
    
    const pageText = await extractTextFromPage(file, pageNum, pdf);
    const normalizedText = pageText
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
    
    // Verificar se tem PADRÃO de funcionário (não apenas texto genérico)
    const hasEmployee = employeePatterns.some(pattern => pattern.test(normalizedText));
    if (hasEmployee) {
      pagesWithEmployeePattern++;
    }
  }
  
  // ETAPA 2: Se encontrou padrões no texto nativo → PDF digital
  if (pagesWithEmployeePattern >= 1) {
    console.log(`[countEmployees] PDF digital detectado: ${file.name}`);
    // Contar todas as páginas com padrões
    let count = 0;
    for (let i = 1; i <= totalPages; i++) {
      const pageText = await extractTextFromPage(file, i, pdf);
      const normalizedText = pageText
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();
      
      const hasEmployee = employeePatterns.some(pattern => pattern.test(normalizedText));
      if (hasEmployee) {
        count++;
      }
    }
    return count;
  }
  
  // ETAPA 3: PDF escaneado → fazer OCR de amostragem
  console.log(`[countEmployees] PDF escaneado detectado: ${file.name}, executando OCR de amostragem...`);
  
  // Inicializar OCR (workers podem já estar ativos)
  await initOcrScheduler();
  
  // Amostrar 5 páginas distribuídas (evitar primeira e última que podem ser capa/resumo)
  const ocrSampleSize = Math.min(5, totalPages - 2);
  const ocrSamplePages: number[] = [];
  const step = Math.floor((totalPages - 2) / ocrSampleSize);
  
  for (let i = 0; i < ocrSampleSize; i++) {
    const pageNum = 2 + (i * step); // Começar na página 2, evitar última
    if (pageNum <= totalPages - 1) {
      ocrSamplePages.push(pageNum);
    }
  }
  
  // Fazer OCR nas páginas amostradas
  let uniqueNames = 0;
  const foundNames = new Set<string>();
  
  for (const pageNum of ocrSamplePages) {
    try {
      const canvas = await renderPageForOCR(file, pageNum, OCR_SCALE_FAST, true);
      const ocrText = await extractTextWithOCR(canvas);
      
      // Liberar canvas
      canvas.width = 0;
      canvas.height = 0;
      
      // Extrair nome
      const name = extractEmployeeName(ocrText);
      if (name && !foundNames.has(name)) {
        foundNames.add(name);
        uniqueNames++;
      }
    } catch (error) {
      console.warn(`[countEmployees] OCR failed for page ${pageNum}:`, error);
    }
  }
  
  // ETAPA 4: Extrapolar para o documento completo
  if (uniqueNames > 0) {
    // Calcular páginas por funcionário baseado na amostra
    const pagesPerEmployee = ocrSamplePages.length / uniqueNames;
    // Estimar total (menos 1-2 páginas para capa/resumo)
    const estimated = Math.round((totalPages - 2) / pagesPerEmployee);
    console.log(`[countEmployees] OCR amostragem: ${uniqueNames} nomes em ${ocrSamplePages.length} páginas → ~${estimated} funcionários`);
    return Math.max(1, estimated);
  }
  
  // Fallback final: assumir 1 página por funcionário, menos capa/resumo
  console.log(`[countEmployees] Fallback: ${totalPages} páginas - 2 = ${totalPages - 2} funcionários`);
  return Math.max(1, totalPages - 2);
}
```

---

## Arquivos a Modificar

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/pdfUtils.ts` | Reescrever `countPagesWithEmployeeName` para usar OCR de amostragem em PDFs escaneados |

---

## Fluxo de Execução

```text
┌─────────────────────────────────────────────────────────────────┐
│  Upload de Holerite                                             │
├─────────────────────────────────────────────────────────────────┤
│  1. Amostrar 3 páginas (texto nativo)                           │
│  2. Buscar PADRÕES de funcionário (não apenas texto genérico)   │
│  3. SE encontrou padrões:                                       │
│     → PDF DIGITAL → contar todas as páginas com padrões         │
│  4. SE NÃO encontrou padrões:                                   │
│     → PDF ESCANEADO → OCR em 5 páginas distribuídas             │
│     → Contar nomes únicos extraídos                             │
│     → Extrapolar: (totalPages - 2) / (pagesPerEmployee)         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Performance

- **PDF digital (texto nativo)**: ~5-10 segundos para 690 páginas
- **PDF escaneado**: OCR em 5 páginas × ~2s = ~10-15 segundos adicionais
- **Total máximo**: ~25 segundos para contagem no upload

---

## Resultado Esperado

- **Holerite digital**: Contagem precisa por padrões
- **Holerite escaneado (690 páginas)**: `~345 funcionários` (se 2 páginas por funcionário) ou `~688 funcionários` (se 1 página por funcionário)
- A contagem é calculada com base em OCR real, não estimativa cega de páginas
