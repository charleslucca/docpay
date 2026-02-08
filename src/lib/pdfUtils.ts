import { PDFDocument, rgb } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { getCachedPdf, getCachedBuffer, renderPageForOCR, OCR_SCALE_FAST } from "./pdfCache";
import { extractTextWithOCR, initOcrScheduler } from "./ocrUtils";

export async function extractTextFromPdf(
  file: File,
  cachedPdf?: PDFDocumentProxy,
): Promise<{ text: string; pageTexts: string[] }> {
  const pdf = cachedPdf || (await getCachedPdf(file));

  const pageTexts: string[] = [];
  let fullText = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item: any) => item.str).join(" ");
    pageTexts.push(pageText);
    fullText += pageText + "\n";
  }

  return { text: fullText, pageTexts };
}

// Optimized: Extract text from a single page only
export async function extractTextFromPage(
  file: File,
  pageNumber: number,
  cachedPdf?: PDFDocumentProxy,
): Promise<string> {
  const pdf = cachedPdf || (await getCachedPdf(file));
  const page = await pdf.getPage(pageNumber);
  const textContent = await page.getTextContent();
  return textContent.items.map((item: any) => item.str).join(" ");
}

// Optimized: Search for name page by page with early termination
export async function findNameInPdfWithEarlyExit(
  file: File,
  targetName: string,
  cachedPdf?: PDFDocumentProxy,
): Promise<{ found: boolean; pageNumber: number }> {
  const pdf = cachedPdf || (await getCachedPdf(file));

  for (let i = 1; i <= pdf.numPages; i++) {
    const pageText = await extractTextFromPage(file, i, pdf);
    if (findNameInPage(pageText, targetName)) {
      return { found: true, pageNumber: i };
    }
  }

  return { found: false, pageNumber: -1 };
}

export async function renderPdfPageToImage(
  file: File,
  pageNumber: number,
  scale: number = 1.5,
  cachedPdf?: PDFDocumentProxy,
  cropToTopHalf: boolean = false,
): Promise<string> {
  const pdf = cachedPdf || (await getCachedPdf(file));
  const page = await pdf.getPage(pageNumber);

  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;

  canvas.height = viewport.height;
  canvas.width = viewport.width;

  await page.render({
    canvasContext: context,
    viewport: viewport,
  }).promise;

  // If cropping to top half, create a new canvas with only the top portion
  if (cropToTopHalf) {
    const croppedCanvas = document.createElement("canvas");
    const croppedContext = croppedCanvas.getContext("2d")!;
    const halfHeight = Math.floor(canvas.height / 2);

    croppedCanvas.width = canvas.width;
    croppedCanvas.height = halfHeight;

    // Draw only the top half of the original canvas
    croppedContext.drawImage(
      canvas,
      0,
      0,
      canvas.width,
      halfHeight, // Source: top half
      0,
      0,
      canvas.width,
      halfHeight, // Destination
    );

    return croppedCanvas.toDataURL("image/jpeg", 0.8);
  }

  return canvas.toDataURL("image/jpeg", 0.8);
}

export async function getPdfPageCount(file: File, cachedPdf?: PDFDocumentProxy): Promise<number> {
  const pdf = cachedPdf || (await getCachedPdf(file));
  return pdf.numPages;
}

/**
 * Conta páginas que contêm "FAVORECIDO" (para comprovantes)
 * Usa texto nativo do PDF - muito rápido, sem OCR
 */
export async function countPagesWithFavorecido(file: File, cachedPdf?: PDFDocumentProxy): Promise<number> {
  const pdf = cachedPdf || (await getCachedPdf(file));
  let count = 0;

  for (let i = 1; i <= pdf.numPages; i++) {
    const pageText = await extractTextFromPage(file, i, pdf);
    const normalizedText = pageText
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();

    // Buscar por FAVORECIDO ou variações
    if (/FAVORECIDO\s*:?/.test(normalizedText)) {
      count++;
    }
  }

  return count;
}

