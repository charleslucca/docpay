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
const MIN_TEXT_LENGTH_FOR_OCR = 100; // OPTIMIZED: Higher threshold to avoid unnecessary OCR
const MIN_ACCEPTABLE_OCR_TEXT = 40; // If OCR yields less than this, retry with higher scale
export const OCR_SCALE_ENHANCED = 3.0; // Higher scale for retry/enhanced mode

// OCR extraction options for comprovantes
export interface ComprovanteOcrOptions {
  scalePrimary?: number;       // default 2.0
  scaleRetry?: number;         // default 3.0
  timeoutPrimaryMs?: number;   // default 30000
  timeoutRetryMs?: number;     // default 45000
  minAcceptableTextLen?: number; // default 40
  retryOnShortText?: boolean;  // default true
  enhancedMode?: boolean;      // if true, use higher scale from the start
}

// OCR metrics for diagnostics
export interface OcrMetrics {
  pagesTotal: number;
  pagesNeedingOcr: number;
  pagesEmptyOrShort: number;
  timeoutCount: number;
  retryCount: number;
}

export type OcrExtractorWithResult = (
  canvas: HTMLCanvasElement,
  options?: { timeoutMs?: number }
) => Promise<{ text: string; timedOut: boolean; durationMs: number }>;

export type OcrProgressCallback = (pageNum: number, totalPages: number, isOcr: boolean) => void;

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
export const OCR_SCALE_HIGH = 1.8;  // OPTIMIZED: Reduced from 2.0 for ~20% faster OCR with minimal quality loss

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
 * Get page texts with OCR fallback for scanned PDFs (legacy interface, for backwards compatibility)
 */
export async function getCachedPageTextsWithOCR(
  file: File,
  ocrExtractor: (canvas: HTMLCanvasElement) => Promise<string>,
  onProgress?: (pageNum: number, totalPages: number, isOcr: boolean) => void,
  shouldCancel?: () => boolean
): Promise<string[]> {
  // Wrap legacy extractor to match new interface
  const wrappedExtractor: OcrExtractorWithResult = async (canvas, opts) => {
    const text = await ocrExtractor(canvas);
    return { text, timedOut: false, durationMs: 0 };
  };
  
  const { texts } = await getCachedPageTextsWithOCREnhanced(
    file,
    wrappedExtractor,
    onProgress,
    shouldCancel,
    {} // default options
  );
  return texts;
}

/**
 * Get page texts with OCR fallback for scanned PDFs
 * ENHANCED: Returns metrics, supports auto-retry for short text, and enhanced mode
 * First attempts native text extraction, falls back to OCR if text is too short
 */
