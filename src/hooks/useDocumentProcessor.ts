import { useState, useCallback } from 'react';
import { UploadedFile, MatchedPair, ProcessingStatus, GeneratedDocument } from '@/types/document';
import {
  extractTextFromPdf,
  extractEmployeeName,
  findNameInPage,
  renderPdfPageToImage,
  createCombinedPdf,
} from '@/lib/pdfUtils';

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

  const processDocuments = useCallback(async () => {
    if (holerites.length === 0 || comprovantes.length === 0) {
      return;
    }

    setStatus({ step: 'extracting', progress: 0, message: 'Extraindo nomes dos holerites...' });

    // Step 1: Extract names from holerites
    const processedHolerites: UploadedFile[] = [];
    
    for (let i = 0; i < holerites.length; i++) {
      const holerite = holerites[i];
      setHolerites((prev) =>
        prev.map((h) =>
          h.id === holerite.id ? { ...h, status: 'processing', progress: 50 } : h
        )
      );

      try {
        const { text } = await extractTextFromPdf(holerite.file);
        const extractedName = extractEmployeeName(text);
        const previewUrl = await renderPdfPageToImage(holerite.file, 1, 0.5);

        const updatedHolerite: UploadedFile = {
          ...holerite,
          status: extractedName ? 'completed' : 'error',
          progress: 100,
          extractedName: extractedName || undefined,
          previewUrl,
          error: extractedName ? undefined : 'Não foi possível extrair o nome',
        };

        processedHolerites.push(updatedHolerite);
        setHolerites((prev) =>
          prev.map((h) => (h.id === holerite.id ? updatedHolerite : h))
        );
      } catch (error) {
        const updatedHolerite: UploadedFile = {
          ...holerite,
          status: 'error',
          progress: 100,
          error: 'Erro ao processar o arquivo',
        };
        processedHolerites.push(updatedHolerite);
        setHolerites((prev) =>
          prev.map((h) => (h.id === holerite.id ? updatedHolerite : h))
        );
      }

      setStatus({
        step: 'extracting',
        progress: ((i + 1) / holerites.length) * 50,
        message: `Processando holerite ${i + 1} de ${holerites.length}...`,
      });
    }

    // Step 2: Search for names in comprovantes
    setStatus({ step: 'matching', progress: 50, message: 'Buscando correspondências...' });

    const validHolerites = processedHolerites.filter((h) => h.extractedName);
    const pairs: MatchedPair[] = [];

    for (const comprovante of comprovantes) {
      setComprovantes((prev) =>
        prev.map((c) =>
          c.id === comprovante.id ? { ...c, status: 'processing', progress: 50 } : c
        )
      );

      try {
        const { pageTexts } = await extractTextFromPdf(comprovante.file);

        for (const holerite of validHolerites) {
          if (!holerite.extractedName) continue;

          for (let pageIndex = 0; pageIndex < pageTexts.length; pageIndex++) {
            if (findNameInPage(pageTexts[pageIndex], holerite.extractedName)) {
              const previewUrl = await renderPdfPageToImage(comprovante.file, pageIndex + 1, 0.5);

              const updatedComprovante: UploadedFile = {
                ...comprovante,
                status: 'completed',
                progress: 100,
                pageNumber: pageIndex + 1,
                extractedName: holerite.extractedName,
                previewUrl,
              };

              setComprovantes((prev) =>
                prev.map((c) => (c.id === comprovante.id ? updatedComprovante : c))
              );

              pairs.push({
                id: generateId(),
                employeeName: holerite.extractedName,
                holerite,
                comprovante: { ...updatedComprovante, pageNumber: pageIndex + 1 },
                status: 'pending',
              });
              break;
            }
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
    }

    setMatchedPairs(pairs);
    setStatus({
      step: 'matching',
      progress: 100,
      message: `${pairs.length} correspondência(s) encontrada(s)`,
    });
  }, [holerites, comprovantes]);

  const generatePdfs = useCallback(async () => {
    if (matchedPairs.length === 0) return;

    setStatus({ step: 'generating', progress: 0, message: 'Gerando PDFs...' });

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const newDocs: GeneratedDocument[] = [];

    for (let i = 0; i < matchedPairs.length; i++) {
      const pair = matchedPairs[i];

      setMatchedPairs((prev) =>
        prev.map((p) => (p.id === pair.id ? { ...p, status: 'generating' } : p))
      );

      try {
        const pdfBlob = await createCombinedPdf(
          pair.holerite.file,
          pair.comprovante.file,
          pair.comprovante.pageNumber,
          pair.employeeName
        );

        const blobUrl = URL.createObjectURL(pdfBlob);
        const fileName = `${pair.employeeName.replace(/\s+/g, '_')}_${year}_${month.toString().padStart(2, '0')}.pdf`;

        const doc: GeneratedDocument = {
          id: generateId(),
          employeeName: pair.employeeName,
          year,
          month,
          createdAt: now,
          blobUrl,
          fileName,
        };

        newDocs.push(doc);

        setMatchedPairs((prev) =>
          prev.map((p) =>
            p.id === pair.id ? { ...p, status: 'completed', outputUrl: blobUrl } : p
          )
        );
      } catch (error) {
        setMatchedPairs((prev) =>
          prev.map((p) =>
            p.id === pair.id
              ? { ...p, status: 'error', error: 'Erro ao gerar PDF' }
              : p
          )
        );
      }

      setStatus({
        step: 'generating',
        progress: ((i + 1) / matchedPairs.length) * 100,
        message: `Gerando PDF ${i + 1} de ${matchedPairs.length}...`,
      });
    }

    setGeneratedDocs((prev) => [...prev, ...newDocs]);
    setStatus({
      step: 'completed',
      progress: 100,
      message: `${newDocs.length} PDF(s) gerado(s) com sucesso!`,
    });
  }, [matchedPairs]);

  const reset = useCallback(() => {
    // Revoke blob URLs to free memory
    generatedDocs.forEach((doc) => URL.revokeObjectURL(doc.blobUrl));
    matchedPairs.forEach((pair) => {
      if (pair.outputUrl) URL.revokeObjectURL(pair.outputUrl);
    });

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
    addFiles,
    removeFile,
    processDocuments,
    generatePdfs,
    reset,
  };
}
