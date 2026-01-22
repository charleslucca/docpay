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

const CONCURRENCY_LIMIT = 5;
const SLOW_OPERATION_THRESHOLD_MS = 10000; // 10 seconds
const PAGES_PER_BATCH = 20; // Process 20 pages at a time for OCR parallelization

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
  
  // Cancel mechanism
  const cancelledRef = useRef(false);
  const [isCancelling, setIsCancelling] = useState(false);
  
  // Time tracking refs
  const slowOperationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const currentItemStartTimeRef = useRef<number>(0);
  const processStartTimeRef = useRef<number>(0);

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

  const addFiles = useCallback((files: File[], type: 'holerite' | 'comprovante') => {
    const newFiles: UploadedFile[] = files.map((file) => ({
      id: generateId(),
      file,
      name: file.name,
      type,
      status: 'pending',
      progress: 0,
    }));

    if (type === 'holerite') {
      setHolerites((prev) => [...prev, ...newFiles]);
    } else {
      setComprovantes((prev) => [...prev, ...newFiles]);
    }
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

  const processDocuments = useCallback(async () => {
    if (holerites.length === 0 || comprovantes.length === 0) {
      return;
    }

    cancelledRef.current = false;
    setIsCancelling(false);
    processStartTimeRef.current = Date.now();
    
    const totalFiles = holerites.length + comprovantes.length;
    
    setStatus({ 
      step: 'extracting', 
      progress: 0, 
      message: 'Extraindo nomes dos holerites...',
      startTime: Date.now(),
      totalItems: totalFiles,
      processedItems: 0,
      currentItem: holerites[0]?.name,
    });

    // Step 1: Extract names from holerites - process ALL PAGES of each PDF
    interface HoleriteEntry {
      originalHolerite: UploadedFile;
      name: string;
      pageNumber: number;
    }
    const allHoleriteEntries: HoleriteEntry[] = [];

    const processHolerite = async (holerite: UploadedFile, index: number): Promise<HoleriteEntry[]> => {
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

        console.log(`[OCR] Processing ${holerite.name}: ${totalPages} page(s) with ${workerCount} parallel workers`);

        setHolerites((prev) =>
          prev.map((h) =>
            h.id === holerite.id ? { ...h, status: 'processing', progress: 10 } : h
          )
        );

        // Process pages in batches of PAGES_PER_BATCH
        for (let batchStart = 1; batchStart <= totalPages; batchStart += PAGES_PER_BATCH) {
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

          // Render all pages in this batch in parallel
          console.log(`[OCR] Rendering pages ${batchStart}-${batchEnd}...`);
          const canvases = await Promise.all(
            pageNumbers.map(pageNum => renderPageForOCR(holerite.file, pageNum, 2.5))
          );

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
        updateTimeEstimate(index + 1, holerites.length + comprovantes.length);

        setStatus((prev) => ({
          ...prev,
          progress: ((index + 1) / holerites.length) * 40,
          message: `Processando holerite ${index + 1} de ${holerites.length} (${foundCount} nome(s))...`,
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

    // Process holerites and collect all entries
    const holeriteResults = await processInBatches(holerites, processHolerite, 1, cancelledRef); // Process 1 at a time for accurate progress
    for (const entries of holeriteResults) {
      allHoleriteEntries.push(...entries);
    }

    console.log(`[OCR] Total employees found: ${allHoleriteEntries.length}`);

    if (allHoleriteEntries.length > 0) {
      toast({
        title: `${allHoleriteEntries.length} funcionário(s) encontrado(s)`,
        description: `Nomes extraídos de ${holerites.length} arquivo(s) de holerite`,
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
      const processedSoFar = holerites.length + index + 1;
      updateTimeEstimate(processedSoFar, holerites.length + comprovantes.length);

      setStatus((prev) => ({
        ...prev,
        progress: 40 + ((index + 1) / comprovantes.length) * 20,
        message: `Extraindo texto do comprovante ${index + 1} de ${comprovantes.length}...`,
        processedItems: processedSoFar,
        isOcrActive: false,
      }));
    };

    // Process comprovantes one at a time (OCR is memory-intensive)
    await processInBatches(comprovantes, preExtractComprovante, 1, cancelledRef);

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
    matchingLoop: for (const comprovante of comprovantes) {
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
        (window as any).requestIdleCallback(() => generatePreviewsLazy());
      } else {
        setTimeout(generatePreviewsLazy, 0);
      }
    }

    setStatus({
      step: 'matching',
      progress: 100,
      message: `${pairs.length} correspondência(s) encontrada(s)`,
    });
  }, [holerites, comprovantes]);

  // Month names in Portuguese
  const monthNames = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];

  const generatePdfs = useCallback(async () => {
    if (matchedPairs.length === 0) return;

    cancelledRef.current = false;
    setIsCancelling(false);
    setStatus({ step: 'generating', progress: 0, message: 'Gerando PDFs...' });

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const monthName = monthNames[month - 1];

    // Process PDF generation in parallel batches
    const generatePdf = async (pair: MatchedPair, index: number): Promise<GeneratedDocument | null> => {
      if (cancelledRef.current) return null;
      
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

        setMatchedPairs((prev) =>
          prev.map((p) =>
            p.id === pair.id ? { ...p, status: 'completed', outputUrl: blobUrl } : p
          )
        );

        setStatus((prev) => ({
          ...prev,
          progress: ((index + 1) / matchedPairs.length) * 100,
          message: `Gerando PDF ${index + 1} de ${matchedPairs.length}...`,
        }));

        return {
          id: generateId(),
          employeeName: pair.employeeName,
          year,
          month,
          monthName,
          createdAt: now,
          blobUrl,
          fileName,
        };
      } catch (error) {
        setMatchedPairs((prev) =>
          prev.map((p) =>
            p.id === pair.id
              ? { ...p, status: 'error', error: 'Erro ao gerar PDF' }
              : p
          )
        );
        return null;
      }
    };

    const results = await processInBatches(matchedPairs, generatePdf, 3, cancelledRef);
    const validDocs = results.filter((doc): doc is GeneratedDocument => doc !== null);

    if (cancelledRef.current) {
      setStatus({ step: 'idle', progress: 0, message: 'Geração cancelada' });
      setIsCancelling(false);
      return;
    }

    setGeneratedDocs((prev) => [...prev, ...validDocs]);
    setStatus({
      step: 'completed',
      progress: 100,
      message: `${validDocs.length} PDF(s) gerado(s) com sucesso!`,
    });
  }, [matchedPairs]);

  const reset = useCallback(() => {
    // Revoke blob URLs to free memory
    generatedDocs.forEach((doc) => URL.revokeObjectURL(doc.blobUrl));
    matchedPairs.forEach((pair) => {
      if (pair.outputUrl) URL.revokeObjectURL(pair.outputUrl);
    });

    // Clear PDF cache
    clearCache();

    setHolerites([]);
    setComprovantes([]);
    setMatchedPairs([]);
    setGeneratedDocs([]);
    setStatus({ step: 'idle', progress: 0, message: '' });
  }, [generatedDocs, matchedPairs]);

  return {
    holerites,
    comprovantes,
    matchedPairs,
    generatedDocs,
    status,
    isCancelling,
    addFiles,
    removeFile,
    processDocuments,
    generatePdfs,
    cancelProcessing,
    reset,
  };
}
