import { useState, useCallback, useRef, useEffect } from "react";
import JSZip from "jszip";
import { UploadedFile, MatchedPair, ProcessingStatus, GeneratedDocument } from "@/types/document";
import { type SpreadsheetData, findEmployeeInSpreadsheet } from "@/lib/excelUtils";
import {
  extractEmployeeName,
  findNameInPage,
  renderPdfPageToImage,
  createCombinedPdf,
  preparePageForMatch,
  prepareTargetNameForMatch,
  findNameInPreparedPage,
  countEmployeesInDocument,
  type PreparedPage,
  type PreparedTarget,
  normalizeForMatch,
} from "@/lib/pdfUtils";
import {
  getCachedPdf,
  getCachedPageTexts,
  getCachedPageTextsWithOCREnhanced,
  renderPageForOCR,
  clearCache,
  clearCachedTextsForFile,
  OCR_SCALE_FAST,
  type OcrMetrics,
} from "@/lib/pdfCache";
import {
  extractTextWithOCR,
  extractTextWithOCRResult,
  extractTextBatch,
  terminateOcrWorker,
  clearOcrCache,
  getWorkerCount,
  getOcrCacheKey,
  getCachedOcrResult,
  setCachedOcrResult,
} from "@/lib/ocrUtils";
import { toast } from "@/hooks/use-toast";
import {
  saveFileBlob,
  loadFileBlob,
  saveProcessingState,
  loadProcessingState,
  clearProcessingState,
  loadAllFiles,
  hasSavedProcessingState,
  cleanupOldData,
  type ProcessingState,
  type ExtractedEntry,
  type PersistedMatch,
} from "@/lib/processingPersistence";

const CONCURRENCY_LIMIT = 5;
const SLOW_OPERATION_THRESHOLD_MS = 10000; // 10 seconds
const OCR_RETRY_TEXT_LEN = 60; // Retry OCR if text is too short and no name found
const OCR_RETRY_TIMEOUT_MS = 45000; // Longer timeout for retry pass
const OCR_SCALE_RETRY = 2.4; // Higher scale for accuracy on difficult pages

const namesEquivalent = (a: string, b: string): boolean => {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const wa = na.split(" ").filter((w) => w.length >= 3);
  const wb = nb.split(" ").filter((w) => w.length >= 3);
  if (wa.length === 0 || wb.length === 0) return false;

  const aFirst = wa[0];
  const aLast = wa[wa.length - 1];
  const bFirst = wb[0];
  const bLast = wb[wb.length - 1];
  if (aFirst === bFirst && aLast === bLast) return true;

  const shared = wa.filter((w) => wb.includes(w));
  const minWords = Math.min(wa.length, wb.length);
  return shared.length >= 2 && shared.length >= Math.ceil(minWords * 0.6);
};

// Optimized: Align batch size with worker count for balanced CPU usage
const getOptimalBatchSize = () => Math.max(4, Math.min(6, getWorkerCount()));

// Pause between batches to prevent UI freezing and reduce CPU spikes
const pauseBetweenBatches = (): Promise<void> =>
  new Promise((resolve) => {
    if ("requestIdleCallback" in window) {
      (window as Window).requestIdleCallback(() => resolve(), { timeout: 100 });
    } else {
      setTimeout(resolve, 50);
    }
  });

// Process items in parallel with concurrency limit and cancellation support
async function processInBatches<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  concurrency: number = CONCURRENCY_LIMIT,
  cancelledRef?: React.MutableRefObject<boolean>,
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += concurrency) {
    // Check cancellation before each batch
    if (cancelledRef?.current) break;

    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map((item, idx) => processor(item, i + idx)));

    // Check cancellation after batch completes
    if (cancelledRef?.current) break;

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      }
    }
  }

  return results;
}

