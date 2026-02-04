import type { PDFDocumentProxy } from 'pdfjs-dist';

// Lazy load pdfjs-dist
let pdfjsLib: typeof import('pdfjs-dist') | null = null;

async function getPdfJs() {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist');
    // Use local worker for faster loading (downloaded to public folder)
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  }
  return pdfjsLib;
}

// Cache structures
const pdfDocumentCache = new Map<string, PDFDocumentProxy>();
const arrayBufferCache = new Map<string, ArrayBuffer>();
const pageTextCache = new Map<string, string[]>(); // NEW: Cache for extracted page texts

// LRU tracking
const accessOrder: string[] = [];
const MAX_CACHE_SIZE = 20;

function getFileKey(file: File): string {
  return `${file.name}_${file.size}_${file.lastModified}`;
}

function updateAccessOrder(key: string) {
  const index = accessOrder.indexOf(key);
  if (index > -1) {
    accessOrder.splice(index, 1);
  }
  accessOrder.push(key);
  
  // Evict oldest if over limit
  while (accessOrder.length > MAX_CACHE_SIZE) {
    const oldestKey = accessOrder.shift();
    if (oldestKey) {
      pdfDocumentCache.delete(oldestKey);
      arrayBufferCache.delete(oldestKey);
      pageTextCache.delete(oldestKey); // Also clear text cache
    }
  }
}

export async function getCachedBuffer(file: File): Promise<ArrayBuffer> {
  const key = getFileKey(file);
  
  let buffer = arrayBufferCache.get(key);
  if (!buffer) {
    buffer = await file.arrayBuffer();
    arrayBufferCache.set(key, buffer);
  }
  
  updateAccessOrder(key);
  return buffer;
}

export async function getCachedPdf(file: File): Promise<PDFDocumentProxy> {
  const key = getFileKey(file);
  
  let pdf = pdfDocumentCache.get(key);
  if (!pdf) {
    const pdfjs = await getPdfJs();
    const buffer = await getCachedBuffer(file);
    // Create a copy of the buffer since getDocument consumes it
    // Configure CMaps and standard fonts for better Brazilian PDF support
    pdf = await pdfjs.getDocument({
      data: buffer.slice(0),
      cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/standard_fonts/',
    }).promise;
    pdfDocumentCache.set(key, pdf);
  }
  
  updateAccessOrder(key);
  return pdf;
}

// Helper function to extract text from a single page with cleanup
// Sorts items by position (Y then X) to preserve reading order
async function extractSinglePageText(pdf: PDFDocumentProxy, pageNum: number): Promise<string> {
  const page = await pdf.getPage(pageNum);
  const textContent = await page.getTextContent();
  
  // Ordenar itens por posição Y (topo para baixo) e X (esquerda para direita)
  const sortedItems = textContent.items
    .filter((item: any) => item.str && item.str.trim())
    .sort((a: any, b: any) => {
      // Inverter Y porque PDF usa coordenadas de baixo para cima
      const yDiff = b.transform[5] - a.transform[5];
      if (Math.abs(yDiff) > 5) return yDiff; // Linhas diferentes
      return a.transform[4] - b.transform[4]; // Mesma linha, ordenar por X
    });
  
  const text = sortedItems.map((item: any) => item.str).join(' ');
  page.cleanup(); // Release memory immediately!
  return text;
}

const PAGE_BATCH_SIZE = 5; // Process 5 pages in parallel
const MIN_TEXT_LENGTH_FOR_OCR = 50; // If native text extraction yields less than this, use OCR

// Get all page texts from a PDF (cached) with cancellation support and parallel processing
export async function getCachedPageTexts(
  file: File,
  shouldCancel?: () => boolean
): Promise<string[]> {
  const key = getFileKey(file);
  
  // Check cache first - instant return if cached
  const cachedTexts = pageTextCache.get(key);
  if (cachedTexts) {
    updateAccessOrder(key);
    return cachedTexts;
  }
  
  const pdf = await getCachedPdf(file);
  const pageTexts: string[] = [];
  
  // Process pages in parallel batches for much faster extraction
  for (let start = 1; start <= pdf.numPages; start += PAGE_BATCH_SIZE) {
    // Check cancellation before each batch
    if (shouldCancel?.()) {
      break;
    }
    
    const end = Math.min(start + PAGE_BATCH_SIZE, pdf.numPages + 1);
    const pagePromises: Promise<string>[] = [];
    
    for (let i = start; i < end; i++) {
      pagePromises.push(extractSinglePageText(pdf, i));
    }
    
    const batchResults = await Promise.all(pagePromises);
    pageTexts.push(...batchResults);
  }
  
  // Only cache if not cancelled
  if (!shouldCancel?.()) {
    pageTextCache.set(key, pageTexts);
  }
  
  updateAccessOrder(key);
  return pageTexts;
}

// Extract text from only the first page (optimized for holerites)
export async function extractFirstPageText(file: File): Promise<string> {
  const pdf = await getCachedPdf(file);
  return extractSinglePageText(pdf, 1);
}

export function clearCache() {
  pdfDocumentCache.clear();
  arrayBufferCache.clear();
  pageTextCache.clear(); // Also clear text cache
  accessOrder.length = 0;
}

export function getCacheStats() {
  return {
    documents: pdfDocumentCache.size,
    buffers: arrayBufferCache.size,
    texts: pageTextCache.size,
    maxSize: MAX_CACHE_SIZE,
  };
}