/**
 * Conta páginas que contêm padrões de nome de funcionário (para holerites)
 * Detecta PDFs escaneados e usa OCR de amostragem para estimar contagem precisa
 */
export async function countPagesWithEmployeeName(file: File, cachedPdf?: PDFDocumentProxy): Promise<number> {
  const pdf = cachedPdf || (await getCachedPdf(file));
  const totalPages = pdf.numPages;

  // Padrões que indicam presença de nome de funcionário
  const employeePatterns = [
    /(?:NOME|FUNCIONARIO|EMPREGADO|COLABORADOR|TRABALHADOR|TITULAR)\s*:?\s*/i,
    /NOME\s+DO\s+FUNCIONARIO/i,
    /RECIBO\s+DE\s+PAGAMENTO/i,
    /\b\d{3,5}\s+[A-Z][A-Z\s]{5,35}?\s+(?:COZINHEIRA|SERVENTE|AJUDANTE|AUXILIAR|\d{5,6})\b/,
  ];

  // ETAPA 1: Amostragem de texto nativo - verificar se os PADRÕES aparecem
  const samplePages = [1, Math.floor(totalPages / 2), Math.max(1, totalPages - 1)];
  let pagesWithEmployeePattern = 0;

  console.log(`[countEmployees] Amostrando ${samplePages.length} páginas de ${file.name} (${totalPages} páginas)...`);

  for (const pageNum of samplePages) {
    if (pageNum > totalPages) continue;

    const pageText = await extractTextFromPage(file, pageNum, pdf);
    // Verificar se tem PADRÃO de funcionário (não apenas texto genérico)
    const hasName = !!extractEmployeeName(pageText, false);
    const normalizedText = pageText
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();
    const hasEmployee = hasName || employeePatterns.some((pattern) => pattern.test(normalizedText));
    if (hasEmployee) {
      pagesWithEmployeePattern++;
      console.log(`[countEmployees] Página ${pageNum}: padrão de funcionário encontrado no texto nativo`);
    }
  }

  // ETAPA 2: Se encontrou padrões no texto nativo → PDF digital
  if (pagesWithEmployeePattern >= 1) {
    console.log(`[countEmployees] PDF digital detectado: ${file.name}, contando por padrões...`);
    let count = 0;
    for (let i = 1; i <= totalPages; i++) {
      const pageText = await extractTextFromPage(file, i, pdf);
      const hasName = !!extractEmployeeName(pageText, false);
      const normalizedText = pageText
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase();

      const hasEmployee = hasName || employeePatterns.some((pattern) => pattern.test(normalizedText));
      if (hasEmployee) {
        count++;
      }
    }
    console.log(`[countEmployees] PDF digital: ${count} funcionários em ${totalPages} páginas`);
    return count;
  }

  // ETAPA 3: PDF escaneado → fazer OCR de amostragem
  console.log(`[countEmployees] PDF escaneado detectado: ${file.name}, executando OCR de amostragem...`);

  // Inicializar OCR (workers podem já estar ativos)
  await initOcrScheduler();

  // Amostrar 5 páginas distribuídas (evitar primeira e última que podem ser capa/resumo)
  const ocrSampleSize = Math.min(5, Math.max(1, totalPages - 2));
  const ocrSamplePages: number[] = [];

  if (totalPages <= 3) {
    // Poucos páginas: amostrar todas exceto última
    for (let i = 1; i < totalPages; i++) {
      ocrSamplePages.push(i);
    }
  } else {
    // Muitas páginas: distribuir igualmente, evitando primeira e última
    const step = Math.floor((totalPages - 2) / ocrSampleSize);
    for (let i = 0; i < ocrSampleSize; i++) {
      const pageNum = 2 + i * step;
      if (pageNum <= totalPages - 1) {
        ocrSamplePages.push(pageNum);
      }
    }
  }

  console.log(`[countEmployees] OCR amostragem: páginas ${ocrSamplePages.join(", ")}`);

  // Fazer OCR nas páginas amostradas
  const foundNames = new Set<string>();

  for (const pageNum of ocrSamplePages) {
    try {
      const canvas = await renderPageForOCR(file, pageNum, OCR_SCALE_FAST, true);
      const ocrText = await extractTextWithOCR(canvas);

      // Liberar canvas
      canvas.width = 0;
      canvas.height = 0;

      // Extrair nome
      const name = extractEmployeeName(ocrText);
      if (name && !foundNames.has(name)) {
        foundNames.add(name);
        console.log(`[countEmployees] OCR página ${pageNum}: nome encontrado "${name}"`);
      } else if (name) {
        console.log(`[countEmployees] OCR página ${pageNum}: nome duplicado "${name}" (mesmo funcionário)`);
      } else {
        console.log(`[countEmployees] OCR página ${pageNum}: nenhum nome extraído`);
      }
    } catch (error) {
      console.warn(`[countEmployees] OCR falhou na página ${pageNum}:`, error);
    }
  }

  const uniqueNames = foundNames.size;

  // ETAPA 4: Extrapolar para o documento completo
  if (uniqueNames > 0) {
    // Calcular páginas por funcionário baseado na amostra
    const pagesPerEmployee = ocrSamplePages.length / uniqueNames;
    // Estimar total (menos 1-2 páginas para capa/resumo)
    const pagesToCount = totalPages - 1; // Desconta página de resumo
    const estimated = Math.round(pagesToCount / pagesPerEmployee);
    console.log(
      `[countEmployees] OCR amostragem: ${uniqueNames} nomes únicos em ${ocrSamplePages.length} páginas → ~${pagesPerEmployee.toFixed(1)} páginas/funcionário → ~${estimated} funcionários`,
    );
    return Math.max(1, estimated);
  }

  // Fallback final: assumir 1 página por funcionário, menos página de resumo
  console.log(`[countEmployees] Fallback: ${totalPages} páginas - 1 = ${totalPages - 1} funcionários`);
  return Math.max(1, totalPages - 1);
}

