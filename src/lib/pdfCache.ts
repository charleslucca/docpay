import type { PDFDocumentProxy } from 'pdfjs-dist';

// Lazy load pdfjs-dist
let pdfjsLib: typeof import('pdfjs-dist') | null = null;

async function getPdfJs() {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js`;
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
    pdf = await pdfjs.getDocument({ data: buffer.slice(0) }).promise;
    pdfDocumentCache.set(key, pdf);
  }
  
  updateAccessOrder(key);
  return pdf;
}

// NEW: Get all page texts from a PDF (cached)
export async function getCachedPageTexts(file: File): Promise<string[]> {
  const key = getFileKey(file);
  
  let pageTexts = pageTextCache.get(key);
  if (!pageTexts) {
    const pdf = await getCachedPdf(file);
    pageTexts = [];
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const text = textContent.items.map((item: any) => item.str).join(' ');
      pageTexts.push(text);
    }
    
    pageTextCache.set(key, pageTexts);
  }
  
  updateAccessOrder(key);
  return pageTexts;
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
