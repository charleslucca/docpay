import { createScheduler, createWorker, Scheduler, Worker } from 'tesseract.js';

let scheduler: Scheduler | null = null;
let isInitializing = false;
let initPromise: Promise<Scheduler> | null = null;

// OPTIMIZED: Increase worker pool (min 4, max 8) for better parallelism
const WORKER_COUNT = Math.min(8, Math.max(4, Math.floor((navigator.hardwareConcurrency || 4) * 0.75)));

export type OcrProgressCallback = (progress: number) => void;

// OCR result type with metadata
export interface OcrPageResult {
  text: string;
  timedOut: boolean;
  durationMs: number;
  confidence?: number;
}

// OCR extraction options
export interface OcrExtractionOptions {
  timeoutMs?: number; // default 30000
}

// OCR result cache to avoid reprocessing pages
const ocrResultCache = new Map<string, string>();
const OCR_CACHE_MAX_SIZE = 1000;

/**
 * Generate a unique cache key for a page
 */
export function getOcrCacheKey(fileName: string, fileSize: number, pageNum: number): string {
  return `${fileName}_${fileSize}_${pageNum}`;
}

/**
 * Get cached OCR result if available
 */
export function getCachedOcrResult(key: string): string | undefined {
  return ocrResultCache.get(key);
}

/**
 * Store OCR result in cache with LRU eviction
 */
export function setCachedOcrResult(key: string, text: string): void {
  // Evict oldest if over limit
  if (ocrResultCache.size >= OCR_CACHE_MAX_SIZE) {
    const firstKey = ocrResultCache.keys().next().value;
    if (firstKey) ocrResultCache.delete(firstKey);
  }
  ocrResultCache.set(key, text);
}

/**
 * Clear OCR result cache
 */
export function clearOcrCache(): void {
  ocrResultCache.clear();
}

/**
 * Initialize OCR scheduler with worker pool (singleton pattern)
 * Downloads model files on first call (~15MB per worker), reuses afterwards
 */
export async function initOcrScheduler(): Promise<Scheduler> {
  // If already initialized, return existing scheduler
  if (scheduler) return scheduler;
  
  // If initialization is in progress, wait for it
  if (isInitializing && initPromise) {
    return initPromise;
  }
  
  isInitializing = true;
  
  initPromise = (async () => {
    try {
      console.log(`[OCR] Initializing scheduler with ${WORKER_COUNT} workers...`);
      
      scheduler = createScheduler();
      
      // Create workers in parallel
      const workerPromises = Array.from({ length: WORKER_COUNT }, async (_, idx) => {
        console.log(`[OCR] Starting worker ${idx + 1}/${WORKER_COUNT}...`);
        const worker = await createWorker('por', 1, {
          workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
          corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-simd.wasm.js',
          langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast',
        });
        console.log(`[OCR] Worker ${idx + 1}/${WORKER_COUNT} ready`);
        return worker;
      });
      
      const workers = await Promise.all(workerPromises);
      workers.forEach(w => scheduler!.addWorker(w));
      
      console.log(`[OCR] Scheduler ready with ${WORKER_COUNT} workers`);
      return scheduler;
    } catch (error) {
      console.error('[OCR] Failed to initialize scheduler:', error);
      scheduler = null;
      throw error;
    } finally {
      isInitializing = false;
      initPromise = null;
    }
  })();
  
  return initPromise;
}

/**
 * Extract text from multiple images in parallel using the worker pool
 * @param canvases - Array of canvas elements to process
 * @param onProgress - Callback for batch progress (completed, total)
 */
export async function extractTextBatch(
  canvases: HTMLCanvasElement[],
  onProgress?: (completed: number, total: number) => void
): Promise<string[]> {
  const sched = await initOcrScheduler();
  let completed = 0;
  
  console.log(`[OCR] Starting batch of ${canvases.length} pages with ${WORKER_COUNT} workers...`);
  const startTime = performance.now();
  
  const promises = canvases.map(async (canvas) => {
    const result = await sched.addJob('recognize', canvas);
    completed++;
    onProgress?.(completed, canvases.length);
    return result.data.text;
  });
  
  const results = await Promise.all(promises);
  
  const duration = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`[OCR] Batch completed in ${duration}s (${(canvases.length / parseFloat(duration)).toFixed(1)} pages/sec)`);
  
  return results;
}

// Default timeout per page to prevent hangs
const DEFAULT_SINGLE_PAGE_TIMEOUT_MS = 30000; // 30 seconds

/**
 * Extract text from a single image using the worker pool (returns string for backwards compatibility)
 * @param imageSource - Canvas element or image data URL
 * @param onProgress - Callback for recognition progress (0-100)
 * @param options - Optional extraction options (timeout)
 */
export async function extractTextWithOCR(
  imageSource: string | HTMLCanvasElement,
  onProgress?: OcrProgressCallback,
  options?: OcrExtractionOptions
): Promise<string> {
  const result = await extractTextWithOCRResult(imageSource, onProgress, options);
  return result.text;
}

/**
 * Extract text from a single image using the worker pool (returns full result with metadata)
 * @param imageSource - Canvas element or image data URL
 * @param onProgress - Callback for recognition progress (0-100)
 * @param options - Optional extraction options (timeout)
 */
export async function extractTextWithOCRResult(
  imageSource: string | HTMLCanvasElement,
  onProgress?: OcrProgressCallback,
  options?: OcrExtractionOptions
): Promise<OcrPageResult> {
  const sched = await initOcrScheduler();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_SINGLE_PAGE_TIMEOUT_MS;
  
  const startTime = performance.now();
  
  // Timeout promise to prevent indefinite hangs
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`OCR timeout after ${timeoutMs / 1000}s`)), timeoutMs);
  });
  
  try {
    const result = await Promise.race([
      sched.addJob('recognize', imageSource),
      timeoutPromise,
    ]);
    
    const durationMs = performance.now() - startTime;
    const durationSec = (durationMs / 1000).toFixed(2);
    
    // Only log slow pages (>2s) to reduce console spam
    if (durationMs > 2000) {
      console.log(`[OCR] Slow page: ${durationSec}s, confidence: ${result.data.confidence}%`);
    }
    
    onProgress?.(100);
    return {
      text: result.data.text,
      timedOut: false,
      durationMs,
      confidence: result.data.confidence,
    };
  } catch (error) {
    const durationMs = performance.now() - startTime;
    const durationSec = (durationMs / 1000).toFixed(2);
    console.error(`[OCR] Page failed after ${durationSec}s:`, error);
    onProgress?.(100);
    return {
      text: '', // Return empty string instead of hanging
      timedOut: true,
      durationMs,
    };
  }
}

/**
 * Terminate OCR scheduler and all workers to free memory
 * Call this when done with all OCR operations
 */
export async function terminateOcrWorker(): Promise<void> {
  if (scheduler) {
    console.log('[OCR] Terminating scheduler and workers...');
    await scheduler.terminate();
    scheduler = null;
    console.log('[OCR] Scheduler terminated');
  }
}

/**
 * Check if OCR scheduler is initialized
 */
export function isOcrWorkerReady(): boolean {
  return scheduler !== null;
}

/**
 * Get the number of workers in the pool
 */
export function getWorkerCount(): number {
  return WORKER_COUNT;
}
