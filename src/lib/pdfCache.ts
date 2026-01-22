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
async function extractSinglePageText(pdf: PDFDocumentProxy, pageNum: number): Promise<string> {
  const page = await pdf.getPage(pageNum);
  const textContent = await page.getTextContent();
  const text = textContent.items.map((item: any) => item.str).join(' ');
  page.cleanup(); // Release memory immediately!
  return text;
}

const PAGE_BATCH_SIZE = 5; // Process 5 pages in parallel

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