export async function getCachedPageTextsWithOCREnhanced(
  file: File,
  ocrExtractor: OcrExtractorWithResult,
  onProgress?: OcrProgressCallback,
  shouldCancel?: () => boolean,
  options?: ComprovanteOcrOptions
): Promise<{ texts: string[]; metrics: OcrMetrics }> {
  const opts: Required<ComprovanteOcrOptions> = {
    scalePrimary: options?.enhancedMode ? OCR_SCALE_ENHANCED : (options?.scalePrimary ?? OCR_SCALE_HIGH),
    scaleRetry: options?.scaleRetry ?? OCR_SCALE_ENHANCED,
    timeoutPrimaryMs: options?.enhancedMode ? 45000 : (options?.timeoutPrimaryMs ?? 30000),
    timeoutRetryMs: options?.timeoutRetryMs ?? 45000,
    minAcceptableTextLen: options?.minAcceptableTextLen ?? MIN_ACCEPTABLE_OCR_TEXT,
    retryOnShortText: options?.retryOnShortText ?? false, // OPTIMIZED: Disabled by default for performance
    enhancedMode: options?.enhancedMode ?? false,
  };
  
  const cacheKeySuffix = opts.enhancedMode ? '_ocr_enhanced' : '_ocr';
  const key = getFileKey(file) + cacheKeySuffix;
  
  // Check cache first (only for non-enhanced, or if enhanced was previously cached)
  const cachedTexts = pageTextCache.get(key);
  if (cachedTexts) {
    updateAccessOrder(key);
    // Return cached with dummy metrics (we don't cache metrics)
    return {
      texts: cachedTexts,
      metrics: { pagesTotal: cachedTexts.length, pagesNeedingOcr: 0, pagesEmptyOrShort: 0, timeoutCount: 0, retryCount: 0 },
    };
  }
  
  const pdf = await getCachedPdf(file);
  const totalPages = pdf.numPages;
  const pageTexts: (string | null)[] = new Array(totalPages).fill(null);
  
  // Metrics tracking
  const metrics: OcrMetrics = {
    pagesTotal: totalPages,
    pagesNeedingOcr: 0,
    pagesEmptyOrShort: 0,
    timeoutCount: 0,
    retryCount: 0,
  };
  
  console.log(`[Comprovante] Processing ${file.name}: ${totalPages} page(s) with PARALLEL pipeline${opts.enhancedMode ? ' (ENHANCED MODE)' : ''}`);
  
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
  
  metrics.pagesNeedingOcr = pagesNeedingOcr.length;
  const nativeCount = totalPages - pagesNeedingOcr.length;
  console.log(`[Comprovante] Native extraction: ${nativeCount}/${totalPages} pages OK, ${pagesNeedingOcr.length} need OCR`);
  
  // STEP 2: Process OCR pages in parallel batches (if any)
  if (pagesNeedingOcr.length > 0) {
    onProgress?.(nativeCount, totalPages, true);
    
    // OPTIMIZED: Dynamic batch size based on worker count (4-8 workers)
    const { getWorkerCount } = await import('@/lib/ocrUtils');
    const OCR_BATCH_SIZE = Math.max(4, getWorkerCount()); // Use all available workers
    let ocrCompleted = 0;
    
    for (let i = 0; i < pagesNeedingOcr.length; i += OCR_BATCH_SIZE) {
      if (shouldCancel?.()) break;
      
      const batch = pagesNeedingOcr.slice(i, i + OCR_BATCH_SIZE);
      
      // Render and OCR batch in parallel with retry logic
      const batchPromises = batch.map(async (pageNum) => {
        // First attempt
        let canvas = await renderPageForOCR(file, pageNum, opts.scalePrimary, true);
        let result = await ocrExtractor(canvas, { timeoutMs: opts.timeoutPrimaryMs });
        
        // Track timeout
        if (result.timedOut) {
          metrics.timeoutCount++;
        }
        
        // Free first canvas
        canvas.width = 0;
        canvas.height = 0;
        
        // Retry if text too short and retry enabled
        if (opts.retryOnShortText && result.text.trim().length < opts.minAcceptableTextLen && !result.timedOut) {
          metrics.retryCount++;
          console.log(`[Comprovante] Page ${pageNum}: text too short (${result.text.trim().length} chars), retrying with scale ${opts.scaleRetry}...`);
          
          canvas = await renderPageForOCR(file, pageNum, opts.scaleRetry, true);
          const retryResult = await ocrExtractor(canvas, { timeoutMs: opts.timeoutRetryMs });
          
          if (retryResult.timedOut) {
            metrics.timeoutCount++;
          }
          
          // Use retry result if it's better
          if (retryResult.text.trim().length > result.text.trim().length) {
            result = retryResult;
          }
          
          // Free retry canvas
          canvas.width = 0;
          canvas.height = 0;
        }
        
        // Track empty/short pages
        if (result.text.trim().length < opts.minAcceptableTextLen) {
          metrics.pagesEmptyOrShort++;
        }
        
        // Update progress immediately after each page (granular feedback)
        ocrCompleted++;
        onProgress?.(nativeCount + ocrCompleted, totalPages, true);
        
        return { pageNum, text: result.text };
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
    
    console.log(`[Comprovante] OCR complete: ${ocrCompleted} pages processed, ${metrics.pagesEmptyOrShort} empty/short, ${metrics.timeoutCount} timeouts, ${metrics.retryCount} retries`);
  }
  
  // Convert to string array (null should not exist at this point)
  const result = pageTexts.map((t, idx) => t ?? `[Empty page ${idx + 1}]`);
  
  // Cache result if not cancelled
  if (!shouldCancel?.()) {
    pageTextCache.set(key, result);
  }
  
  updateAccessOrder(key);
  return { texts: result, metrics };
}

/**
 * Clear the cached texts for a specific file (for reprocessing with enhanced OCR)
 */
export function clearCachedTextsForFile(file: File): void {
  const key = getFileKey(file);
  pageTextCache.delete(key + '_ocr');
  pageTextCache.delete(key + '_ocr_enhanced');
}
