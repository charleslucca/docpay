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

export function clearCache() {
  pdfDocumentCache.clear();
  arrayBufferCache.clear();
  accessOrder.length = 0;
}

export function getCacheStats() {
  return {
    documents: pdfDocumentCache.size,
    buffers: arrayBufferCache.size,
    maxSize: MAX_CACHE_SIZE,
  };
}