/**
 * Função unificada para contar funcionários por tipo de documento
 * Analisa o texto nativo de cada página para contagem precisa
 */
export async function countEmployeesInDocument(
  file: File,
  type: "holerite" | "comprovante",
  cachedPdf?: PDFDocumentProxy,
): Promise<number> {
  if (type === "comprovante") {
    return countPagesWithFavorecido(file, cachedPdf);
  } else {
    return countPagesWithEmployeeName(file, cachedPdf);
  }
}

export function extractEmployeeName(text: string, debug: boolean = true): string | null {
  // Normalizar texto: remover acentos e converter para maiúscula
  const normalizedText = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[-‐‑–—']/g, " ") // Normalizar hífens/apóstrofos
    .replace(/([A-Z])0([A-Z])/g, "$1O$2") // OCR: 0 -> O em nomes
    .replace(/([A-Z])1([A-Z])/g, "$1I$2") // OCR: 1 -> I em nomes
    .replace(/([A-Z])5([A-Z])/g, "$1S$2") // OCR: 5 -> S em nomes
    .replace(/\s+/g, " "); // Normalizar espaços múltiplos

  if (debug) {
    console.log("[DEBUG] Texto normalizado (primeiros 300 chars):", normalizedText.substring(0, 300));
  }

  // Padrões ordenados do mais específico ao mais genérico
  const namePatterns = [
    // 1. Formato B SERVICE: código + nome + cargo/CBO na mesma linha
    // Ex: "2445 JOCELI BRZEZINSKI 513205" ou "2445 JOCELI BRZEZINSKI COZINHEIRA"
    /\b\d{3,5}\s+([A-Z][A-Z\s]{5,35}?)\s+(?:COZINHEIRA|SERVENTE|AJUDANTE|AUXILIAR|SUPERVISOR|OPERADOR|TECNICO|LIDER|ENCARREGADO|\d{5,6})\b/,

    // 2. Nome seguido de cargo brasileiro
    /([A-Z][A-Z\s]{8,45}?)\s+(?:SUPERVISOR|ANALISTA|AUXILIAR|GERENTE|COORDENADOR|ASSISTENTE|OPERADOR|TECNICO|ADMINISTRATIVO|COZINHEIRA|SERVENTE)/,

    // 3. Labels explícitos brasileiros
    /(?:NOME|FUNCIONARIO|EMPREGADO|COLABORADOR|TRABALHADOR|TITULAR|SEGURADO|BENEFICIARIO)\s*:?\s*([A-Z][A-Z\s]{4,50}?)(?=\s*(?:CPF|CARGO|FUNCAO|ADMISSAO|CNPJ|MATRICULA|\d{3}\.\d{3}|$))/,

    // 4. Recibo de pagamento padrão
    /RECIBO\s+DE\s+PAGAMENTO[^A-Z]*([A-Z][A-Z\s]{5,40}?)(?=\s*(?:CPF|CARGO))/,

    // 5. Padrão para "FAVORECIDO" em comprovantes bancários
    /FAVORECIDO\s*:?\s*([A-Z][A-Z\s]{5,40}?)(?=\s*(?:CPF|CNPJ|AG|AGENCIA|CONTA|\d{3}))/,

    // 6. Nome imediatamente antes de CPF
    /([A-Z][A-Z\s]{5,40}?)\s*\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}/,

    // 7. Nomes completos em maiúscula (2-5 palavras, 8-50 chars)
    /\b([A-Z]{3,15}(?:\s+[A-Z]{2,15}){1,4})\b/,

    // 8. Linha com nome completo isolado
    /^([A-Z][A-Z\s]{8,40})$/m,
  ];

  // Lista expandida de palavras inválidas (inclui headers de tabelas)
  const invalidWords = [
    // Termos de empresa/documento
    "CNPJ",
    "CPF",
    "CARGO",
    "FUNCAO",
    "ADMISSAO",
    "SALARIO",
    "EMPRESA",
    "LTDA",
    "EIRELI",
    "SA",
    "PRESTADORA",
    "SERVICOS",
    "FOLHA",
    "MENSAL",
    "RECIBO",
    "PAGAMENTO",

    // Termos de cabeçalho de tabelas
    "CODIGO",
    "NOME",
    "FUNCIONARIO",
    "DEPARTAMENTO",
    "FILIAL",
    "MATRICULA",
    "DATA",
    "REFERENCIA",
    "VENCIMENTOS",
    "DESCONTOS",
    "LIQUIDO",
    "VALOR",
    "TOTAL",
    "BASE",
    "FGTS",
    "INSS",
    "IRRF",
    "DESCRICAO",
    "OBSERVACAO",
    "PERIODO",
    "COMPETENCIA",
    "CBO",
    "CC",
    "FAR",
    "NOMEDOFUNCIONARIO",
    "NOMEFUNCIONARIO",
  ];

  for (const pattern of namePatterns) {
    const match = normalizedText.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim().replace(/\s+/g, " ");
      const words = name.split(" ").filter((w) => w.length > 1);

      // Validação 1: pelo menos 2 palavras, tamanho razoável
      if (words.length < 2 || name.length < 5 || name.length > 60) {
        continue;
      }

      // Validação 2: detectar palavras muito longas (OCR incorreto/junção de palavras)
      const hasVeryLongWord = words.some((w) => w.length > 15);
      if (hasVeryLongWord) {
        if (debug) {
          console.log("[DEBUG] Ignorando - palavra OCR malformada:", name);
        }
        continue;
      }

      // Validação 3: não contém palavras inválidas
      const hasInvalidWord = words.some((w) => invalidWords.includes(w));
      if (hasInvalidWord) {
        if (debug) {
          console.log("[DEBUG] Ignorando - contém palavra inválida:", name);
        }
        continue;
      }

      if (debug) {
        console.log("[DEBUG] Nome extraído:", name);
      }
      return name;
    }
  }

  if (debug) {
    console.log("[DEBUG] Nenhum nome encontrado");
  }
  return null;
}

