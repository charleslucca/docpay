/**
 * Centralized name sanitization utility.
 * Single source of truth for normalizing names across the entire pipeline
 * (Excel parsing, PDF extraction, DB storage, matching).
 */

// Invisible/zero-width characters to strip
const INVISIBLE_CHARS = /[\uFEFF\u200B\u200C\u200D\u2060\u00AD\uFFFE\u2028\u2029]/g;

/**
 * Sanitize a name for consistent comparison across all data sources.
 * 
 * Pipeline:
 * 1. Strip BOM, zero-width chars, soft hyphens
 * 2. Replace non-breaking spaces, tabs, newlines → space
 * 3. NFD + remove combining marks (accents)
 * 4. Uppercase
 * 5. Replace hyphens/apostrophes → space
 * 6. Remove everything that isn't A-Z or space
 * 7. Collapse multiple spaces → one
 * 8. Trim
 */
export function sanitizeName(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(INVISIBLE_CHARS, "")           // 1. Strip invisible chars
    .replace(/[\u00A0\t\r\n]/g, " ")        // 2. Normalize whitespace variants
    .normalize("NFD")                        // 3a. Decompose accented chars
    .replace(/[\u0300-\u036f]/g, "")         // 3b. Remove combining marks
    .toUpperCase()                           // 4. Uppercase
    .replace(/[-‐‑–—''`´]/g, " ")           // 5. Hyphens/apostrophes → space
    .replace(/[^A-Z\s]/g, "")               // 6. Keep only letters and spaces
    .replace(/\s+/g, " ")                    // 7. Collapse spaces
    .trim();                                 // 8. Trim
}

/**
 * Sanitize with additional OCR corrections (for PDF-extracted text).
 * Applies digit→letter substitutions common in OCR errors before stripping non-letters.
 */
export function sanitizeNameWithOCR(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(INVISIBLE_CHARS, "")
    .replace(/[\u00A0\t\r\n]/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[-‐‑–—''`´]/g, " ")
    .replace(/([A-Z])0([A-Z])/g, "$1O$2")   // OCR: 0 → O between letters
    .replace(/([A-Z])1([A-Z])/g, "$1I$2")   // OCR: 1 → I between letters
    .replace(/([A-Z])5([A-Z])/g, "$1S$2")   // OCR: 5 → S between letters
    .replace(/[^A-Z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Debug utility: returns hex representation of each character in a string.
 * Useful for identifying invisible characters that cause match failures.
 * 
 * Example: debugNameBytes("JOAO") → "J(4A) O(4F) A(41) O(4F)"
 */
export function debugNameBytes(str: string): string {
  return Array.from(str)
    .map(ch => {
      const code = ch.codePointAt(0)!;
      const hex = code.toString(16).toUpperCase().padStart(2, "0");
      if (code >= 0x21 && code <= 0x7E) {
        return `${ch}(${hex})`;
      }
      if (code === 0x20) return `·(20)`;
      return `\\u${hex.padStart(4, "0")}`;
    })
    .join(" ");
}

/**
 * Log sanitization diff when the sanitized value differs from the original.
 * Only logs when there's an actual difference (invisible chars removed, etc).
 */
export function logSanitizationDiff(context: string, original: string, sanitized: string): void {
  // Compare the original (just trimmed+uppercased) with sanitized
  const simpleNorm = original.trim().toUpperCase();
  if (simpleNorm !== sanitized) {
    console.warn(
      `[SANITIZE] ${context}: value changed during sanitization\n` +
      `  Original bytes: ${debugNameBytes(original)}\n` +
      `  Sanitized: "${sanitized}"\n` +
      `  Diff: original had chars not in sanitized output`
    );
  }
}