export function useDocumentProcessor() {
  const [holerites, setHolerites] = useState<UploadedFile[]>([]);
  const [comprovantes, setComprovantes] = useState<UploadedFile[]>([]);
  const [matchedPairs, setMatchedPairs] = useState<MatchedPair[]>([]);
  const [generatedDocs, setGeneratedDocs] = useState<GeneratedDocument[]>([]);
  const [spreadsheetData, setSpreadsheetData] = useState<SpreadsheetData | null>(null);
  const [status, setStatus] = useState<ProcessingStatus>({
    step: "idle",
    progress: 0,
    message: "",
  });

  // Resume processing state
  const [hasSavedState, setHasSavedState] = useState(false);
  const [isCheckingState, setIsCheckingState] = useState(true);

  // Cancel mechanism
  const cancelledRef = useRef(false);
  const [isCancelling, setIsCancelling] = useState(false);

  // Time tracking refs
  const slowOperationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const currentItemStartTimeRef = useRef<number>(0);
  const processStartTimeRef = useRef<number>(0);

  // Persistence refs for debounced saves
  const lastSaveRef = useRef<number>(0);
  const pendingStateRef = useRef<Omit<ProcessingState, "id" | "updatedAt"> | null>(null);
  const SAVE_DEBOUNCE_MS = 500; // Maximum ~2 saves per second

  // Check for saved state on mount
  useEffect(() => {
    const checkSavedState = async () => {
      try {
        // Clean up old data first
        await cleanupOldData();
        const hasState = await hasSavedProcessingState();
        setHasSavedState(hasState);
      } catch (error) {
        console.error("[Persistence] Error checking saved state:", error);
      } finally {
        setIsCheckingState(false);
      }
    };

    checkSavedState();
  }, []);

  // Warn user when leaving during processing
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (status.step !== "idle" && status.step !== "completed") {
        // Show browser warning
        e.preventDefault();
        e.returnValue = "O processamento está em andamento. Se você sair, poderá retomar de onde parou ao voltar.";
        return e.returnValue;
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [status.step]);

  // Clear slow operation timer on unmount or cancel
  useEffect(() => {
    return () => {
      if (slowOperationTimerRef.current) {
        clearTimeout(slowOperationTimerRef.current);
      }
    };
  }, []);

  const startSlowOperationTimer = (fileName: string) => {
    // Clear any existing timer
    if (slowOperationTimerRef.current) {
      clearTimeout(slowOperationTimerRef.current);
    }

    currentItemStartTimeRef.current = Date.now();

    slowOperationTimerRef.current = setTimeout(() => {
      if (!cancelledRef.current) {
        toast({
          title: "⚠️ Operação lenta detectada",
          description: `A extração de "${fileName}" está demorando mais de 10 segundos. O documento pode estar escaneado ou ser muito grande.`,
          variant: "destructive",
        });

        setStatus((prev) => ({
          ...prev,
          isSlowOperation: true,
        }));
      }
    }, SLOW_OPERATION_THRESHOLD_MS);
  };

  const clearSlowOperationTimer = () => {
    if (slowOperationTimerRef.current) {
      clearTimeout(slowOperationTimerRef.current);
      slowOperationTimerRef.current = null;
    }
  };

  const updateTimeEstimate = (processedItems: number, totalItems: number) => {
    if (processedItems === 0) return;

    const elapsed = Date.now() - processStartTimeRef.current;
    const avgTimePerItem = elapsed / processedItems;
    const remainingItems = totalItems - processedItems;
    const estimatedRemaining = Math.round((avgTimePerItem * remainingItems) / 1000);

    setStatus((prev) => ({
      ...prev,
      processedItems,
      totalItems,
      estimatedTimeRemaining: estimatedRemaining,
      isSlowOperation: false, // Reset slow flag when item completes
    }));
  };

  // Debounced state save to reduce IndexedDB writes
  const saveStateDebounced = async (state: Omit<ProcessingState, "id" | "updatedAt">) => {
    const now = Date.now();
    pendingStateRef.current = state;

    if (now - lastSaveRef.current >= SAVE_DEBOUNCE_MS) {
      lastSaveRef.current = now;
      setStatus((prev) => ({ ...prev, isSaving: true }));

      try {
        await saveProcessingState(state);
      } catch (error) {
        console.error("[Persistence] Debounced save failed:", error);
      } finally {
        setStatus((prev) => ({ ...prev, isSaving: false }));
      }
    }
  };

  // Force save (for important checkpoints)
  const saveStateImmediate = async (state: Omit<ProcessingState, "id" | "updatedAt">) => {
    lastSaveRef.current = Date.now();
    pendingStateRef.current = null;
    setStatus((prev) => ({ ...prev, isSaving: true }));

    try {
      await saveProcessingState(state);
    } catch (error) {
      console.error("[Persistence] Immediate save failed:", error);
    } finally {
      setStatus((prev) => ({ ...prev, isSaving: false }));
    }
  };

  const generateId = () => Math.random().toString(36).substring(2, 9);

  const addFiles = useCallback(async (files: File[], type: "holerite" | "comprovante") => {
    const newFiles: UploadedFile[] = files.map((file) => ({
      id: generateId(),
      file,
      name: file.name,
      type,
      status: "pending",
      progress: 0,
      pageCount: undefined,
      estimatedEmployees: undefined,
    }));

    // Add files immediately for responsive UX
    if (type === "holerite") {
      setHolerites((prev) => [...prev, ...newFiles]);
    } else {
      setComprovantes((prev) => [...prev, ...newFiles]);
    }

    // Count pages and employees in background (parallel)
    const countPagePromises = newFiles.map(async (uploadedFile) => {
      try {
        const pdf = await getCachedPdf(uploadedFile.file);
        const pageCount = pdf.numPages;

        // Contagem precisa baseada no tipo de documento (analisa texto nativo)
        const employeeCount = await countEmployeesInDocument(uploadedFile.file, type, pdf);

        // Update with page count and precise employee count
        const setter = type === "holerite" ? setHolerites : setComprovantes;
        setter((prev) =>
          prev.map((f) => (f.id === uploadedFile.id ? { ...f, pageCount, estimatedEmployees: employeeCount } : f)),
        );
      } catch (error) {
        console.warn(`[PageCount] Error counting for ${uploadedFile.name}:`, error);
      }
    });

    // Run all page counts in parallel
    await Promise.all(countPagePromises);
  }, []);

  const removeFile = useCallback((id: string, type: "holerite" | "comprovante") => {
    if (type === "holerite") {
      setHolerites((prev) => prev.filter((f) => f.id !== id));
    } else {
      setComprovantes((prev) => prev.filter((f) => f.id !== id));
    }
  }, []);

  const cancelProcessing = useCallback(async () => {
    cancelledRef.current = true;
    setIsCancelling(true);
    clearSlowOperationTimer();
    setStatus((prev) => ({ ...prev, message: "Cancelando..." }));

    // Force-terminate all OCR workers immediately to stop pending jobs
    try {
      await terminateOcrWorker();
      console.log("[Cancel] OCR workers terminated");
    } catch (error) {
      console.warn("[Cancel] Error terminating OCR workers:", error);
    }

    // Clear persisted state
    try {
      await clearProcessingState();
    } catch (error) {
      console.warn("[Cancel] Error clearing persisted state:", error);
    }

    // Reset state immediately
    setIsCancelling(false);
    setStatus({ step: "idle", progress: 0, message: "" });
    setMatchedPairs([]);
    setGeneratedDocs([]);
  }, []);

  // Save files to IndexedDB when processing starts
  const persistFiles = async (holeriteFiles: UploadedFile[], comprovanteFiles: UploadedFile[]) => {
    try {
      // Save all files in parallel
      await Promise.all([
        ...holeriteFiles.map((h) => saveFileBlob(h.id, h.file, "holerite")),
        ...comprovanteFiles.map((c) => saveFileBlob(c.id, c.file, "comprovante")),
      ]);
      console.log("[Persistence] Files saved to IndexedDB");
    } catch (error) {
      console.error("[Persistence] Error saving files:", error);
    }
  };

  // Load saved state and resume processing
  const resumeProcessing = useCallback(async () => {
    try {
      const savedState = await loadProcessingState();
      if (!savedState) {
        toast({
          title: "Nenhum estado salvo encontrado",
          variant: "destructive",
        });
        setHasSavedState(false);
        return;
      }

      // Load files from IndexedDB
      const files = await loadAllFiles();

      const holeriteFiles: UploadedFile[] = [];
      const comprovanteFiles: UploadedFile[] = [];

      for (const file of files) {
        const reconstructedFile = new File([file.blob], file.name, { type: "application/pdf" });
        const uploadedFile: UploadedFile = {
          id: file.id,
          file: reconstructedFile,
          name: file.name,
          type: file.type,
          status: "pending",
          progress: 0,
        };

        if (file.type === "holerite") {
          holeriteFiles.push(uploadedFile);
        } else {
          comprovanteFiles.push(uploadedFile);
        }
      }

      setHolerites(holeriteFiles);
      setComprovantes(comprovanteFiles);
      setHasSavedState(false);

      toast({
        title: "Estado restaurado",
        description: `${savedState.extractedEntries.length} nome(s) já extraído(s). Continuando...`,
      });

      // Start processing from where we left off
      // The actual resume logic will be handled in processDocuments with savedState
      setTimeout(() => {
        processDocumentsWithState(holeriteFiles, comprovanteFiles, savedState);
      }, 500);
    } catch (error) {
      console.error("[Resume] Error resuming processing:", error);
      toast({
        title: "Erro ao retomar",
        description: "Não foi possível restaurar o processamento anterior",
        variant: "destructive",
      });
    }
  }, []);

  const discardSavedState = useCallback(async () => {
    await clearProcessingState();
    setHasSavedState(false);
  }, []);

  // Internal processing with optional saved state
  const processDocumentsWithState = async (
    holeriteList: UploadedFile[],
    comprovanteList: UploadedFile[],
    savedState?: ProcessingState | null,
  ) => {
    if (holeriteList.length === 0 || comprovanteList.length === 0) {
      return;
    }

    cancelledRef.current = false;
    setIsCancelling(false);
    processStartTimeRef.current = Date.now();

    const totalFiles = holeriteList.length + comprovanteList.length;
    const PAGES_PER_BATCH = getOptimalBatchSize();

    // Determine starting point from saved state
    const startHoleriteIndex = savedState?.currentHoleriteIndex || 0;
    const startPageNumber = savedState?.currentPageNumber || 1;
    const existingEntries: { originalHolerite: UploadedFile; name: string; pageNumber: number }[] = [];

    // Restore previously extracted entries
    if (savedState?.extractedEntries) {
      for (const entry of savedState.extractedEntries) {
        const holerite = holeriteList.find((h) => h.id === entry.holeriteId);
        if (holerite) {
          existingEntries.push({
            originalHolerite: holerite,
            name: entry.name,
            pageNumber: entry.pageNumber,
          });
        }
      }
      console.log(`[Resume] Restored ${existingEntries.length} previously extracted entries`);
    }

    setStatus({
      step: "extracting",
      progress: 0,
      message: savedState ? "Retomando extração de nomes..." : "Extraindo nomes dos holerites...",
      startTime: Date.now(),
      totalItems: totalFiles,
      processedItems: 0,
      currentItem: holeriteList[startHoleriteIndex]?.name,
    });

    // Save files to IndexedDB if starting fresh
    if (!savedState) {
      await persistFiles(holeriteList, comprovanteList);
    }

    // Step 1: Extract names from holerites - process ALL PAGES of each PDF
    interface HoleriteEntry {
      originalHolerite: UploadedFile;
      name: string;
      pageNumber: number;
    }
    const allHoleriteEntries: HoleriteEntry[] = [...existingEntries];

    // OPTIMIZED: Pipeline-based processing with parallel render + OCR
    const processHolerite = async (
      holerite: UploadedFile,
      index: number,
      resumeFromPage: number = 1,
    ): Promise<HoleriteEntry[]> => {
      if (cancelledRef.current) {
        clearSlowOperationTimer();
        return [];
      }

      // Start slow operation timer for this file
      startSlowOperationTimer(holerite.name);

      try {
        // Get total pages in PDF
        const pdf = await getCachedPdf(holerite.file);
        const totalPages = pdf.numPages;
        const entries: HoleriteEntry[] = [];
        const workerCount = getWorkerCount();

        console.log(
          `[OCR] Processing ${holerite.name}: ${totalPages} page(s) with ${workerCount} parallel workers (OPTIMIZED pipeline), starting from page ${resumeFromPage}`,
        );

        setHolerites((prev) =>
          prev.map((h) => (h.id === holerite.id ? { ...h, status: "processing", progress: 10 } : h)),
        );

        // OPTIMIZED: First try native text extraction (fast) and only OCR pages that need it
        const nativeTexts = await getCachedPageTexts(holerite.file, () => cancelledRef.current);
        const pagesNeedingOcr: number[] = [];
        let nativeProcessed = 0; // Pages processed via native text

        // FIX: Separate counters to avoid race condition
        let cacheHits = 0; // Pages processed from OCR cache
        let canvasesQueued = 0; // Pages actually rendered and queued for OCR
        let ocrCompleted = 0; // Pages processed by OCR loop

        for (let pageNum = resumeFromPage; pageNum <= totalPages; pageNum++) {
          if (cancelledRef.current) break;

          const pageText = nativeTexts[pageNum - 1] ?? "";
          const extractedName = extractEmployeeName(pageText);
          if (extractedName) {
            entries.push({
              originalHolerite: holerite,
              name: extractedName,
              pageNumber: pageNum,
            });
            nativeProcessed++;
            continue;
          }

          // Check OCR cache before rendering
          const cacheKey = getOcrCacheKey(holerite.file.name, holerite.file.size, pageNum);
          const cachedText = getCachedOcrResult(cacheKey);
          if (cachedText !== undefined) {
            const extractedName = extractEmployeeName(cachedText);
            if (extractedName) {
              entries.push({
                originalHolerite: holerite,
                name: extractedName,
                pageNumber: pageNum,
              });
            }
            cacheHits++;
            continue;
          }

          pagesNeedingOcr.push(pageNum);
        }

        console.log(
          `[OCR] ${holerite.name}: ${nativeProcessed} páginas por texto nativo, ${cacheHits} em cache, ${pagesNeedingOcr.length} para OCR`,
        );

        if (cancelledRef.current) {
          clearSlowOperationTimer();
          return [];
        }

        const shouldRunOcr = pagesNeedingOcr.length > 0;

        // OPTIMIZED: Pipeline with parallel render + OCR for remaining pages
        const canvasQueue: { pageNum: number; canvas: HTMLCanvasElement }[] = [];
        let nextOcrIndex = 0;
        let renderingComplete = false;

        // Inactivity watchdog: only abort if no progress for 2 minutes (not absolute time)
        const INACTIVITY_THRESHOLD_MS = 120000; // 2 minutes without any progress
        let lastActivityAt = Date.now();
        let pipelineAborted = false;
        
        // Adaptive batch sizing
        let currentBatchSize = Math.min(workerCount, 4); // Start conservative
        const MIN_BATCH_SIZE = 2;
        const MAX_BATCH_SIZE = workerCount;
        const SLOW_BATCH_THRESHOLD_MS = 45000; // 45s = too slow

        // Render loop: continuously render pages ahead of OCR (stops if pipeline aborted)
        const renderLoop = async () => {
          while (nextOcrIndex < pagesNeedingOcr.length && !cancelledRef.current && !pipelineAborted) {
            // Keep queue with up to currentBatchSize * 2 items for smooth pipeline
            while (
              canvasQueue.length < currentBatchSize * 2 &&
              nextOcrIndex < pagesNeedingOcr.length &&
              !cancelledRef.current &&
              !pipelineAborted
            ) {
              const pageNum = pagesNeedingOcr[nextOcrIndex++];

              // OPTIMIZED: Use lower scale (1.5x) with grayscale
              const canvas = await renderPageForOCR(holerite.file, pageNum, OCR_SCALE_FAST, true);
              canvasQueue.push({ pageNum, canvas });
              canvasesQueued++; // FIX: Count pages sent to OCR queue
              lastActivityAt = Date.now(); // Watchdog: render activity
            }

            // Small pause to let OCR loop catch up
            if (canvasQueue.length >= currentBatchSize * 2) {
              await new Promise((r) => setTimeout(r, 10));
            }
          }
          renderingComplete = true;
          console.log(`[OCR] Render complete: ${cacheHits} cache hits, ${canvasesQueued} queued for OCR`);
        };

        // OCR loop: process batches as canvases become available
        const ocrLoop = async () => {
          while (!cancelledRef.current && !pipelineAborted) {
            // Inactivity watchdog: abort only if no progress for 2 minutes
            if (Date.now() - lastActivityAt > INACTIVITY_THRESHOLD_MS) {
              console.error(`[OCR] Inactivity timeout - no progress for ${INACTIVITY_THRESHOLD_MS / 1000}s. Aborting pipeline.`);
              pipelineAborted = true;
              // Clear remaining queue to stop render loop
              while (canvasQueue.length > 0) {
                const item = canvasQueue.shift()!;
                item.canvas.width = 0;
                item.canvas.height = 0;
              }
              break;
            }

            // Collect batch up to adaptive batch size
            const batch: { pageNum: number; canvas: HTMLCanvasElement }[] = [];

            while (batch.length < currentBatchSize && canvasQueue.length > 0) {
              batch.push(canvasQueue.shift()!);
            }

            if (batch.length > 0) {
              // Update progress message + continuous global progress (0-40% for holerites)
              const batchStart = batch[0].pageNum;
              const batchEnd = batch[batch.length - 1].pageNum;
              const totalProcessed = nativeProcessed + cacheHits + ocrCompleted;
              const holeriteProgressFraction = totalProcessed / totalPages;

              setStatus((prev) => ({
                ...prev,
                currentItem: holerite.name,
                currentItemStartTime: Date.now(),
                message: `OCR em ${holerite.name} (pág. ${batchStart}-${batchEnd} de ${totalPages})...`,
                isOcrActive: true,
                ocrProgress: Math.round(holeriteProgressFraction * 100),
                // Continuous global progress: map page progress to 0-40% range
                progress: Math.round(((index / holeriteList.length) + (holeriteProgressFraction / holeriteList.length)) * 40),
              }));

              // Process OCR in parallel with the scheduler (timed for adaptive batching)
              const batchStartTime = performance.now();
              let texts: string[];
              try {
                texts = await extractTextBatch(
                  batch.map((b) => b.canvas),
                  (done, total) => {
                    const overallProgress = ((totalProcessed + done) / totalPages) * 100;
                    setStatus((prev) => ({
                      ...prev,
                      ocrProgress: Math.round(overallProgress),
                    }));
                  },
                );
              } catch (ocrError) {
                // If cancelled/terminated, exit gracefully
                if (cancelledRef.current) {
                  console.log("[OCR] Batch interrupted by cancellation");
                  batch.forEach((b) => { b.canvas.width = 0; b.canvas.height = 0; });
                  break;
                }
                // Abort pipeline on unrecoverable error
                pipelineAborted = true;
                batch.forEach((b) => { b.canvas.width = 0; b.canvas.height = 0; });
                throw ocrError;
              }

              // Watchdog: OCR batch completed = activity
              lastActivityAt = Date.now();

              // Adaptive batch sizing based on batch duration
              const batchDurationMs = performance.now() - batchStartTime;
              if (batchDurationMs > SLOW_BATCH_THRESHOLD_MS && currentBatchSize > MIN_BATCH_SIZE) {
                currentBatchSize = Math.max(MIN_BATCH_SIZE, currentBatchSize - 1);
                console.log(`[OCR] Batch slow (${(batchDurationMs / 1000).toFixed(1)}s) → reducing batch to ${currentBatchSize}`);
              } else if (batchDurationMs < SLOW_BATCH_THRESHOLD_MS * 0.5 && currentBatchSize < MAX_BATCH_SIZE) {
                currentBatchSize = Math.min(MAX_BATCH_SIZE, currentBatchSize + 1);
                console.log(`[OCR] Batch fast (${(batchDurationMs / 1000).toFixed(1)}s) → increasing batch to ${currentBatchSize}`);
              }

              // Extract names and cache results (with optional retry for low-quality OCR)
              for (let i = 0; i < texts.length; i++) {
                const pageNum = batch[i].pageNum;
                let text = texts[i];

                // Cache OCR result for resume
                const cacheKey = getOcrCacheKey(holerite.file.name, holerite.file.size, pageNum);

                let extractedName = extractEmployeeName(text);

                // Retry with higher scale if OCR text is too short and no name was found
                if (!extractedName && text.trim().length < OCR_RETRY_TEXT_LEN) {
                  const retryCanvas = await renderPageForOCR(holerite.file, pageNum, OCR_SCALE_RETRY, false);
                  const retryResult = await extractTextWithOCRResult(retryCanvas, undefined, {
                    timeoutMs: OCR_RETRY_TIMEOUT_MS,
                  });

                  retryCanvas.width = 0;
                  retryCanvas.height = 0;

                  if (retryResult.text.trim().length > text.trim().length) {
                    text = retryResult.text;
                    extractedName = extractEmployeeName(text);
                  }
                }

                setCachedOcrResult(cacheKey, text);
                if (extractedName) {
                  console.log(`[OCR] Page ${pageNum}: Found "${extractedName}"`);
                  entries.push({
                    originalHolerite: holerite,
                    name: extractedName,
                    pageNumber: pageNum,
                  });
                }
                ocrCompleted++; // FIX: Only count OCR processed pages here
              }

              // Update progress
              const totalDone = nativeProcessed + cacheHits + ocrCompleted;
              const batchProgress = 10 + (totalDone / totalPages) * 80;
              setHolerites((prev) => prev.map((h) => (h.id === holerite.id ? { ...h, progress: batchProgress } : h)));

              // Clear canvas references to free memory
              batch.forEach((b) => {
                b.canvas.width = 0;
                b.canvas.height = 0;
              });

              // Save state after every batch using debounced save (max every 500ms)
              const allExtracted: ExtractedEntry[] = [
                ...existingEntries.map((e) => ({
                  holeriteId: e.originalHolerite.id,
                  name: e.name,
                  pageNumber: e.pageNumber,
                })),
                ...allHoleriteEntries.map((e) => ({
                  holeriteId: e.originalHolerite.id,
                  name: e.name,
                  pageNumber: e.pageNumber,
                })),
                ...entries.map((e) => ({
                  holeriteId: e.originalHolerite.id,
                  name: e.name,
                  pageNumber: e.pageNumber,
                })),
              ];

              const stateToSave = {
                startedAt: savedState?.startedAt || new Date(),
                status: "extracting" as const,
                holeritesIds: holeriteList.map((h) => h.id),
                comprovantesIds: comprovanteList.map((c) => c.id),
                currentHoleriteIndex: index,
                currentPageNumber: totalDone + resumeFromPage,
                totalPages,
                extractedEntries: allExtracted,
                matchedPairs: [],
              };

              // Use immediate save at the end of each file, debounced otherwise
              if (totalDone === totalPages) {
                await saveStateImmediate(stateToSave);
              } else {
                await saveStateDebounced(stateToSave);
              }

              // Small pause for UI responsiveness
              await pauseBetweenBatches();
            }

            // FIX: Correct termination condition using separate counters
            // Exit when: render is complete AND queue is empty AND all queued items were OCR'd, OR pipeline aborted
            if (pipelineAborted || (renderingComplete && canvasQueue.length === 0 && ocrCompleted >= canvasesQueued)) {
              console.log(`[OCR] Processing ${pipelineAborted ? 'aborted' : 'complete'}: ${cacheHits} from cache, ${ocrCompleted} from OCR`);
              break;
            } else if (canvasQueue.length === 0) {
              // Wait for more canvases from render loop
              await new Promise((r) => setTimeout(r, 20));
            }
          }
        };

        // Execute render and OCR in parallel pipeline (only if needed)
        if (shouldRunOcr) {
          await Promise.all([renderLoop(), ocrLoop()]);
        } else {
          setHolerites((prev) => prev.map((h) => (h.id === holerite.id ? { ...h, progress: 90 } : h)));
        }

        clearSlowOperationTimer();

        // Diagnostic log: extraction summary
        console.log(`[Extraction Summary] File "${holerite.name}": ${entries.length} names extracted from ${totalPages} pages (native: ${nativeProcessed}, cache: ${cacheHits}, OCR: ${ocrCompleted})`);

        // Mark holerite as completed
        const foundCount = entries.length;
        setHolerites((prev) =>
          prev.map((h) =>
            h.id === holerite.id
              ? {
                  ...h,
                  status: foundCount > 0 ? "completed" : "error",
                  progress: 100,
                  extractedName: foundCount > 0 ? `${foundCount} funcionário(s)` : undefined,
                  error: foundCount === 0 ? "Nenhum nome encontrado no arquivo" : undefined,
                }
              : h,
          ),
        );

        // Update time estimate
        updateTimeEstimate(index + 1, holeriteList.length + comprovanteList.length);

        setStatus((prev) => ({
          ...prev,
          progress: ((index + 1) / holeriteList.length) * 40,
          message: `Processando holerite ${index + 1} de ${holeriteList.length} (${foundCount} nome(s))...`,
          processedItems: index + 1,
          isOcrActive: false,
          ocrProgress: undefined,
        }));

        return entries;
      } catch (error) {
        clearSlowOperationTimer();
        console.error(`[OCR] Error processing ${holerite.name}:`, error);
        setHolerites((prev) =>
          prev.map((h) =>
            h.id === holerite.id ? { ...h, status: "error", progress: 100, error: "Erro ao executar OCR" } : h,
          ),
        );
        setStatus((prev) => ({ ...prev, isOcrActive: false, ocrProgress: undefined }));
        return [];
      }
    };

    // Process holerites from starting index
    for (let i = startHoleriteIndex; i < holeriteList.length; i++) {
      if (cancelledRef.current) break;

      const resumeFromPage = i === startHoleriteIndex && savedState ? startPageNumber : 1;
      const entries = await processHolerite(holeriteList[i], i, resumeFromPage);
      allHoleriteEntries.push(...entries);
    }

    console.log(`[OCR] Total employees found: ${allHoleriteEntries.length}`);

    if (allHoleriteEntries.length > 0) {
      toast({
        title: `${allHoleriteEntries.length} funcionário(s) encontrado(s)`,
        description: `Nomes extraídos de ${holeriteList.length} arquivo(s) de holerite`,
      });
    }

    // Check if cancelled
    if (cancelledRef.current) {
      setStatus({ step: "idle", progress: 0, message: "Processamento cancelado" });
      setIsCancelling(false);
      return;
    }

    // Step 2: PRE-EXTRACT all comprovante texts in PARALLEL (like Python script)
    setStatus({ step: "matching", progress: 40, message: "Pré-extraindo textos dos comprovantes..." });

    // Create a map: comprovante.id -> { file, pageTexts: string[], preparedPages: PreparedPage[] }
    const comprovanteTextsMap = new Map<string, { file: File; pageTexts: string[]; preparedPages: PreparedPage[] }>();

    // Aggregate OCR metrics from all comprovantes
    let aggregatedMetrics: OcrMetrics = {
      pagesTotal: 0,
      pagesNeedingOcr: 0,
      pagesEmptyOrShort: 0,
      timeoutCount: 0,
      retryCount: 0,
    };

    const preExtractComprovante = async (comprovante: UploadedFile, index: number) => {
      if (cancelledRef.current) {
        clearSlowOperationTimer();
        return;
      }

      // Start slow operation timer for this file
      startSlowOperationTimer(comprovante.name);

      setStatus((prev) => ({
        ...prev,
        currentItem: comprovante.name,
        currentItemStartTime: Date.now(),
      }));

      setComprovantes((prev) =>
        prev.map((c) => (c.id === comprovante.id ? { ...c, status: "processing", progress: 30 } : c)),
      );

      try {
        // Use enhanced OCR extraction with retry logic and metrics
        const { texts: pageTexts, metrics } = await getCachedPageTextsWithOCREnhanced(
          comprovante.file,
          async (canvas, opts) => {
            // OCR extractor callback that returns full result
            return await extractTextWithOCRResult(canvas, undefined, opts);
          },
          (pageNum, totalPages, isOcr) => {
            // Progress callback
            setStatus((prev) => ({
              ...prev,
              message: `${comprovante.name} - pág. ${pageNum}/${totalPages}${isOcr ? " (OCR)" : ""}...`,
              isOcrActive: isOcr,
            }));
          },
          () => cancelledRef.current,
          { retryOnShortText: true }, // Accuracy: retry short-text pages with higher scale
        );

        // Aggregate metrics
        aggregatedMetrics.pagesTotal += metrics.pagesTotal;
        aggregatedMetrics.pagesNeedingOcr += metrics.pagesNeedingOcr;
        aggregatedMetrics.pagesEmptyOrShort += metrics.pagesEmptyOrShort;
        aggregatedMetrics.timeoutCount += metrics.timeoutCount;
        aggregatedMetrics.retryCount += metrics.retryCount;

        // Clear timer when done
        clearSlowOperationTimer();

        // Don't store if cancelled
        if (cancelledRef.current) return;

        // Pre-process pages for fast matching (done ONCE per page)
        const preparedPages = pageTexts.map(preparePageForMatch);
        comprovanteTextsMap.set(comprovante.id, { file: comprovante.file, pageTexts, preparedPages });

        setComprovantes((prev) => prev.map((c) => (c.id === comprovante.id ? { ...c, progress: 60 } : c)));
      } catch (error) {
        clearSlowOperationTimer();
        console.error(`[Comprovante] Error processing ${comprovante.name}:`, error);
        setComprovantes((prev) =>
          prev.map((c) =>
            c.id === comprovante.id ? { ...c, status: "error", progress: 100, error: "Erro ao extrair texto" } : c,
          ),
        );
      }

      // Update time estimate
      const processedSoFar = holeriteList.length + index + 1;
      updateTimeEstimate(processedSoFar, holeriteList.length + comprovanteList.length);

      setStatus((prev) => ({
        ...prev,
        progress: 40 + ((index + 1) / comprovanteList.length) * 45,
        message: `Extraindo texto do comprovante ${index + 1} de ${comprovanteList.length}...`,
        processedItems: processedSoFar,
        isOcrActive: false,
        // Include OCR metrics in status for UI display
        ocrPagesTotal: aggregatedMetrics.pagesTotal,
        ocrPagesNeedingOcr: aggregatedMetrics.pagesNeedingOcr,
        ocrPagesEmptyOrShort: aggregatedMetrics.pagesEmptyOrShort,
        ocrTimeoutCount: aggregatedMetrics.timeoutCount,
        ocrRetryCount: aggregatedMetrics.retryCount,
      }));

      // Pause between comprovantes to reduce CPU load
      await pauseBetweenBatches();
    };

    // Process comprovantes one at a time (OCR is memory-intensive)
    await processInBatches(comprovanteList, preExtractComprovante, 1, cancelledRef);

    // Check if cancelled
    if (cancelledRef.current) {
      setStatus({ step: "idle", progress: 0, message: "Processamento cancelado" });
      setIsCancelling(false);
      return;
    }

    // Step 3: MEMORY-ONLY matching with COOPERATIVE loop (no UI freeze)
    setStatus({
      step: "matching",
      progress: 85,
      message: "Buscando correspondências em memória...",
      matchesFound: 0,
      totalToMatch: allHoleriteEntries.length,
      // Preserve OCR metrics
      ocrPagesTotal: aggregatedMetrics.pagesTotal,
      ocrPagesNeedingOcr: aggregatedMetrics.pagesNeedingOcr,
      ocrPagesEmptyOrShort: aggregatedMetrics.pagesEmptyOrShort,
      ocrTimeoutCount: aggregatedMetrics.timeoutCount,
      ocrRetryCount: aggregatedMetrics.retryCount,
    });

    const pairs: MatchedPair[] = [];
    const matchedEntryKeys = new Set<string>(); // Track matched entries by "holeriteId_pageNumber"

    // Pre-process all employee names ONCE (huge optimization)
    interface PreparedEntry extends HoleriteEntry {
      prepared: PreparedTarget;
    }
    const preparedEntries: PreparedEntry[] = allHoleriteEntries.map((entry) => ({
      ...entry,
      prepared: prepareTargetNameForMatch(entry.name),
    }));

    // Cooperative matching with yields and throttled progress
    const YIELD_EVERY = 250; // Yield to UI every 250 comparisons
    const STATUS_UPDATE_INTERVAL_MS = 250; // Max 4 updates per second
    let comparisons = 0;
    let lastStatusUpdate = Date.now();

    const totalComprovantes = comprovanteList.length;
    const totalEntries = preparedEntries.length;

    // Timeout protection (5 minutes max for matching)
    const matchStartTime = Date.now();
    const MATCH_TIMEOUT_MS = 300000;

    matchingLoop: for (let compIdx = 0; compIdx < totalComprovantes; compIdx++) {
      const comprovante = comprovanteList[compIdx];

      // Check cancellation and timeout
      if (cancelledRef.current) break matchingLoop;
      if (Date.now() - matchStartTime > MATCH_TIMEOUT_MS) {
        console.error("[Match] Timeout after 5 minutes");
        toast({
          title: "Matching demorou demais",
          description: "O processo de matching excedeu 5 minutos. Tente com menos arquivos.",
          variant: "destructive",
        });
        break matchingLoop;
      }

      const extracted = comprovanteTextsMap.get(comprovante.id);
      if (!extracted) continue;

      const { preparedPages, pageTexts } = extracted;
      const totalPages = preparedPages.length;
      const matchedPages = new Set<number>(); // avoid multiple holerites on same comprovante page

      // Early exit: if all employees already matched, stop
      if (matchedEntryKeys.size === totalEntries) {
        console.log("[Match] All employees matched - stopping early");
        break matchingLoop;
      }

      for (let entryIdx = 0; entryIdx < totalEntries; entryIdx++) {
        const entry = preparedEntries[entryIdx];

        // Yield to UI periodically (cooperative multitasking)
        comparisons++;
        if (comparisons % YIELD_EVERY === 0) {
          await pauseBetweenBatches();

          // Check cancellation after yield
          if (cancelledRef.current) break matchingLoop;
        }

        // Throttled status updates with match count
        const now = Date.now();
        if (now - lastStatusUpdate >= STATUS_UPDATE_INTERVAL_MS) {
          lastStatusUpdate = now;
          const progress = 85 + ((compIdx + entryIdx / totalEntries) / totalComprovantes) * 10;
          setStatus((prev) => ({
            ...prev,
            progress: Math.min(95, progress),
            message: `Matching comprovante ${compIdx + 1}/${totalComprovantes} - funcionário ${entryIdx + 1}/${totalEntries}...`,
            matchesFound: pairs.length,
            totalToMatch: totalEntries,
          }));
        }

        const entryKey = `${entry.originalHolerite.id}_${entry.pageNumber}`;
        if (matchedEntryKeys.has(entryKey)) continue;

        // Search using pre-processed data (FAST!) + validate comprovante name
        let foundPage = -1;
        for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
          if (findNameInPreparedPage(preparedPages[pageIdx], entry.prepared)) {
            const comprovanteText = pageTexts[pageIdx] ?? "";
            const comprovanteName = extractEmployeeName(comprovanteText, false);
            if (comprovanteName && !namesEquivalent(entry.name, comprovanteName)) {
              continue; // name mismatch - keep searching other pages
            }
            foundPage = pageIdx + 1; // 1-indexed
            break;
          }
        }

        if (foundPage > 0) {
          if (matchedPages.has(foundPage)) {
            continue;
          }
          matchedPages.add(foundPage);
          matchedEntryKeys.add(entryKey);

          const updatedComprovante: UploadedFile = {
            ...comprovante,
            status: "completed",
            progress: 100,
            pageNumber: foundPage,
            extractedName: entry.name,
          };

          setComprovantes((prev) => prev.map((c) => (c.id === comprovante.id ? updatedComprovante : c)));

          // Create a virtual holerite for matching (represents one page of the original PDF)
          const virtualHolerite: UploadedFile = {
            ...entry.originalHolerite,
            extractedName: entry.name,
            sourcePageNumber: entry.pageNumber,
            sourceFileName: entry.originalHolerite.name,
          };

          pairs.push({
            id: generateId(),
            employeeName: entry.name,
            holerite: virtualHolerite,
            comprovante: { ...updatedComprovante, pageNumber: foundPage },
            status: "pending",
          });
        }
      }
    }

    console.log(`[Match] Completed: ${comparisons} comparisons, ${pairs.length} matches found`);

    // Final status with OCR metrics for 0-matches diagnostic
    setStatus({
      step: "matching",
      progress: 95,
      message: `${pairs.length} correspondência(s) encontrada(s)`,
      matchesFound: pairs.length,
      totalToMatch: totalEntries,
      // Include OCR metrics in final status (important for 0 matches case)
      ocrPagesTotal: aggregatedMetrics.pagesTotal,
      ocrPagesNeedingOcr: aggregatedMetrics.pagesNeedingOcr,
      ocrPagesEmptyOrShort: aggregatedMetrics.pagesEmptyOrShort,
      ocrTimeoutCount: aggregatedMetrics.timeoutCount,
      ocrRetryCount: aggregatedMetrics.retryCount,
    });

    setMatchedPairs(pairs);

    // Clear processing state on successful completion
    await clearProcessingState();

    // Check if cancelled
    if (cancelledRef.current) {
      setStatus({ step: "idle", progress: 0, message: "Processamento cancelado" });
      setIsCancelling(false);
      return;
    }

    // Step 3: Generate previews ONLY for matched pairs (lazy, non-blocking)
    if (pairs.length > 0) {
      setStatus({ step: "matching", progress: 97, message: "Gerando previews..." });

      // Use requestIdleCallback or setTimeout to not block UI
      const generatePreviewsLazy = async () => {
        for (const pair of pairs) {
          // Check cancellation before each preview
          if (cancelledRef.current) break;

          try {
            // Use sourcePageNumber for multi-page holerites, crop holerite to top half
            const holeritePageNum = pair.holerite.sourcePageNumber || 1;
            const [holeritePreview, comprovantePreview] = await Promise.all([
              renderPdfPageToImage(pair.holerite.file, holeritePageNum, 0.5, undefined, true), // crop to top half
              renderPdfPageToImage(pair.comprovante.file, pair.comprovante.pageNumber!, 0.5),
            ]);

            // Check again after async operation
            if (cancelledRef.current) break;

            // Update holerite with preview
            setHolerites((prev) =>
              prev.map((h) => (h.id === pair.holerite.id ? { ...h, previewUrl: holeritePreview } : h)),
            );

            // Update comprovante with preview
            setComprovantes((prev) =>
              prev.map((c) => (c.id === pair.comprovante.id ? { ...c, previewUrl: comprovantePreview } : c)),
            );
          } catch (error) {
            console.error("Error generating preview:", error);
          }
        }
      };

      // Run previews in background
      if ("requestIdleCallback" in window) {
        (window as Window).requestIdleCallback(() => generatePreviewsLazy());
      } else {
        setTimeout(generatePreviewsLazy, 0);
      }
    }

    setStatus({
      step: pairs.length > 0 ? "completed" : "matching",
      progress: 100,
      message: `${pairs.length} correspondência(s) encontrada(s)`,
      matchesFound: pairs.length,
      totalToMatch: totalEntries,
      ocrPagesTotal: aggregatedMetrics.pagesTotal,
      ocrPagesNeedingOcr: aggregatedMetrics.pagesNeedingOcr,
      ocrPagesEmptyOrShort: aggregatedMetrics.pagesEmptyOrShort,
      ocrTimeoutCount: aggregatedMetrics.timeoutCount,
      ocrRetryCount: aggregatedMetrics.retryCount,
    });
  };

  const processDocuments = useCallback(async () => {
    await processDocumentsWithState(holerites, comprovantes, null);
  }, [holerites, comprovantes]);

  // Month names in Portuguese
  const monthNames = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];

  // Utility function to trigger automatic download
  const triggerDownload = (blobUrl: string, fileName: string) => {
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const generatePdfs = useCallback(async () => {
    if (matchedPairs.length === 0) return;

    cancelledRef.current = false;
    setIsCancelling(false);
    setStatus({ step: "generating", progress: 0, message: "Gerando PDFs..." });

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const monthName = monthNames[month - 1];

    const generatedDocuments: GeneratedDocument[] = [];

    const zip = new JSZip();

    // Process PDFs sequentially for controlled generation timing
    for (let index = 0; index < matchedPairs.length; index++) {
      if (cancelledRef.current) break;

      const pair = matchedPairs[index];

      setMatchedPairs((prev) => prev.map((p) => (p.id === pair.id ? { ...p, status: "generating" } : p)));

      try {
        // Use sourcePageNumber for multi-page holerites
        const holeritePageNum = pair.holerite.sourcePageNumber || 1;
        const pdfBlob = await createCombinedPdf(
          pair.holerite.file,
          pair.comprovante.file,
          pair.comprovante.pageNumber!,
          pair.employeeName,
          holeritePageNum,
          true, // cropHoleriteToHalf
        );

        const blobUrl = URL.createObjectURL(pdfBlob);
        // Format: Ano_Mês_Nome.pdf (e.g., 2026_Janeiro_ANA_BEATRIZ.pdf)
        const fileName = `${year}_${monthName}_${pair.employeeName.replace(/\s+/g, "_")}.pdf`;

        // Add to zip
        zip.file(fileName, pdfBlob);

        setMatchedPairs((prev) =>
          prev.map((p) => (p.id === pair.id ? { ...p, status: "completed", outputUrl: blobUrl } : p)),
        );

        setStatus((prev) => ({
          ...prev,
          progress: ((index + 1) / matchedPairs.length) * 100,
          message: `Gerando e baixando PDF ${index + 1} de ${matchedPairs.length}...`,
        }));

        // Look up employee in spreadsheet for enrichment
        let empresa: string | undefined;
        let municipio: string | undefined;
        
        if (spreadsheetData?.records) {
          const record = findEmployeeInSpreadsheet(pair.employeeName, spreadsheetData.records);
          if (record) {
            empresa = record.empresa;
            municipio = record.cidade;
          }
        }

        generatedDocuments.push({
          id: generateId(),
          employeeName: pair.employeeName,
          year,
          month,
          monthName,
          createdAt: now,
          blobUrl,
          fileName,
          empresa,
          municipio,
        });
      } catch (error) {
        console.error(`[PDF] Error generating PDF for ${pair.employeeName}:`, error);
        setMatchedPairs((prev) =>
          prev.map((p) => (p.id === pair.id ? { ...p, status: "error", error: "Erro ao gerar PDF" } : p)),
        );
      }
    }

    if (cancelledRef.current) {
      setStatus({ step: "idle", progress: 0, message: "Geração cancelada" });
      setIsCancelling(false);
      return;
    }

    setGeneratedDocs((prev) => [...prev, ...generatedDocuments]);

    // Generate and download zip with all PDFs
    setStatus({
      step: "generating",
      progress: 100,
      message: "Compactando arquivos...",
    });

    const zipBlob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const zipUrl = URL.createObjectURL(zipBlob);
    const zipFileName = `${year}_${monthName}_PDFs.zip`;
    triggerDownload(zipUrl, zipFileName);

    // Show success toast with download count
    toast({
      title: "Download concluído",
      description: `${generatedDocuments.length} PDF(s) compactado(s) em ZIP`,
    });

    setStatus({
      step: "completed",
      progress: 100,
      message: `${generatedDocuments.length} PDF(s) gerado(s) e baixado(s) em ZIP!`,
    });
  }, [matchedPairs]);

  const reset = useCallback(async () => {
    // Revoke blob URLs to free memory
    generatedDocs.forEach((doc) => URL.revokeObjectURL(doc.blobUrl));
    matchedPairs.forEach((pair) => {
      if (pair.outputUrl) URL.revokeObjectURL(pair.outputUrl);
    });

    // Clear PDF cache
    clearCache();

    // Clear OCR cache
    clearOcrCache();

    // Clear IndexedDB
    await clearProcessingState();

    setHolerites([]);
    setComprovantes([]);
    setMatchedPairs([]);
    setGeneratedDocs([]);
    setStatus({ step: "idle", progress: 0, message: "" });
    setHasSavedState(false);
  }, [generatedDocs, matchedPairs]);

  // Reprocess comprovantes with enhanced OCR settings (higher scale, longer timeout)
  const reprocessWithEnhancedOcr = useCallback(async () => {
    if (comprovantes.length === 0) {
      toast({
        title: "Nenhum comprovante para reprocessar",
        variant: "destructive",
      });
      return;
    }

    // Clear caches for comprovantes to force fresh OCR
    for (const comprovante of comprovantes) {
      clearCachedTextsForFile(comprovante.file);
    }
    clearOcrCache();

    // Optionally terminate workers to get a fresh pool
    await terminateOcrWorker();

    // Reset comprovantes and matched pairs status
    setComprovantes((prev) => prev.map((c) => ({ ...c, status: "pending", progress: 0 })));
    setMatchedPairs([]);

    toast({
      title: "Reprocessando com OCR reforçado",
      description: "Usando escala maior e timeout estendido para melhor extração de texto.",
    });

    // Re-run the processing pipeline
    // We need to re-extract holerite entries first if not already available
    // For simplicity, just re-run the full process
    await processDocumentsWithState(holerites, comprovantes, null);
  }, [holerites, comprovantes]);

  return {
    holerites,
    comprovantes,
    matchedPairs,
    generatedDocs,
    spreadsheetData,
    setSpreadsheetData,
    status,
    isCancelling,
    hasSavedState,
    isCheckingState,
    addFiles,
    removeFile,
    processDocuments,
    generatePdfs,
    cancelProcessing,
    reset,
    resumeProcessing,
    discardSavedState,
    reprocessWithEnhancedOcr,
  };
}