// OPTIMIZED: Lower scale for faster OCR (1.5x instead of 2.5x = 3x less pixels)
export const OCR_SCALE_FAST = 1.5;  // For holerites (large text)
export const OCR_SCALE_HIGH = 2.0;  // For comprovantes (smaller text)

/**
 * Convert canvas to grayscale for faster OCR processing
 * Reduces data sent to WASM by ~3x (only luminance needed)
 */
function applyGrayscale(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  
  // Optimized grayscale conversion using luminance formula
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    data[i] = data[i + 1] = data[i + 2] = gray;
  }
  
  ctx.putImageData(imageData, 0, 0);
}

/**
 * Render a PDF page to canvas optimized for OCR
 * OPTIMIZED: Uses lower scale (1.5x) and grayscale conversion
 */
export async function renderPageForOCR(
  file: File,
  pageNumber: number = 1,
  scale: number = OCR_SCALE_FAST,
  grayscale: boolean = true
): Promise<HTMLCanvasElement> {
  const pdf = await getCachedPdf(file);
  const page = await pdf.getPage(pageNumber);
  
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  
  await page.render({
    canvasContext: context,
    viewport: viewport,
  }).promise;
  
  page.cleanup(); // Release memory immediately
  
  // OPTIMIZED: Convert to grayscale for faster OCR
  if (grayscale) {
    applyGrayscale(canvas);
  }
  
  console.log(`[PDF] Rendered page ${pageNumber} for OCR: ${canvas.width}x${canvas.height}px (scale=${scale}, grayscale=${grayscale})`);
  
  return canvas;
}

/**
 * Get page texts with OCR fallback for scanned PDFs
 * OPTIMIZED: Uses parallel pipeline similar to holerite processing
 * First attempts native text extraction, falls back to OCR if text is too short
 */
export async function getCachedPageTextsWithOCR(
  file: File,
  ocrExtractor: (canvas: HTMLCanvasElement) => Promise<string>,
  onProgress?: (pageNum: number, totalPages: number, isOcr: boolean) => void,
  shouldCancel?: () => boolean
): Promise<string[]> {
  const key = getFileKey(file) + '_ocr';
  
  // Check cache first
  const cachedTexts = pageTextCache.get(key);
  if (cachedTexts) {
    updateAccessOrder(key);
    return cachedTexts;
  }
  
  const pdf = await getCachedPdf(file);
  const totalPages = pdf.numPages;
  const pageTexts: (string | null)[] = new Array(totalPages).fill(null);
  
  console.log(`[Comprovante] Processing ${file.name}: ${totalPages} page(s) with PARALLEL pipeline`);
  
  // STEP 1: Try native text extraction for ALL pages in parallel (very fast)
  const nativeTextPromises: Promise<{ pageNum: number; text: string }>[] = [];
  
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    if (shouldCancel?.()) break;
    nativeTextPromises.push(
      extractSinglePageText(pdf, pageNum).then(text => ({ pageNum, text }))
    );
  }
  
  const nativeResults = await Promise.all(nativeTextPromises);
  
  // Identify pages that need OCR
  const pagesNeedingOcr: number[] = [];
  
  for (const { pageNum, text } of nativeResults) {
    if (text.trim().length >= MIN_TEXT_LENGTH_FOR_OCR) {
      pageTexts[pageNum - 1] = text;
    } else {
      pagesNeedingOcr.push(pageNum);
    }
  }
  
  const nativeCount = totalPages - pagesNeedingOcr.length;
  console.log(`[Comprovante] Native extraction: ${nativeCount}/${totalPages} pages OK, ${pagesNeedingOcr.length} need OCR`);
  
  // STEP 2: Process OCR pages in parallel batches (if any)
  if (pagesNeedingOcr.length > 0) {
    onProgress?.(nativeCount, totalPages, true);
    
    // Process OCR in batches to avoid memory issues
    const OCR_BATCH_SIZE = 4; // Process 4 pages at a time
    let ocrCompleted = 0;
    
    for (let i = 0; i < pagesNeedingOcr.length; i += OCR_BATCH_SIZE) {
      if (shouldCancel?.()) break;
      
      const batch = pagesNeedingOcr.slice(i, i + OCR_BATCH_SIZE);
      
      // Render and OCR batch in parallel, update progress per page (not per batch)
      const batchPromises = batch.map(async (pageNum) => {
        const canvas = await renderPageForOCR(file, pageNum, OCR_SCALE_HIGH, true);
        const text = await ocrExtractor(canvas);
        
        // Update progress immediately after each page (granular feedback)
        ocrCompleted++;
        onProgress?.(nativeCount + ocrCompleted, totalPages, true);
        
        return { pageNum, text };
      });
      
      const batchResults = await Promise.all(batchPromises);
      
      for (const { pageNum, text } of batchResults) {
        pageTexts[pageNum - 1] = text;
      }
      
      // Small pause between batches for UI responsiveness
      if (i + OCR_BATCH_SIZE < pagesNeedingOcr.length) {
        await new Promise(r => setTimeout(r, 10));
      }
    }
    
    console.log(`[Comprovante] OCR complete: ${ocrCompleted} pages processed`);
  }
  
  // Convert to string array (null should not exist at this point)
  const result = pageTexts.map((t, idx) => t ?? `[Empty page ${idx + 1}]`);
  
  // Cache result if not cancelled
  if (!shouldCancel?.()) {
    pageTextCache.set(key, result);
  }
  
  updateAccessOrder(key);
  return result;
}
