import { useState, useCallback, useRef } from 'react';
import { UploadedFile, MatchedPair, ProcessingStatus, GeneratedDocument } from '@/types/document';
import {
  extractTextFromPdf,
  extractEmployeeName,
  findNameInPdfWithEarlyExit,
  renderPdfPageToImage,
  createCombinedPdf,
} from '@/lib/pdfUtils';
import { getCachedPdf, clearCache } from '@/lib/pdfCache';

const CONCURRENCY_LIMIT = 5;

// Process items in parallel with concurrency limit
async function processInBatches<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  concurrency: number = CONCURRENCY_LIMIT
): Promise<R[]> {
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((item, idx) => processor(item, i + idx))
    );
    
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
    setStatus({ step: 'extracting', progress: 0, message: 'Extraindo nomes dos holerites...' });

    // Step 1: Extract names from holerites in parallel (NO previews yet)
    const processHolerite = async (holerite: UploadedFile, index: number): Promise<UploadedFile> => {
      if (cancelledRef.current) {
        return { ...holerite, status: 'pending' as const, progress: 0 };
      }

      setHolerites((prev) =>
        prev.map((h) =>
          h.id === holerite.id ? { ...h, status: 'processing', progress: 50 } : h
        )
      );

      try {
        const cachedPdf = await getCachedPdf(holerite.file);
        const { text } = await extractTextFromPdf(holerite.file, cachedPdf);
        const extractedName = extractEmployeeName(text);

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

        setStatus((prev) => ({
          ...prev,
          progress: ((index + 1) / holerites.length) * 40,
          message: `Processando holerite ${index + 1} de ${holerites.length}...`,
        }));

        return updatedHolerite;
      } catch (error) {
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

    const processedHolerites = await processInBatches(holerites, processHolerite);

    // Check if cancelled
    if (cancelledRef.current) {
      setStatus({ step: 'idle', progress: 0, message: 'Processamento cancelado' });
      setIsCancelling(false);
      return;
    }

    // Step 2: Match names in comprovantes with early termination
    setStatus({ step: 'matching', progress: 40, message: 'Buscando correspondências...' });

    const validHolerites = processedHolerites.filter((h) => h.extractedName);
    const pairs: MatchedPair[] = [];
    const matchedHoleriteIds = new Set<string>();

    for (let cIdx = 0; cIdx < comprovantes.length; cIdx++) {
      if (cancelledRef.current) break;
      
      const comprovante = comprovantes[cIdx];
      
      setComprovantes((prev) =>
        prev.map((c) =>
          c.id === comprovante.id ? { ...c, status: 'processing', progress: 50 } : c
        )
      );

      try {
        const cachedPdf = await getCachedPdf(comprovante.file);

        for (const holerite of validHolerites) {
          if (!holerite.extractedName || matchedHoleriteIds.has(holerite.id)) continue;

          // Use optimized early-exit search
          const { found, pageNumber } = await findNameInPdfWithEarlyExit(
            comprovante.file,
            holerite.extractedName,
            cachedPdf
          );

          if (found) {
            matchedHoleriteIds.add(holerite.id);

            const updatedComprovante: UploadedFile = {
              ...comprovante,
              status: 'completed',
              progress: 100,
              pageNumber,
              extractedName: holerite.extractedName,
            };

            setComprovantes((prev) =>
              prev.map((c) => (c.id === comprovante.id ? updatedComprovante : c))
            );

            pairs.push({
              id: generateId(),
              employeeName: holerite.extractedName,
              holerite,
              comprovante: { ...updatedComprovante, pageNumber },
              status: 'pending',
            });
            break; // Found match, move to next comprovante
          }
        }
      } catch (error) {
        setComprovantes((prev) =>
          prev.map((c) =>
            c.id === comprovante.id
              ? { ...c, status: 'error', progress: 100, error: 'Erro ao processar' }
              : c
          )
        );
      }

      setStatus({
        step: 'matching',
        progress: 40 + ((cIdx + 1) / comprovantes.length) * 50,
        message: `Verificando comprovante ${cIdx + 1} de ${comprovantes.length}...`,
      });
    }

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
          try {
            const [holeritePreview, comprovantePreview] = await Promise.all([
              renderPdfPageToImage(pair.holerite.file, 1, 0.5),
              renderPdfPageToImage(pair.comprovante.file, pair.comprovante.pageNumber!, 0.5),
            ]);

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

    const results = await processInBatches(matchedPairs, generatePdf, 3);
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
