import { createScheduler, createWorker, Scheduler, Worker } from 'tesseract.js';

let scheduler: Scheduler | null = null;
let isInitializing = false;
let initPromise: Promise<Scheduler> | null = null;

// OPTIMIZED: Increase worker pool (min 4, max 8) for better parallelism
const WORKER_COUNT = Math.min(8, Math.max(4, Math.floor((navigator.hardwareConcurrency || 4) * 0.75)));

export type OcrProgressCallback = (progress: number) => void;

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

/**
 * Extract text from a single image using the worker pool
 * @param imageSource - Canvas element or image data URL
 * @param onProgress - Callback for recognition progress (0-100)
 */
export async function extractTextWithOCR(
  imageSource: string | HTMLCanvasElement,
  onProgress?: OcrProgressCallback
): Promise<string> {
  const sched = await initOcrScheduler();
  
  console.log('[OCR] Starting single page recognition...');
  const startTime = performance.now();
  
  const result = await sched.addJob('recognize', imageSource);
  
  const duration = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`[OCR] Recognition completed in ${duration}s`);
  console.log(`[OCR] Confidence: ${result.data.confidence}%`);
  
  // Call progress callback with 100% when done
  onProgress?.(100);
  
  return result.data.text;
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
