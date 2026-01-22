import { useState, useCallback, useRef, useEffect } from 'react';
import { UploadedFile, MatchedPair, ProcessingStatus, GeneratedDocument } from '@/types/document';
import {
  extractEmployeeName,
  findNameInPage,
  renderPdfPageToImage,
  createCombinedPdf,
} from '@/lib/pdfUtils';
import { getCachedPdf, getCachedPageTexts, extractFirstPageText, clearCache } from '@/lib/pdfCache';
import { toast } from '@/hooks/use-toast';

const CONCURRENCY_LIMIT = 5;
const SLOW_OPERATION_THRESHOLD_MS = 10000; // 10 seconds

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

    // Step 1: Extract names from holerites in parallel (NO previews yet)
    const processHolerite = async (holerite: UploadedFile, index: number): Promise<UploadedFile> => {
      if (cancelledRef.current) {
        clearSlowOperationTimer();
        return { ...holerite, status: 'pending' as const, progress: 0 };
      }

      // Start slow operation timer for this file
      startSlowOperationTimer(holerite.name);

      setStatus(prev => ({
        ...prev,
        currentItem: holerite.name,
        currentItemStartTime: Date.now(),
      }));

      setHolerites((prev) =>
        prev.map((h) =>
          h.id === holerite.id ? { ...h, status: 'processing', progress: 50 } : h
        )
      );

      try {
        // Extract only first page text - MUCH faster (employee name is always on page 1)
        const text = await extractFirstPageText(holerite.file);
        const extractedName = extractEmployeeName(text);

        // Clear timer when done
        clearSlowOperationTimer();

        const updatedHolerite: UploadedFile = {
          ...holerite,
          status: extractedName ? 'completed' : 'error',
          progress: 100,
          extractedName: extractedName || undefined,
          error: extractedName ? undefined : 'Não foi possível extrair o nome',
        };

        setHolerites((prev) =>
          prev.map((h) => (h.id === holerite.id ? updatedHolerite : h))
        );

        // Update time estimate
        updateTimeEstimate(index + 1, holerites.length + comprovantes.length);

        setStatus((prev) => ({
          ...prev,
          progress: ((index + 1) / holerites.length) * 40,
          message: `Processando holerite ${index + 1} de ${holerites.length}...`,
          processedItems: index + 1,
        }));

        return updatedHolerite;
      } catch (error) {
        clearSlowOperationTimer();
        const updatedHolerite: UploadedFile = {
          ...holerite,
          status: 'error',
          progress: 100,
          error: 'Erro ao processar o arquivo',
        };
        setHolerites((prev) =>
          prev.map((h) => (h.id === holerite.id ? updatedHolerite : h))
        );
        return updatedHolerite;
      }
    };

    const processedHolerites = await processInBatches(holerites, processHolerite, CONCURRENCY_LIMIT, cancelledRef);

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
        // Use cached page texts extraction with cancellation support
        const pageTexts = await getCachedPageTexts(
          comprovante.file,
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
      }));
    };

    // Process comprovantes in parallel batches
    await processInBatches(comprovantes, preExtractComprovante, CONCURRENCY_LIMIT, cancelledRef);

    // Check if cancelled
    if (cancelledRef.current) {
      setStatus({ step: 'idle', progress: 0, message: 'Processamento cancelado' });
      setIsCancelling(false);
      return;
    }

    // Step 3: MEMORY-ONLY matching (no I/O, just string comparisons)
    setStatus({ step: 'matching', progress: 60, message: 'Buscando correspondências em memória...' });

    const validHolerites = processedHolerites.filter((h) => h.extractedName);
    const pairs: MatchedPair[] = [];
    const matchedHoleriteIds = new Set<string>();

    // Pure CPU matching - no file access!
    matchingLoop: for (const comprovante of comprovantes) {
      // Check cancellation at start of each comprovante
      if (cancelledRef.current) break matchingLoop;
      
      const extracted = comprovanteTextsMap.get(comprovante.id);
      if (!extracted) continue;

      const { pageTexts } = extracted;

      for (const holerite of validHolerites) {
        // Check cancellation in inner loop too
        if (cancelledRef.current) break matchingLoop;
        
        if (!holerite.extractedName || matchedHoleriteIds.has(holerite.id)) continue;

        // Search in pre-extracted texts (instantaneous!)
        let foundPage = -1;
        for (let pageIdx = 0; pageIdx < pageTexts.length; pageIdx++) {
          if (findNameInPage(pageTexts[pageIdx], holerite.extractedName)) {
            foundPage = pageIdx + 1; // 1-indexed
            break;
          }
        }

        if (foundPage > 0) {
          matchedHoleriteIds.add(holerite.id);

          const updatedComprovante: UploadedFile = {
            ...comprovante,
            status: 'completed',
            progress: 100,
            pageNumber: foundPage,
            extractedName: holerite.extractedName,
          };

          setComprovantes((prev) =>
            prev.map((c) => (c.id === comprovante.id ? updatedComprovante : c))
          );

          pairs.push({
            id: generateId(),
            employeeName: holerite.extractedName,
            holerite,
            comprovante: { ...updatedComprovante, pageNumber: foundPage },
            status: 'pending',
          });
          break; // Found match, move to next comprovante
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
            const [holeritePreview, comprovantePreview] = await Promise.all([
              renderPdfPageToImage(pair.holerite.file, 1, 0.5),
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

  const generatePdfs = useCallback(async () => {
    if (matchedPairs.length === 0) return;

    cancelledRef.current = false;
    setIsCancelling(false);
    setStatus({ step: 'generating', progress: 0, message: 'Gerando PDFs...' });

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const newDocs: GeneratedDocument[] = [];

    // Process PDF generation in parallel batches
    const generatePdf = async (pair: MatchedPair, index: number): Promise<GeneratedDocument | null> => {
      if (cancelledRef.current) return null;
      
      setMatchedPairs((prev) =>
        prev.map((p) => (p.id === pair.id ? { ...p, status: 'generating' } : p))
      );

      try {
        const pdfBlob = await createCombinedPdf(
          pair.holerite.file,
          pair.comprovante.file,
          pair.comprovante.pageNumber!,
          pair.employeeName
        );

        const blobUrl = URL.createObjectURL(pdfBlob);
        const fileName = `${pair.employeeName.replace(/\s+/g, '_')}_${year}_${month.toString().padStart(2, '0')}.pdf`;

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
