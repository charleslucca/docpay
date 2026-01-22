import { createWorker, Worker } from 'tesseract.js';

let ocrWorker: Worker | null = null;
let isInitializing = false;
let initPromise: Promise<Worker> | null = null;

export type OcrProgressCallback = (progress: number) => void;

/**
 * Initialize OCR worker (singleton pattern)
 * Downloads model files on first call (~15MB), reuses worker afterwards
 */
export async function initOcrWorker(onProgress?: OcrProgressCallback): Promise<Worker> {
  // If already initialized, return existing worker
  if (ocrWorker) return ocrWorker;
  
  // If initialization is in progress, wait for it
  if (isInitializing && initPromise) {
    return initPromise;
  }
  
  isInitializing = true;
  
  initPromise = (async () => {
    try {
      console.log('[OCR] Initializing Tesseract worker (Portuguese)...');
      
      ocrWorker = await createWorker('por', 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-simd.wasm.js',
        langPath: 'https://tessdata.projectnaptha.com/4.0.0_best',
        logger: (m) => {
          // Log initialization progress
          if (m.status === 'loading tesseract core' || 
              m.status === 'loading language traineddata' ||
              m.status === 'initializing api') {
            console.log(`[OCR] ${m.status}: ${Math.round(m.progress * 100)}%`);
          }
          // Report recognition progress to callback
          if (m.status === 'recognizing text' && onProgress) {
            onProgress(Math.round(m.progress * 100));
          }
        },
      });
      
      console.log('[OCR] Worker initialized successfully');
      return ocrWorker;
    } catch (error) {
      console.error('[OCR] Failed to initialize worker:', error);
      ocrWorker = null;
      throw error;
    } finally {
      isInitializing = false;
      initPromise = null;
    }
  })();
  
  return initPromise;
}

/**
 * Extract text from image using OCR
 * @param imageSource - Canvas element or image data URL
 * @param onProgress - Callback for recognition progress (0-100)
 */
export async function extractTextWithOCR(
  imageSource: string | HTMLCanvasElement,
  onProgress?: OcrProgressCallback
): Promise<string> {
  const worker = await initOcrWorker(onProgress);
  
  console.log('[OCR] Starting text recognition...');
  const startTime = performance.now();
  
  const result = await worker.recognize(imageSource);
  
  const duration = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`[OCR] Recognition completed in ${duration}s`);
  console.log(`[OCR] Confidence: ${result.data.confidence}%`);
  
  return result.data.text;
}

/**
 * Terminate OCR worker to free memory
 * Call this when done with all OCR operations
 */
export async function terminateOcrWorker(): Promise<void> {
  if (ocrWorker) {
    console.log('[OCR] Terminating worker...');
    await ocrWorker.terminate();
    ocrWorker = null;
    console.log('[OCR] Worker terminated');
  }
}

/**
 * Check if OCR worker is initialized
 */
export function isOcrWorkerReady(): boolean {
  return ocrWorker !== null;
}
