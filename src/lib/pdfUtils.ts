import { PDFDocument, rgb } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { getCachedPdf, getCachedBuffer } from './pdfCache';

export async function extractTextFromPdf(
  file: File,
  cachedPdf?: PDFDocumentProxy
): Promise<{ text: string; pageTexts: string[] }> {
  const pdf = cachedPdf || await getCachedPdf(file);
  
  const pageTexts: string[] = [];
  let fullText = '';
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    pageTexts.push(pageText);
    fullText += pageText + '\n';
  }
  
  return { text: fullText, pageTexts };
}

// Optimized: Extract text from a single page only
export async function extractTextFromPage(
  file: File,
  pageNumber: number,
  cachedPdf?: PDFDocumentProxy
): Promise<string> {
  const pdf = cachedPdf || await getCachedPdf(file);
  const page = await pdf.getPage(pageNumber);
  const textContent = await page.getTextContent();
  return textContent.items.map((item: any) => item.str).join(' ');
}

// Optimized: Search for name page by page with early termination
export async function findNameInPdfWithEarlyExit(
  file: File,
  targetName: string,
  cachedPdf?: PDFDocumentProxy
): Promise<{ found: boolean; pageNumber: number }> {
  const pdf = cachedPdf || await getCachedPdf(file);
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const pageText = await extractTextFromPage(file, i, pdf);
    if (findNameInPage(pageText, targetName)) {
      return { found: true, pageNumber: i };
    }
  }
  
  return { found: false, pageNumber: -1 };
}

export async function renderPdfPageToImage(
  file: File,
  pageNumber: number,
  scale: number = 1.5,
  cachedPdf?: PDFDocumentProxy
): Promise<string> {
  const pdf = cachedPdf || await getCachedPdf(file);
  const page = await pdf.getPage(pageNumber);
  
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  
  canvas.height = viewport.height;
  canvas.width = viewport.width;
  
  await page.render({
    canvasContext: context,
    viewport: viewport,
  }).promise;
  
  return canvas.toDataURL('image/jpeg', 0.8);
}

export async function getPdfPageCount(
  file: File,
  cachedPdf?: PDFDocumentProxy
): Promise<number> {
  const pdf = cachedPdf || await getCachedPdf(file);
  return pdf.numPages;
}

export function extractEmployeeName(text: string): string | null {
  // Normalizar texto: remover acentos e converter para maiúscula
  const normalizedText = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' '); // Normalizar espaços múltiplos

  console.log('[DEBUG] Texto normalizado (primeiros 300 chars):', normalizedText.substring(0, 300));

  // Padrões ordenados do mais específico ao mais genérico
  const namePatterns = [
    // 1. Nome entre matrícula e código (formato B SERVICE)
    /\b\d{3,6}\s+([A-Z][A-Z\s]{8,45}?)\s+\d{4,}/,
    
    // 2. Nome seguido de cargo brasileiro
    /([A-Z][A-Z\s]{8,45}?)\s+(?:SUPERVISOR|ANALISTA|AUXILIAR|GERENTE|COORDENADOR|ASSISTENTE|OPERADOR|TECNICO|ADMINISTRATIVO)/,
    
    // 3. Labels explícitos brasileiros
    /(?:NOME|FUNCIONARIO|EMPREGADO|COLABORADOR|TRABALHADOR|TITULAR|SEGURADO|BENEFICIARIO)\s*:?\s*([A-Z][A-Z\s]{4,50}?)(?=\s*(?:CPF|CARGO|FUNCAO|ADMISSAO|CNPJ|MATRICULA|\d{3}\.\d{3}|$))/,
    
    // 4. Recibo de pagamento padrão
    /RECIBO\s+DE\s+PAGAMENTO[^A-Z]*([A-Z][A-Z\s]{5,40}?)(?=\s*(?:CPF|CARGO))/,
    
    // 5. Nome imediatamente antes de CPF
    /([A-Z][A-Z\s]{5,40}?)\s*\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}/,
    
    // 6. Linha com nome completo isolado
    /^([A-Z][A-Z\s]{8,40})$/m,
  ];

  for (const pattern of namePatterns) {
    const match = normalizedText.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim().replace(/\s+/g, ' ');
      const words = name.split(' ').filter(w => w.length > 1);
      
      // Validar: pelo menos 2 palavras, tamanho razoável
      if (words.length >= 2 && name.length >= 5 && name.length <= 60) {
        // Remover palavras que claramente não são nomes
        const invalidWords = [
          'CNPJ', 'CPF', 'CARGO', 'FUNCAO', 'ADMISSAO', 'SALARIO', 
          'EMPRESA', 'LTDA', 'EIRELI', 'SA', 'PRESTADORA', 'SERVICOS',
          'FOLHA', 'MENSAL', 'RECIBO', 'PAGAMENTO'
        ];
        const hasInvalidWord = words.some(w => invalidWords.includes(w));
        if (!hasInvalidWord) {
          console.log('[DEBUG] Nome extraído:', name);
          return name;
        }
      }
    }
  }

  console.log('[DEBUG] Nenhum nome encontrado');
  return null;
}

