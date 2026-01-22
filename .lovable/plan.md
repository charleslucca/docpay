
# Plano: Mostrar Apenas 1 Holerite e Organizar Downloads por Ano/Mês

## Problemas Identificados

### Problema 1: Dois Holerites Empilhados
O PDF de holerite da B SERVICE tem um layout de **2 vias por página** (cópia superior e cópia inferior idênticas). Quando o sistema embeda a página inteira, mostra as duas vias.

**Solução**: Recortar automaticamente a **metade superior** da página do holerite para mostrar apenas 1 via.

### Problema 2: Organização dos Downloads
O usuário quer que os downloads sejam organizados em pastas por ano e mês em português (ex: `2026/Janeiro/nome_funcionario.pdf`).

---

## Mudanças a Implementar

### Mudança 1: Recortar Holerite para Metade Superior

**Arquivo:** `src/lib/pdfUtils.ts`

Modificar a função `createCombinedPdf` para:
1. Embeder apenas a **metade superior** da página do holerite
2. Usar `MediaBox` ou crop para cortar a página ao meio
3. Manter o comprovante inteiro (já está correto)

**Técnica com pdf-lib:**
```text
// Após embedar a página do holerite
const holeriteOriginalHeight = holeritePage.height;

// Desenhar apenas a metade superior (ajustar viewport)
page.drawPage(holeritePage, {
  x: margin + (availableWidth - holeriteWidth) / 2,
  y: holeriteY,
  width: holeriteWidth,
  height: holeriteHeight,
  // Recortar para mostrar apenas metade superior
  xOffset: 0,
  yOffset: holeriteOriginalHeight / 2, // Começar do meio
});
```

Alternativamente, renderizar apenas a metade superior criando um clip:

```text
// Criar nova página apenas com a metade superior
const croppedHoleritePdf = await PDFDocument.create();
const [copiedPage] = await croppedHoleritePdf.copyPages(holeritePdf, [pageIndex]);

// Ajustar MediaBox para metade superior
const mediaBox = copiedPage.getMediaBox();
copiedPage.setMediaBox(
  mediaBox.x,
  mediaBox.y + mediaBox.height / 2,  // Começar do meio
  mediaBox.width,
  mediaBox.height / 2  // Altura da metade
);

croppedHoleritePdf.addPage(copiedPage);
```

### Mudança 2: Atualizar Preview do Card

**Arquivo:** `src/hooks/useDocumentProcessor.ts`

Modificar `renderPdfPageToImage` para também recortar a metade superior quando for preview de holerite:
- Adicionar parâmetro opcional `cropToHalf: boolean`
- Quando true, renderizar apenas metade superior do canvas

### Mudança 3: Organizar Downloads por Ano/Mês

**Arquivo:** `src/types/document.ts`

O `GeneratedDocument` já tem `year` e `month`. Adicionar path calculado:
```text
folderPath: string; // Ex: "2026/Janeiro"
```

**Arquivo:** `src/components/DocumentRepository.tsx`

Modificar `handleDownload` para incluir o caminho da pasta no nome do arquivo:
```text
// Ao invés de: nome_funcionario.pdf
// Usar: 2026_Janeiro_nome_funcionario.pdf
// Ou sugerir download com estrutura de pastas
```

**Arquivo:** `src/hooks/useDocumentProcessor.ts`

Na função `generatePdfs`, calcular o nome do mês em português:
```text
const monthNames = ['Janeiro', 'Fevereiro', 'Março', ...];
const monthName = monthNames[month - 1];
const fileName = `${year}_${monthName}_${employeeName}.pdf`;
// Ou: folderPath = `${year}/${monthName}/`
```

---

## Detalhes Técnicos

### Recorte de Página com pdf-lib

A biblioteca `pdf-lib` permite recortar páginas de duas formas:

**Opção A: Ajustar MediaBox antes de embedar**
```typescript
// Copiar página e ajustar bounds
const holeritePdfDoc = await PDFDocument.load(holeriteBytes);
const [page] = await holeritePdfDoc.getPages();
const { height, width } = page.getSize();

// Criar novo PDF com página recortada
const croppedDoc = await PDFDocument.create();
const [copiedPage] = await croppedDoc.copyPages(holeritePdfDoc, [holeritePageNumber - 1]);

// Recortar para metade superior
copiedPage.setCropBox(0, height / 2, width, height / 2);
croppedDoc.addPage(copiedPage);

// Agora embedar o documento recortado
const [croppedHoleritePage] = await pdfDoc.embedPdf(croppedDoc);
```

