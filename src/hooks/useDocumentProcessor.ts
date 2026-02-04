import { useState, useCallback, useRef, useEffect } from 'react';
import { UploadedFile, MatchedPair, ProcessingStatus, GeneratedDocument } from '@/types/document';
import {
  extractEmployeeName,
  findNameInPage,
  renderPdfPageToImage,
  createCombinedPdf,
} from '@/lib/pdfUtils';
import { getCachedPdf, getCachedPageTextsWithOCR, renderPageForOCR, clearCache } from '@/lib/pdfCache';
import { extractTextWithOCR, extractTextBatch, terminateOcrWorker, getWorkerCount } from '@/lib/ocrUtils';
import { toast } from '@/hooks/use-toast';
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
} from '@/lib/processingPersistence';

const CONCURRENCY_LIMIT = 5;
const SLOW_OPERATION_THRESHOLD_MS = 10000; // 10 seconds

// Optimized: Align batch size with worker count for balanced CPU usage
const getOptimalBatchSize = () => Math.max(4, Math.min(6, getWorkerCount()));

// Pause between batches to prevent UI freezing and reduce CPU spikes
const pauseBetweenBatches = (): Promise<void> => new Promise(resolve => {
  if ('requestIdleCallback' in window) {
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
  cancelledRef?: React.MutableRefObject<boolean>
): Promise<R[]> {
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i += concurrency) {
    // Check cancellation before each batch
    if (cancelledRef?.current) break;
    
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((item, idx) => processor(item, i + idx))
    );
    
    // Check cancellation after batch completes
    if (cancelledRef?.current) break;
    
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
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
  const [status, setStatus] = useState<ProcessingStatus>({
    step: 'idle',
    progress: 0,
    message: '',
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

  // Check for saved state on mount
  useEffect(() => {
    const checkSavedState = async () => {
      try {
        // Clean up old data first
        await cleanupOldData();
        const hasState = await hasSavedProcessingState();
        setHasSavedState(hasState);
      } catch (error) {
        console.error('[Persistence] Error checking saved state:', error);
      } finally {
        setIsCheckingState(false);
      }
    };
    
    checkSavedState();
  }, []);

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
        
        setStatus(prev => ({
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
    
    setStatus(prev => ({
      ...prev,
      processedItems,
      totalItems,
      estimatedTimeRemaining: estimatedRemaining,
      isSlowOperation: false, // Reset slow flag when item completes
    }));
  };

  const generateId = () => Math.random().toString(36).substring(2, 9);

  const addFiles = useCallback(async (files: File[], type: 'holerite' | 'comprovante') => {
    const newFiles: UploadedFile[] = files.map((file) => ({
      id: generateId(),
      file,
      name: file.name,
      type,
      status: 'pending',
      progress: 0,
      pageCount: undefined,
      estimatedEmployees: undefined,
    }));

    // Add files immediately for responsive UX
    if (type === 'holerite') {
      setHolerites((prev) => [...prev, ...newFiles]);
    } else {
      setComprovantes((prev) => [...prev, ...newFiles]);
    }

    // Count pages in background (parallel)
    const countPagePromises = newFiles.map(async (uploadedFile) => {
      try {
        const pdf = await getCachedPdf(uploadedFile.file);
        const pageCount = pdf.numPages;
        
        // Update with page count
        const setter = type === 'holerite' ? setHolerites : setComprovantes;
        setter((prev) => prev.map((f) => 
          f.id === uploadedFile.id 
            ? { ...f, pageCount, estimatedEmployees: pageCount }
            : f
        ));
      } catch (error) {
        console.warn(`[PageCount] Error counting pages for ${uploadedFile.name}:`, error);
      }
    });

    // Run all page counts in parallel
    await Promise.all(countPagePromises);
  }, []);

  const removeFile = useCallback((id: string, type: 'holerite' | 'comprovante') => {
    if (type === 'holerite') {
      setHolerites((prev) => prev.filter((f) => f.id !== id));
    } else {
      setComprovantes((prev) => prev.filter((f) => f.id !== id));
    }
  }, []);

  const cancelProcessing = useCallback(() => {
    cancelledRef.current = true;
    setIsCancelling(true);
    setStatus((prev) => ({ ...prev, message: 'Cancelando...' }));
  }, []);

  // Save files to IndexedDB when processing starts
  const persistFiles = async (holeriteFiles: UploadedFile[], comprovanteFiles: UploadedFile[]) => {
    try {
      // Save all files in parallel
      await Promise.all([
        ...holeriteFiles.map(h => saveFileBlob(h.id, h.file, 'holerite')),
        ...comprovanteFiles.map(c => saveFileBlob(c.id, c.file, 'comprovante')),
      ]);
      console.log('[Persistence] Files saved to IndexedDB');
    } catch (error) {
      console.error('[Persistence] Error saving files:', error);
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
        const reconstructedFile = new File([file.blob], file.name, { type: 'application/pdf' });
        const uploadedFile: UploadedFile = {
          id: file.id,
          file: reconstructedFile,
          name: file.name,
          type: file.type,
          status: 'pending',
          progress: 0,
        };
        
        if (file.type === 'holerite') {
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
      console.error('[Resume] Error resuming processing:', error);
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
    savedState?: ProcessingState | null
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
        const holerite = holeriteList.find(h => h.id === entry.holeriteId);
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
      step: 'extracting', 
      progress: 0, 
      message: savedState ? 'Retomando extração de nomes...' : 'Extraindo nomes dos holerites...',
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

    const processHolerite = async (
      holerite: UploadedFile, 
      index: number,
      resumeFromPage: number = 1
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

        console.log(`[OCR] Processing ${holerite.name}: ${totalPages} page(s) with ${workerCount} parallel workers, starting from page ${resumeFromPage}`);

        setHolerites((prev) =>
          prev.map((h) =>
            h.id === holerite.id ? { ...h, status: 'processing', progress: 10 } : h
          )
        );

        // Process pages in batches (optimized size aligned with worker count)
        for (let batchStart = resumeFromPage; batchStart <= totalPages; batchStart += PAGES_PER_BATCH) {
          if (cancelledRef.current) break;

          const batchEnd = Math.min(batchStart + PAGES_PER_BATCH - 1, totalPages);
          const pageNumbers = Array.from(
            { length: batchEnd - batchStart + 1 },
            (_, i) => batchStart + i
          );

          setStatus(prev => ({
            ...prev,
            currentItem: holerite.name,
            currentItemStartTime: Date.now(),
            message: `OCR em ${holerite.name} (pág. ${batchStart}-${batchEnd} de ${totalPages})...`,
            isOcrActive: true,
            ocrProgress: Math.round(((batchStart - 1) / totalPages) * 100),
          }));

          // OPTIMIZED: Render pages SEQUENTIALLY to reduce CPU spikes
          console.log(`[OCR] Rendering pages ${batchStart}-${batchEnd} sequentially...`);
          const canvases: HTMLCanvasElement[] = [];
          for (const pageNum of pageNumbers) {
            if (cancelledRef.current) break;
            const canvas = await renderPageForOCR(holerite.file, pageNum, 2.5);
            canvases.push(canvas);
          }

          if (cancelledRef.current) break;

          // Process OCR in parallel with the scheduler
          const texts = await extractTextBatch(canvases, (done, total) => {
            const overallProgress = ((batchStart - 1 + done) / totalPages) * 100;
            setStatus(prev => ({
              ...prev,
              ocrProgress: Math.round(overallProgress),
            }));
          });

          // Extract names from texts
          for (let i = 0; i < texts.length; i++) {
            const pageNum = pageNumbers[i];
            const extractedName = extractEmployeeName(texts[i]);

            if (extractedName) {
              console.log(`[OCR] Page ${pageNum}: Found "${extractedName}"`);
              entries.push({
                originalHolerite: holerite,
                name: extractedName,
                pageNumber: pageNum,
              });
            }
          }

          // Update progress per batch
          const batchProgress = 10 + ((batchEnd / totalPages) * 80);
          setHolerites((prev) =>
            prev.map((h) =>
              h.id === holerite.id ? { ...h, progress: batchProgress } : h
            )
          );

          // Clear canvas references to free memory
          canvases.length = 0;

          // Save state after each batch for persistence
          const allExtracted: ExtractedEntry[] = [
            ...existingEntries.map(e => ({
              holeriteId: e.originalHolerite.id,
              name: e.name,
              pageNumber: e.pageNumber,
            })),
            ...allHoleriteEntries.map(e => ({
              holeriteId: e.originalHolerite.id,
              name: e.name,
              pageNumber: e.pageNumber,
            })),
            ...entries.map(e => ({
              holeriteId: e.originalHolerite.id,
              name: e.name,
              pageNumber: e.pageNumber,
            })),
          ];

          await saveProcessingState({
            startedAt: savedState?.startedAt || new Date(),
            status: 'extracting',
            holeritesIds: holeriteList.map(h => h.id),
            comprovantesIds: comprovanteList.map(c => c.id),
            currentHoleriteIndex: index,
            currentPageNumber: batchEnd + 1,
            totalPages,
            extractedEntries: allExtracted,
            matchedPairs: [],
          });

          // OPTIMIZED: Add pause between batches to prevent UI freezing
          await pauseBetweenBatches();
        }

        clearSlowOperationTimer();

        // Mark holerite as completed
        const foundCount = entries.length;
        setHolerites((prev) =>
          prev.map((h) =>
            h.id === holerite.id
              ? {
                  ...h,
                  status: foundCount > 0 ? 'completed' : 'error',
                  progress: 100,
                  extractedName: foundCount > 0 ? `${foundCount} funcionário(s)` : undefined,
                  error: foundCount === 0 ? 'Nenhum nome encontrado no arquivo' : undefined,
                }
              : h
          )
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
            h.id === holerite.id
              ? { ...h, status: 'error', progress: 100, error: 'Erro ao executar OCR' }
              : h
          )
        );
        setStatus(prev => ({ ...prev, isOcrActive: false, ocrProgress: undefined }));
        return [];
      }
    };

    // Process holerites from starting index
    for (let i = startHoleriteIndex; i < holeriteList.length; i++) {
      if (cancelledRef.current) break;
      
      const resumeFromPage = (i === startHoleriteIndex && savedState) ? startPageNumber : 1;
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
      setStatus({ step: 'idle', progress: 0, message: 'Processamento cancelado' });
      setIsCancelling(false);
      return;
    }

    // Step 2: PRE-EXTRACT all comprovante texts in PARALLEL (like Python script)
    setStatus({ step: 'matching', progress: 40, message: 'Pré-extraindo textos dos comprovantes...' });

    // Create a map: comprovante.id -> { file, pageTexts: string[] }
    const comprovanteTextsMap = new Map<string, { file: File; pageTexts: string[] }>();

    const preExtractComprovante = async (comprovante: UploadedFile, index: number) => {
      if (cancelledRef.current) {
        clearSlowOperationTimer();
        return;
      }
      
      // Start slow operation timer for this file
      startSlowOperationTimer(comprovante.name);
      
      setStatus(prev => ({
        ...prev,
        currentItem: comprovante.name,
        currentItemStartTime: Date.now(),
      }));
      
      setComprovantes((prev) =>
        prev.map((c) =>
          c.id === comprovante.id ? { ...c, status: 'processing', progress: 30 } : c
        )
      );

      try {
        // Use OCR-enabled page text extraction for scanned PDFs
        const pageTexts = await getCachedPageTextsWithOCR(
          comprovante.file,
          async (canvas) => {
            // OCR extractor callback
            return await extractTextWithOCR(canvas);
          },
          (pageNum, totalPages, isOcr) => {
            // Progress callback
            setStatus(prev => ({
              ...prev,
              message: `${comprovante.name} - pág. ${pageNum}/${totalPages}${isOcr ? ' (OCR)' : ''}...`,
              isOcrActive: isOcr,
            }));
          },
          () => cancelledRef.current
        );
        
        // Clear timer when done
        clearSlowOperationTimer();
        
        // Don't store if cancelled
        if (cancelledRef.current) return;
        
        comprovanteTextsMap.set(comprovante.id, { file: comprovante.file, pageTexts });
        
        setComprovantes((prev) =>
          prev.map((c) =>
            c.id === comprovante.id ? { ...c, progress: 60 } : c
          )
        );
      } catch (error) {
        clearSlowOperationTimer();
        console.error(`[Comprovante] Error processing ${comprovante.name}:`, error);
        setComprovantes((prev) =>
          prev.map((c) =>
            c.id === comprovante.id
              ? { ...c, status: 'error', progress: 100, error: 'Erro ao extrair texto' }
              : c
          )
        );
      }

      // Update time estimate
      const processedSoFar = holeriteList.length + index + 1;
      updateTimeEstimate(processedSoFar, holeriteList.length + comprovanteList.length);

      setStatus((prev) => ({
        ...prev,
        progress: 40 + ((index + 1) / comprovanteList.length) * 20,
        message: `Extraindo texto do comprovante ${index + 1} de ${comprovanteList.length}...`,
        processedItems: processedSoFar,
        isOcrActive: false,
      }));

      // Pause between comprovantes to reduce CPU load
      await pauseBetweenBatches();
    };

    // Process comprovantes one at a time (OCR is memory-intensive)
    await processInBatches(comprovanteList, preExtractComprovante, 1, cancelledRef);

    // Check if cancelled
    if (cancelledRef.current) {
      setStatus({ step: 'idle', progress: 0, message: 'Processamento cancelado' });
      setIsCancelling(false);
      return;
    }

    // Step 3: MEMORY-ONLY matching (no I/O, just string comparisons)
    setStatus({ step: 'matching', progress: 60, message: 'Buscando correspondências em memória...' });

    const pairs: MatchedPair[] = [];
    const matchedEntryKeys = new Set<string>(); // Track matched entries by "holeriteId_pageNumber"

    // Pure CPU matching - no file access!
    matchingLoop: for (const comprovante of comprovanteList) {
      // Check cancellation at start of each comprovante
      if (cancelledRef.current) break matchingLoop;
      
      const extracted = comprovanteTextsMap.get(comprovante.id);
      if (!extracted) continue;

      const { pageTexts } = extracted;

      for (const entry of allHoleriteEntries) {
        // Check cancellation in inner loop too
        if (cancelledRef.current) break matchingLoop;
        
        const entryKey = `${entry.originalHolerite.id}_${entry.pageNumber}`;
        if (matchedEntryKeys.has(entryKey)) continue;

        // Search in pre-extracted texts (instantaneous!)
        let foundPage = -1;
        for (let pageIdx = 0; pageIdx < pageTexts.length; pageIdx++) {
          if (findNameInPage(pageTexts[pageIdx], entry.name)) {
            foundPage = pageIdx + 1; // 1-indexed
            break;
          }
        }

        if (foundPage > 0) {
          matchedEntryKeys.add(entryKey);

          const updatedComprovante: UploadedFile = {
            ...comprovante,
            status: 'completed',
            progress: 100,
            pageNumber: foundPage,
            extractedName: entry.name,
          };

          setComprovantes((prev) =>
            prev.map((c) => (c.id === comprovante.id ? updatedComprovante : c))
          );

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
            status: 'pending',
          });
          // Don't break - continue looking for more matches in this comprovante
        }
      }
    }

    setStatus({
      step: 'matching',
      progress: 90,
      message: `${pairs.length} correspondência(s) encontrada(s)`,
    });

    setMatchedPairs(pairs);

    // Clear processing state on successful completion
    await clearProcessingState();

    // Check if cancelled
    if (cancelledRef.current) {
      setStatus({ step: 'idle', progress: 0, message: 'Processamento cancelado' });
      setIsCancelling(false);
      return;
    }

    // Step 3: Generate previews ONLY for matched pairs (lazy, non-blocking)
    if (pairs.length > 0) {
      setStatus({ step: 'matching', progress: 90, message: 'Gerando previews...' });
      
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
              prev.map((h) =>
                h.id === pair.holerite.id ? { ...h, previewUrl: holeritePreview } : h
              )
            );

            // Update comprovante with preview
            setComprovantes((prev) =>
              prev.map((c) =>
                c.id === pair.comprovante.id ? { ...c, previewUrl: comprovantePreview } : c
              )
            );
          } catch (error) {
            console.error('Error generating preview:', error);
          }
        }
      };

      // Run previews in background
      if ('requestIdleCallback' in window) {
        (window as Window).requestIdleCallback(() => generatePreviewsLazy());
      } else {
        setTimeout(generatePreviewsLazy, 0);
      }
    }

    setStatus({
      step: 'matching',
      progress: 100,
      message: `${pairs.length} correspondência(s) encontrada(s)`,
    });
  };

  const processDocuments = useCallback(async () => {
    await processDocumentsWithState(holerites, comprovantes, null);
  }, [holerites, comprovantes]);

  // Month names in Portuguese
  const monthNames = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];

  // Utility function to trigger automatic download
  const triggerDownload = (blobUrl: string, fileName: string) => {
    const link = document.createElement('a');
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
    setStatus({ step: 'generating', progress: 0, message: 'Gerando PDFs...' });

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const monthName = monthNames[month - 1];

    const generatedDocuments: GeneratedDocument[] = [];

    // Process PDFs sequentially for controlled download timing
    for (let index = 0; index < matchedPairs.length; index++) {
      if (cancelledRef.current) break;

      const pair = matchedPairs[index];
      
      setMatchedPairs((prev) =>
        prev.map((p) => (p.id === pair.id ? { ...p, status: 'generating' } : p))
      );

      try {
        // Use sourcePageNumber for multi-page holerites
        const holeritePageNum = pair.holerite.sourcePageNumber || 1;
        const pdfBlob = await createCombinedPdf(
          pair.holerite.file,
          pair.comprovante.file,
          pair.comprovante.pageNumber!,
          pair.employeeName,
          holeritePageNum,
          true // cropHoleriteToHalf
        );

        const blobUrl = URL.createObjectURL(pdfBlob);
        // Format: Ano_Mês_Nome.pdf (e.g., 2026_Janeiro_ANA_BEATRIZ.pdf)
        const fileName = `${year}_${monthName}_${pair.employeeName.replace(/\s+/g, '_')}.pdf`;

        // Trigger automatic download
        triggerDownload(blobUrl, fileName);

        // Wait 300ms between downloads to avoid browser blocking
        await new Promise(resolve => setTimeout(resolve, 300));

        setMatchedPairs((prev) =>
          prev.map((p) =>
            p.id === pair.id ? { ...p, status: 'completed', outputUrl: blobUrl } : p
          )
        );

        setStatus((prev) => ({
          ...prev,
          progress: ((index + 1) / matchedPairs.length) * 100,
          message: `Gerando e baixando PDF ${index + 1} de ${matchedPairs.length}...`,
        }));

        generatedDocuments.push({
          id: generateId(),
          employeeName: pair.employeeName,
          year,
          month,
          monthName,
          createdAt: now,
          blobUrl,
          fileName,
        });
      } catch (error) {
        console.error(`[PDF] Error generating PDF for ${pair.employeeName}:`, error);
        setMatchedPairs((prev) =>
          prev.map((p) =>
            p.id === pair.id
              ? { ...p, status: 'error', error: 'Erro ao gerar PDF' }
              : p
          )
        );
      }
    }

    if (cancelledRef.current) {
      setStatus({ step: 'idle', progress: 0, message: 'Geração cancelada' });
      setIsCancelling(false);
      return;
    }

    setGeneratedDocs((prev) => [...prev, ...generatedDocuments]);
    
    // Show success toast with download count
    toast({
      title: "Downloads concluídos",
      description: `${generatedDocuments.length} arquivo(s) baixado(s) para sua pasta de Downloads`,
    });

    setStatus({
      step: 'completed',
      progress: 100,
      message: `${generatedDocuments.length} PDF(s) gerado(s) e baixado(s)!`,
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
    
    // Clear IndexedDB
    await clearProcessingState();

    setHolerites([]);
    setComprovantes([]);
    setMatchedPairs([]);
    setGeneratedDocs([]);
    setStatus({ step: 'idle', progress: 0, message: '' });
    setHasSavedState(false);
  }, [generatedDocs, matchedPairs]);

  return {
    holerites,
    comprovantes,
    matchedPairs,
    generatedDocs,
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
  };
}