// Extract CPF for faster matching
export function extractCPF(text: string): string | null {
  const cpfPattern = /\b(\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2})\b/;
  const match = text.match(cpfPattern);
  if (match) {
    // Normalize CPF to digits only
    return match[1].replace(/\D/g, "");
  }
  return null;
}

// Debug flag - disable logs for performance
const DEBUG_MATCH = false;

// Levenshtein distance for fuzzy matching (tolerates OCR errors)
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = Array(b.length + 1)
    .fill(null)
    .map(() => Array(a.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(matrix[j][i - 1] + 1, matrix[j - 1][i] + 1, matrix[j - 1][i - 1] + indicator);
    }
  }

  return matrix[b.length][a.length];
}

// Helper: Find ALL occurrences of a substring in text
function findAllOccurrences(text: string, search: string): number[] {
  const positions: number[] = [];
  let pos = 0;
  while ((pos = text.indexOf(search, pos)) !== -1) {
    positions.push(pos);
    pos += 1;
  }
  return positions;
}

// ============= OPTIMIZED MATCHING WITH PRE-PROCESSING =============

/**
 * Normalize text for matching: remove accents, convert to uppercase, keep only letters and spaces
 */
export function normalizeForMatch(text: string): string {
  return text
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pre-processed page data for fast matching
 */
export interface PreparedPage {
  normalized: string;
  wordSet: Set<string>;
  wordsByLength: Map<number, string[]>;
}

/**
 * Pre-processed target name for fast matching
 */
export interface PreparedTarget {
  original: string;
  normalized: string;
  words: string[];
  firstName: string;
  lastName: string;
  requiredMatches: number;
  charCount: number;
}

/**
 * Prepare a page text for fast matching - call ONCE per page
 */
export function preparePageForMatch(pageText: string): PreparedPage {
  const normalized = normalizeForMatch(pageText);
  const words = normalized.split(" ").filter((w) => w.length >= 3);

  const wordSet = new Set(words);
  const wordsByLength = new Map<number, string[]>();

  for (const word of words) {
    const len = word.length;
    if (!wordsByLength.has(len)) {
      wordsByLength.set(len, []);
    }
    wordsByLength.get(len)!.push(word);
  }

  return { normalized, wordSet, wordsByLength };
}

/**
 * Prepare a target name for fast matching - call ONCE per employee
 */
export function prepareTargetNameForMatch(name: string): PreparedTarget {
  const normalized = normalizeForMatch(name);
  const words = normalized.split(" ").filter((w) => w.length >= 3);

  return {
    original: name,
    normalized,
    words,
    firstName: words[0] || "",
    lastName: words.length >= 2 ? words[words.length - 1] : "",
    requiredMatches: Math.max(2, Math.floor(words.length * 0.7)),
    charCount: normalized.replace(/\s/g, "").length,
  };
}

/**
 * Fast matching using pre-processed data
 * Returns true if target name is found in page
 */
export function findNameInPreparedPage(page: PreparedPage, target: PreparedTarget): boolean {
  // 1. EXACT MATCH - fastest path (using pre-normalized strings)
  if (page.normalized.includes(target.normalized)) {
    if (DEBUG_MATCH) console.log("[Match] Exato:", target.original);
    return true;
  }

  // 2. FIRST + LAST NAME proximity check
  if (target.firstName && target.lastName) {
    const allFirstPositions = findAllOccurrences(page.normalized, target.firstName);
    const allLastPositions = findAllOccurrences(page.normalized, target.lastName);

    // Check if any pair is within 150 characters
    for (const firstPos of allFirstPositions) {
      for (const lastPos of allLastPositions) {
        if (Math.abs(firstPos - lastPos) < 150) {
          if (DEBUG_MATCH) console.log("[Match] Primeiro+Último nome:", target.original);
          return true;
        }
      }
    }
  }

  // 3. FUZZY MATCH with optimized word lookup
  let matchedWords = 0;
  const targetWordCount = target.words.length;

  for (let i = 0; i < targetWordCount; i++) {
    const targetWord = target.words[i];

    // Early exit: if remaining words can't reach required matches
    const remainingWords = targetWordCount - i;
    if (matchedWords + remainingWords < target.requiredMatches) {
      break;
    }

    // Exact match using Set (O(1) lookup)
    if (page.wordSet.has(targetWord)) {
      matchedWords++;
      if (matchedWords >= target.requiredMatches) {
        if (DEBUG_MATCH) console.log(`[Match] Fuzzy exato ${matchedWords}/${targetWordCount}:`, target.original);
        return true;
      }
      continue;
    }

    // Fuzzy: proportional tolerance
    const maxErrors = targetWord.length <= 5 ? 1 : targetWord.length <= 8 ? 2 : 3;

    // Search only in buckets of similar length (HUGE optimization)
    let foundFuzzy = false;
    for (let lenDiff = 0; lenDiff <= maxErrors && !foundFuzzy; lenDiff++) {
      for (const len of [targetWord.length - lenDiff, targetWord.length + lenDiff]) {
        if (len < 3) continue;
        const candidates = page.wordsByLength.get(len);
        if (!candidates) continue;

        for (const pageWord of candidates) {
          if (levenshteinDistance(pageWord, targetWord) <= maxErrors) {
            matchedWords++;
            foundFuzzy = true;
            break;
          }
        }
        if (foundFuzzy) break;
      }
    }

    if (matchedWords >= target.requiredMatches) {
      if (DEBUG_MATCH) console.log(`[Match] Fuzzy ${matchedWords}/${targetWordCount}:`, target.original);
      return true;
    }
  }

  // 4. SUBSTRING MATCH - if >60% of name characters are present
  if (target.charCount > 0) {
    let matchedChars = 0;
    for (const word of target.words) {
      if (page.normalized.includes(word)) {
        matchedChars += word.length;
      }
    }
    if (matchedChars / target.charCount >= 0.6) {
      if (DEBUG_MATCH) console.log(`[Match] Substring ${matchedChars}/${target.charCount}:`, target.original);
      return true;
    }
  }

  return false;
}

// Legacy function - wrapper for compatibility
export function findNameInPage(pageText: string, targetName: string): boolean {
  const preparedPage = preparePageForMatch(pageText);
  const preparedTarget = prepareTargetNameForMatch(targetName);
  return findNameInPreparedPage(preparedPage, preparedTarget);
}

export async function createCombinedPdf(
  holeriteFile: File,
  comprovanteFile: File,
  comprovantePageNumber: number,
  employeeName: string,
  holeritePageNumber: number = 1,
  cropHoleriteToHalf: boolean = true, // Crop to top half (single via)
): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();

  // A4 landscape dimensions
  const pageWidth = 841.89;
  const pageHeight = 595.28;

  const page = pdfDoc.addPage([pageWidth, pageHeight]);

  // Use cached buffers
  const holeriteBytes = await getCachedBuffer(holeriteFile);
  const comprovanteBytes = await getCachedBuffer(comprovanteFile);

  let holeritePdf = await PDFDocument.load(holeriteBytes.slice(0));
  const comprovantePdf = await PDFDocument.load(comprovanteBytes.slice(0));

  // Crop holerite to top half if needed (removes duplicate via)
  if (cropHoleriteToHalf) {
    const originalPage = holeritePdf.getPage(holeritePageNumber - 1);
    const { width, height } = originalPage.getSize();

    const croppedPdf = await PDFDocument.create();
    const [copiedPage] = await croppedPdf.copyPages(holeritePdf, [holeritePageNumber - 1]);

    // Set crop box to top half only (y starts from bottom in PDF coordinates)
    copiedPage.setCropBox(0, height / 2, width, height / 2);
    croppedPdf.addPage(copiedPage);

    // Use the cropped PDF instead
    holeritePdf = croppedPdf;
  }

  // Embed the (possibly cropped) holerite page
  const [holeritePage] = await pdfDoc.embedPdf(holeritePdf, [cropHoleriteToHalf ? 0 : holeritePageNumber - 1]);
  const [comprovantePage] = await pdfDoc.embedPdf(comprovantePdf, [comprovantePageNumber - 1]);

  const margin = 20;
  const headerHeight = 40;
  const availableWidth = (pageWidth - margin * 3) / 2;
  const availableHeight = pageHeight - margin * 2 - headerHeight;

  const holeriteScale = Math.min(availableWidth / holeritePage.width, availableHeight / holeritePage.height);
  const comprovanteScale = Math.min(availableWidth / comprovantePage.width, availableHeight / comprovantePage.height);

  const holeriteWidth = holeritePage.width * holeriteScale;
  const holeriteHeight = holeritePage.height * holeriteScale;
  const comprovanteWidth = comprovantePage.width * comprovanteScale;
  const comprovanteHeight = comprovantePage.height * comprovanteScale;

  page.drawText(`Funcionário: ${employeeName}`, {
    x: margin,
    y: pageHeight - margin - 15,
    size: 14,
    color: rgb(0.086, 0.502, 0.224),
  });

  const date = new Date().toLocaleDateString("pt-BR");
  page.drawText(`Gerado em: ${date}`, {
    x: pageWidth - margin - 120,
    y: pageHeight - margin - 15,
    size: 10,
    color: rgb(0.4, 0.4, 0.4),
  });

  page.drawLine({
    start: { x: margin, y: pageHeight - headerHeight },
    end: { x: pageWidth - margin, y: pageHeight - headerHeight },
    thickness: 1,
    color: rgb(0.8, 0.8, 0.8),
  });

  page.drawText("HOLERITE", {
    x: margin + availableWidth / 2 - 30,
    y: pageHeight - headerHeight - 15,
    size: 10,
    color: rgb(0.3, 0.3, 0.3),
  });

  page.drawText("COMPROVANTE", {
    x: margin * 2 + availableWidth + availableWidth / 2 - 45,
    y: pageHeight - headerHeight - 15,
    size: 10,
    color: rgb(0.3, 0.3, 0.3),
  });

  const holeriteY = pageHeight - headerHeight - 25 - holeriteHeight;
  page.drawPage(holeritePage, {
    x: margin + (availableWidth - holeriteWidth) / 2,
    y: holeriteY,
    width: holeriteWidth,
    height: holeriteHeight,
  });

  const comprovanteY = pageHeight - headerHeight - 25 - comprovanteHeight;
  page.drawPage(comprovantePage, {
    x: margin * 2 + availableWidth + (availableWidth - comprovanteWidth) / 2,
    y: comprovanteY,
    width: comprovanteWidth,
    height: comprovanteHeight,
  });

  page.drawRectangle({
    x: margin,
    y: holeriteY - 5,
    width: availableWidth,
    height: holeriteHeight + 10,
    borderColor: rgb(0.8, 0.8, 0.8),
    borderWidth: 1,
  });

  page.drawRectangle({
    x: margin * 2 + availableWidth,
    y: comprovanteY - 5,
    width: availableWidth,
    height: comprovanteHeight + 10,
    borderColor: rgb(0.8, 0.8, 0.8),
    borderWidth: 1,
  });

  const pdfBytes = await pdfDoc.save();
  return new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });
}