**Opção B: Usar clipPath no desenho** (mais complexo)

Usaremos a **Opção A** por ser mais simples e confiável.

### Função Atualizada: `createCombinedPdf`

```typescript
export async function createCombinedPdf(
  holeriteFile: File,
  comprovanteFile: File,
  comprovantePageNumber: number,
  employeeName: string,
  holeritePageNumber: number = 1,
  cropHoleriteToHalf: boolean = true  // NOVO parâmetro
): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();
  
  // A4 landscape dimensions
  const pageWidth = 841.89;
  const pageHeight = 595.28;
  
  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  
  const holeriteBytes = await getCachedBuffer(holeriteFile);
  const comprovanteBytes = await getCachedBuffer(comprovanteFile);
  
  let holeritePdf = await PDFDocument.load(holeriteBytes.slice(0));
  
  // NOVO: Recortar holerite para metade superior se necessário
  if (cropHoleriteToHalf) {
    const originalPage = holeritePdf.getPage(holeritePageNumber - 1);
    const { width, height } = originalPage.getSize();
    
    const croppedPdf = await PDFDocument.create();
    const [copiedPage] = await croppedPdf.copyPages(holeritePdf, [holeritePageNumber - 1]);
    
    // Recortar para metade superior (a via do funcionário)
    copiedPage.setCropBox(0, height / 2, width, height / 2);
    croppedPdf.addPage(copiedPage);
    
    // Usar o PDF recortado
    holeritePdf = croppedPdf;
  }
  
  const [holeritePage] = await pdfDoc.embedPdf(holeritePdf, [0]);
  // ... resto do código
}
```

### Nomes de Arquivos com Ano/Mês

O arquivo gerado terá o nome no formato:
```
2025_Setembro_ANA_BEATRIZ_DIAS_PIRES.pdf
```

E no repositório, será agrupado visualmente por:
```
📁 Setembro de 2025 (4 arquivos)
   └── ANA BEATRIZ DIAS PIRES
   └── CARLOS HENRIQUE DA SILVA MARIANO
   └── MARIA JOSÉ DOS SANTOS
   └── JOÃO PEDRO OLIVEIRA
```

---

## Arquivos a Modificar

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/pdfUtils.ts` | Recortar holerite para metade superior na `createCombinedPdf` |
| `src/lib/pdfUtils.ts` | Adicionar função `renderPdfPageToImage` com crop opcional |
| `src/hooks/useDocumentProcessor.ts` | Passar crop=true para previews de holerite |
| `src/hooks/useDocumentProcessor.ts` | Gerar fileName com ano e mês em português |
| `src/types/document.ts` | Adicionar `monthName` ao GeneratedDocument (opcional) |

---

## Resultado Visual Esperado

### PDF Gerado (Após Correção)
```text
┌─────────────────────────────────────────────────────────────────┐
│  Funcionário: ANA BEATRIZ DIAS PIRES      Gerado em: 22/01/2026 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────┐           ┌─────────────────┐             │
│   │   HOLERITE      │    →      │   COMPROVANTE   │             │
│   │   (1 via só)    │           │   SICREDI       │             │
│   │                 │           │                 │             │
│   │   ANA BEATRIZ   │           │   ANA BEATRIZ   │             │
│   │   R$ 1.746,29   │           │   R$ 1.746,29   │             │
│   │                 │           │                 │             │
│   └─────────────────┘           └─────────────────┘             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Estrutura de Downloads
```text
Downloads/
├── 2025_Setembro_ANA_BEATRIZ_DIAS_PIRES.pdf
├── 2025_Setembro_CARLOS_HENRIQUE.pdf
└── 2025_Outubro_MARIA_JOSE.pdf
```

---

## Considerações

1. **Crop 50%**: Assumindo que o layout padrão da B SERVICE é sempre 2 vias por página. Se houver variações, podemos adicionar detecção automática ou opção manual.

2. **Compatibilidade**: O recorte via `setCropBox` é suportado pela pdf-lib e mantém a qualidade original do PDF.

3. **Performance**: O recorte é feito em memória, sem re-renderização - mantém a velocidade atual.
