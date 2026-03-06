import { PDFDocument, rgb } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { getCachedPdf, getCachedBuffer, renderPageForOCR, OCR_SCALE_FAST } from "./pdfCache";
import { extractTextWithOCR } from "./ocrUtils";

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

  // ETAPA 3: PDF escaneado → estimativa rápida sem OCR pesado (reservar para processamento principal)
  console.log(`[countEmployees] PDF escaneado detectado: ${file.name}, usando estimativa rápida...`);

  // Estimativa simples: assumir ~1 funcionário por página (padrão para holerites escaneados)
  // O OCR completo será feito durante o processamento principal
  const estimated = Math.max(1, totalPages - 1); // Menos 1 para possível página de resumo
  console.log(`[countEmployees] Estimativa rápida (sem OCR): ~${estimated} funcionários em ${totalPages} páginas`);
  return estimated;
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
    // 1. Formato B SERVICE: código (pode ter letras OCR) + nome + cargo/CBO na mesma linha
    // Ex: "2445 JOCELI BRZEZINSKI 513205" ou "S0 CAMILLO ALVES PELZER S14320"
    /\b[A-Z0-9]{2,5}\s+([A-Z][A-Z\s]{5,35}?)\s+(?:COZINHEIRA|SERVENTE|AJUDANTE|AUXILIAR|SUPERVISOR|OPERADOR|TECNICO|LIDER|ENCARREGADO|FISCAL|PORTEIRO|ZELADOR|JARDINEIRO|MOTORISTA|VIGILANTE|RECEPCIONISTA|COPEIRA|LAVADOR|PEDREIRO|PINTOR|ELETRICISTA|BOMBEIRO|MECANICO|ALMOXARIFE|S?\d{4,6})\b/,

    // 1.5 Formato B SERVICE (OCR ruidoso): nome entre mês/ano e código CBO
    // Ex: "AGOSTO DE 2025 S0 CAMILLO ALVES PELZER S14320" -> "CAMILLO ALVES PELZER"
    // Ex: "AGOSTO DE 2025 83 CLEUSA CORREA DA SILVA 514215" -> "CLEUSA CORREA DA SILVA"
    /(?:JANEIRO|FEVEREIRO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)\s+DE\s+\d{4}\s+(?:\S{1,6}\s+)?([A-Z][A-Z\s]{5,40}?)\s+(?:S?\d{4,6})\s/,

    // 2. Nome seguido de cargo brasileiro
    /([A-Z][A-Z\s]{8,45}?)\s+(?:SUPERVISOR|ANALISTA|AUXILIAR|GERENTE|COORDENADOR|ASSISTENTE|OPERADOR|TECNICO|ADMINISTRATIVO|COZINHEIRA|SERVENTE)/,

    // 3a. Label composto "NOME DO FUNCIONARIO" e variantes
    /NOME\s+D[OA]\s+(?:FUNCIONARIO|EMPREGADO|COLABORADOR|TRABALHADOR)\s*:?\s*([A-Z][A-Z\s]{4,50}?)(?=\s*(?:CPF|CARGO|FUNCAO|ADMISSAO|CNPJ|MATRICULA|\d{3}\.\d{3}|$))/,

    // 3b. Labels explícitos brasileiros (palavra única)
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
const DEBUG_MATCH = true;

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
    .replace(/[-‐‑–—']/g, " ") // Normalize hyphens/apostrophes
    .replace(/([A-Z])0([A-Z])/g, "$1O$2") // OCR: 0 -> O between letters
    .replace(/([A-Z])1([A-Z])/g, "$1I$2") // OCR: 1 -> I between letters
    .replace(/([A-Z])5([A-Z])/g, "$1S$2") // OCR: 5 -> S between letters
    .replace(/[^A-Z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize text lightly for label extraction: keep letters, digits, colons, slashes, spaces.
 * Less aggressive than normalizeForMatch — preserves anchors needed by regex lookaheads.
 */
function normalizeLightForExtraction(text: string): string {
  return text
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-‐‑–—']/g, " ")
    .replace(/([A-Z])0([A-Z])/g, "$1O$2")
    .replace(/([A-Z])1([A-Z])/g, "$1I$2")
    .replace(/([A-Z])5([A-Z])/g, "$1S$2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract all employee names from a comprovante page text using common bank labels.
 * Searches for FAVORECIDO, BENEFICIARIO, DESTINATARIO, NOME DO BENEFICIARIO, etc.
 * Receives RAW page text (not pre-normalized) for maximum regex accuracy.
 */
export function extractFavorecidoNames(rawOrNormalizedText: string): string[] {
  const names: string[] = [];
  const text = normalizeLightForExtraction(rawOrNormalizedText);

  // Labels commonly used in Brazilian bank comprovantes
  const labels = [
    "FAVORECIDO",
    "BENEFICIARIO",
    "DESTINATARIO",
    "NOME DO BENEFICIARIO",
    "NOME DO FAVORECIDO",
    "NOME BENEFICIARIO",
    "NOME FAVORECIDO",
    "NOME DESTINATARIO",
    "NOME DO DESTINATARIO",
  ];

  const labelPattern = labels.join("|");

  // Regex: label + optional colon + name + lookahead for common anchors
  // Uses light normalization so digits/colons/slashes are preserved for accurate anchoring
  const regex = new RegExp(
    `(?:${labelPattern})\\s*:?\\s*([A-Z][A-Z ]{4,60}?)(?=\\s*(?:CPF|CNPJ|AG[E ]*NCIA|AGENCIA|CONTA|BANCO|VALOR|COOPERATIVA|DATA|MODALIDADE|CODIGO|NUMERO|TIPO|CREDITO|DEBITO|PAGAMENTO|TRANSFERENCIA|PIX|TED|DOC|CHAVE|INSTITUICAO|\\d{3}[. ]?\\d{3}[. ]?\\d{3}|\\d{2}/\\d{2}|$))`,
    "g",
  );

  let match;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1].trim().replace(/\s+/g, " ");
    const words = name.split(" ").filter(w => w.length > 1);
    if (words.length >= 2 && name.length >= 5) {
      const normalized = normalizeForMatch(name);
      // Avoid duplicates
      if (!names.includes(normalized)) {
        names.push(normalized);
      }
    }
  }

  // Fallback: busca direta quando regex falha
  if (names.length === 0) {
    const labelsList = ["NOME DO FAVORECIDO", "NOME DO BENEFICIARIO", "NOME FAVORECIDO", 
                         "NOME BENEFICIARIO", "FAVORECIDO", "BENEFICIARIO", "DESTINATARIO"];
    const stopWords = new Set(["CPF", "CNPJ", "AGENCIA", "CONTA", "BANCO", "VALOR", 
      "COOPERATIVA", "DATA", "MODALIDADE", "CODIGO", "NUMERO", "TIPO", "CREDITO", 
      "DEBITO", "PAGAMENTO", "TRANSFERENCIA", "PIX", "TED", "DOC", "CHAVE", "INSTITUICAO",
      "AG", "CONTA", "SICREDI", "BRADESCO", "ITAU", "SANTANDER", "CAIXA", "BB"]);
    
    for (const label of labelsList) {
      const idx = text.indexOf(label);
      if (idx === -1) continue;
      
      let afterLabel = text.substring(idx + label.length).replace(/^\s*:?\s*/, "");
      const words: string[] = [];
      for (const word of afterLabel.split(/\s+/)) {
        if (stopWords.has(word) || /^\d/.test(word) || word.length === 0) break;
        if (/^[A-Z]{2,}$/.test(word)) words.push(word);
        else break;
      }
      if (words.length >= 2) {
        const normalized = normalizeForMatch(words.join(" "));
        if (!names.includes(normalized)) {
          console.log(`[FavorecidoExtract] Fallback found name: "${words.join(" ")}" via label "${label}"`);
          names.push(normalized);
        }
        break;
      }
    }
  }

  if (names.length > 0) {
    if (DEBUG_MATCH) console.log(`[FavorecidoExtract] Found ${names.length} names:`, names.slice(0, 5));
  } else {
    const hasLabel = ["FAVORECIDO", "BENEFICIARIO", "DESTINATARIO"].some(l => text.includes(l));
    console.warn(`[FavorecidoExtract] 0 nomes extraídos. Label encontrado: ${hasLabel}. Texto (200 chars):`, text.substring(0, 200));
  }

  return names;
}

/**
 * Direct name-to-name comparison using word coverage and Levenshtein.
 * More precise than substring search in full page text.
 */
export function matchNameDirect(targetNormalized: string, candidateNormalized: string): boolean {
  if (targetNormalized === candidateNormalized) return true;

  const targetWords = targetNormalized.split(" ").filter(w => w.length >= 3);
  const candidateWords = candidateNormalized.split(" ").filter(w => w.length >= 3);
  if (targetWords.length === 0 || candidateWords.length === 0) return false;

  // First + last name must match (exact or very close fuzzy)
  // STRICT: First name allows only 1 edit max to avoid false positives (e.g. DIOVANA ≠ GIOVANA)
  const tFirst = targetWords[0], tLast = targetWords[targetWords.length - 1];
  const cFirst = candidateWords[0], cLast = candidateWords[candidateWords.length - 1];

  const firstOk = tFirst === cFirst || levenshteinDistance(tFirst, cFirst) <= 1;
  const lastOk = tLast === cLast || levenshteinDistance(tLast, cLast) <= 1;
  if (!firstOk || !lastOk) return false;

  // Count matched words (stricter: max 1 edit for words ≤ 6 chars, 2 for longer)
  let matched = 0;
  for (const tw of targetWords) {
    for (const cw of candidateWords) {
      const maxErr = tw.length <= 6 ? 1 : 2;
      if (tw === cw || levenshteinDistance(tw, cw) <= maxErr) {
        matched++;
        break;
      }
    }
  }

  const required = Math.max(2, Math.ceil(targetWords.length * 0.6));
  return matched >= required;
}

/**
 * Pre-processed page data for fast matching
 */
export interface PreparedPage {
  normalized: string;
  wordSet: Set<string>;
  wordsByLength: Map<number, string[]>;
  favorecidoNames: string[]; // Pre-extracted FAVORECIDO names for fast matching
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
 * Uses RAW text for favorecido extraction (better regex accuracy)
 * and normalized text for fuzzy/substring matching.
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

  // CRITICAL FIX: Pass RAW text to extractFavorecidoNames, not the fully-stripped normalized text.
  // normalizeForMatch strips digits/colons/slashes which are needed by the regex lookaheads.
  const favorecidoNames = extractFavorecidoNames(pageText);

  return { normalized, wordSet, wordsByLength, favorecidoNames };
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
  // 0. FAVORECIDO MATCH - highest priority for comprovantes (most precise)
  if (page.favorecidoNames.length > 0) {
    for (const favName of page.favorecidoNames) {
      if (matchNameDirect(target.normalized, favName)) {
        if (DEBUG_MATCH) console.log("[Match] Favorecido:", target.original, "↔", favName);
        return true;
      }
    }
  }

  // No favorecido names extracted = no match possible
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
