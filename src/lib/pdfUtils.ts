import { PDFDocument, rgb } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';

// Lazy load pdfjs-dist to avoid top-level await issues
let pdfjsLib: typeof import('pdfjs-dist') | null = null;

async function getPdfJs() {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js`;
  }
  return pdfjsLib;
}

export async function extractTextFromPdf(file: File): Promise<{ text: string; pageTexts: string[] }> {
  const pdfjs = await getPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  
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

export async function renderPdfPageToImage(file: File, pageNumber: number, scale: number = 1.5): Promise<string> {
  const pdfjs = await getPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
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

export async function getPdfPageCount(file: File): Promise<number> {
  const pdfjs = await getPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  return pdf.numPages;
}

export function extractEmployeeName(text: string): string | null {
  // Common patterns for Brazilian payroll documents
  // Pattern 1: "Nome:" or "NOME:" followed by name
  const namePatterns = [
    /(?:Nome|NOME|Funcionário|FUNCIONÁRIO|Empregado|EMPREGADO)[:\s]+([A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ][A-Za-záàâãéèêíïóôõöúçñ\s]+)/i,
    /(?:RECIBO DE PAGAMENTO DE SALÁRIO)[^]*?([A-Z][A-Z\s]{5,40})(?:\s+(?:CPF|Cargo|Função|Admissão))/i,
    // Pattern for names in uppercase at beginning of lines
    /^([A-Z][A-Z\s]{8,40})$/m,
  ];
  
  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      // Validate it looks like a name (at least 2 words, reasonable length)
      const words = name.split(/\s+/).filter(w => w.length > 1);
      if (words.length >= 2 && name.length >= 5 && name.length <= 60) {
        return name.toUpperCase().trim();
      }
    }
  }
  
  return null;
}

export function findNameInPage(pageText: string, targetName: string): boolean {
  const normalizedTarget = targetName.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const normalizedPage = pageText.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  
  // Check for exact match or close match
  if (normalizedPage.includes(normalizedTarget)) {
    return true;
  }
  
  // Check for partial match (first and last name)
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
  // Create a new PDF in landscape A4
  const pdfDoc = await PDFDocument.create();
  
  // A4 landscape dimensions in points (72 points = 1 inch)
  const pageWidth = 841.89; // A4 height becomes width in landscape
  const pageHeight = 595.28; // A4 width becomes height in landscape
  
  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  
  // Load source PDFs
  const holeriteBytes = await holeriteFile.arrayBuffer();
  const comprovanteBytes = await comprovanteFile.arrayBuffer();
  
  const holeritePdf = await PDFDocument.load(holeriteBytes);
  const comprovantePdf = await PDFDocument.load(comprovanteBytes);
  
  // Embed the first page of holerite
  const [holeritePage] = await pdfDoc.embedPdf(holeritePdf, [0]);
  
  // Embed the specific page from comprovante
  const [comprovantePage] = await pdfDoc.embedPdf(comprovantePdf, [comprovantePageNumber - 1]);
  
  // Calculate dimensions for side-by-side layout
  const margin = 20;
  const headerHeight = 40;
  const availableWidth = (pageWidth - margin * 3) / 2;
  const availableHeight = pageHeight - margin * 2 - headerHeight;
  
  // Scale pages to fit
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
  
  // Draw header with employee name
  page.drawText(`Funcionário: ${employeeName}`, {
    x: margin,
    y: pageHeight - margin - 15,
    size: 14,
    color: rgb(0.086, 0.502, 0.224), // Primary green
  });
  
  // Draw date
  const date = new Date().toLocaleDateString('pt-BR');
  page.drawText(`Gerado em: ${date}`, {
    x: pageWidth - margin - 120,
    y: pageHeight - margin - 15,
    size: 10,
    color: rgb(0.4, 0.4, 0.4),
  });
  
  // Draw separator line
  page.drawLine({
    start: { x: margin, y: pageHeight - headerHeight },
    end: { x: pageWidth - margin, y: pageHeight - headerHeight },
    thickness: 1,
    color: rgb(0.8, 0.8, 0.8),
  });
  
  // Draw labels
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
  
  // Draw holerite on the left
  const holeriteY = pageHeight - headerHeight - 25 - holeriteHeight;
  page.drawPage(holeritePage, {
    x: margin + (availableWidth - holeriteWidth) / 2,
    y: holeriteY,
    width: holeriteWidth,
    height: holeriteHeight,
  });
  
  // Draw comprovante on the right
  const comprovanteY = pageHeight - headerHeight - 25 - comprovanteHeight;
  page.drawPage(comprovantePage, {
    x: margin * 2 + availableWidth + (availableWidth - comprovanteWidth) / 2,
    y: comprovanteY,
    width: comprovanteWidth,
    height: comprovanteHeight,
  });
  
  // Draw borders around documents
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