// Extract CPF for faster matching
export function extractCPF(text: string): string | null {
  const cpfPattern = /\b(\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2})\b/;
  const match = text.match(cpfPattern);
  if (match) {
    // Normalize CPF to digits only
    return match[1].replace(/\D/g, '');
  }
  return null;
}

export function findNameInPage(pageText: string, targetName: string): boolean {
  const normalizedTarget = targetName.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const normalizedPage = pageText.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  
  if (normalizedPage.includes(normalizedTarget)) {
    return true;
  }
  
  // Partial match (first and last name)
  const nameParts = normalizedTarget.split(/\s+/);
  if (nameParts.length >= 2) {
    const firstName = nameParts[0];
    const lastName = nameParts[nameParts.length - 1];
    if (normalizedPage.includes(firstName) && normalizedPage.includes(lastName)) {
      return true;
    }
  }
  
  return false;
}

export async function createCombinedPdf(
  holeriteFile: File,
  comprovanteFile: File,
  comprovantePageNumber: number,
  employeeName: string
): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();
  
  // A4 landscape dimensions
  const pageWidth = 841.89;
  const pageHeight = 595.28;
  
  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  
  // Use cached buffers
  const holeriteBytes = await getCachedBuffer(holeriteFile);
  const comprovanteBytes = await getCachedBuffer(comprovanteFile);
  
  const holeritePdf = await PDFDocument.load(holeriteBytes.slice(0));
  const comprovantePdf = await PDFDocument.load(comprovanteBytes.slice(0));
  
  const [holeritePage] = await pdfDoc.embedPdf(holeritePdf, [0]);
  const [comprovantePage] = await pdfDoc.embedPdf(comprovantePdf, [comprovantePageNumber - 1]);
  
  const margin = 20;
  const headerHeight = 40;
  const availableWidth = (pageWidth - margin * 3) / 2;
  const availableHeight = pageHeight - margin * 2 - headerHeight;
  
  const holeriteScale = Math.min(
    availableWidth / holeritePage.width,
    availableHeight / holeritePage.height
  );
  const comprovanteScale = Math.min(
    availableWidth / comprovantePage.width,
    availableHeight / comprovantePage.height
  );
  
  const holeriteWidth = holeritePage.width * holeriteScale;
  const holeriteHeight = holeritePage.height * holeriteScale;
  const comprovanteWidth = comprovantePage.width * comprovanteScale;
  const comprovanteHeight = comprovantePage.height * comprovanteScale;
  
  page.drawText(`Funcionário: ${employeeName}`, {
    x: margin,
    y: pageHeight - margin - 15,
    size: 14,
    color: rgb(0.086, 0.502, 0.224),
  });
  
  const date = new Date().toLocaleDateString('pt-BR');
  page.drawText(`Gerado em: ${date}`, {
    x: pageWidth - margin - 120,
    y: pageHeight - margin - 15,
    size: 10,
    color: rgb(0.4, 0.4, 0.4),
  });
  
  page.drawLine({
    start: { x: margin, y: pageHeight - headerHeight },
    end: { x: pageWidth - margin, y: pageHeight - headerHeight },
    thickness: 1,
    color: rgb(0.8, 0.8, 0.8),
  });
  
  page.drawText('HOLERITE', {
    x: margin + availableWidth / 2 - 30,
    y: pageHeight - headerHeight - 15,
    size: 10,
    color: rgb(0.3, 0.3, 0.3),
  });
  
  page.drawText('COMPROVANTE', {
    x: margin * 2 + availableWidth + availableWidth / 2 - 45,
    y: pageHeight - headerHeight - 15,
    size: 10,
    color: rgb(0.3, 0.3, 0.3),
  });
  
  const holeriteY = pageHeight - headerHeight - 25 - holeriteHeight;
  page.drawPage(holeritePage, {
    x: margin + (availableWidth - holeriteWidth) / 2,
    y: holeriteY,
    width: holeriteWidth,
    height: holeriteHeight,
  });
  
  const comprovanteY = pageHeight - headerHeight - 25 - comprovanteHeight;
  page.drawPage(comprovantePage, {
    x: margin * 2 + availableWidth + (availableWidth - comprovanteWidth) / 2,
    y: comprovanteY,
    width: comprovanteWidth,
    height: comprovanteHeight,
  });
  
  page.drawRectangle({
    x: margin,
    y: holeriteY - 5,
    width: availableWidth,
    height: holeriteHeight + 10,
    borderColor: rgb(0.8, 0.8, 0.8),
    borderWidth: 1,
  });
  
  page.drawRectangle({
    x: margin * 2 + availableWidth,
    y: comprovanteY - 5,
    width: availableWidth,
    height: comprovanteHeight + 10,
    borderColor: rgb(0.8, 0.8, 0.8),
    borderWidth: 1,
  });
  
  const pdfBytes = await pdfDoc.save();
  return new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
}
