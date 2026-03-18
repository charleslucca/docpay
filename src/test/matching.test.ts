import { describe, it, expect } from "vitest";
import { matchNameDirect, normalizeForMatch, calculateNameMatchScore, jaroWinklerSimilarity, firstNameBlocking, tokenizeName, removeParticles } from "@/lib/pdfUtils";
import { findEmployeeInSpreadsheet, type EmployeeRecord } from "@/lib/excelUtils";
import { sanitizeName, sanitizeNameWithOCR, debugNameBytes } from "@/lib/nameUtils";

describe("jaroWinklerSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(jaroWinklerSimilarity("JOAO", "JOAO")).toBe(1);
  });

  it("returns high score for similar names", () => {
    expect(jaroWinklerSimilarity("JOICE", "JOICI")).toBeGreaterThan(0.85);
  });

  it("returns low score for different names", () => {
    expect(jaroWinklerSimilarity("SIMONE", "JULIANA")).toBeLessThan(0.6);
  });
});

describe("firstNameBlocking", () => {
  it("should pass identical first names", () => {
    expect(firstNameBlocking("JOAO", "JOAO")).toBe(true);
  });

  it("should pass OCR variations (JOICE/JOICI, GISELE/GISELA)", () => {
    expect(firstNameBlocking("JOICE", "JOICI")).toBe(true);
    expect(firstNameBlocking("GISELE", "GISELA")).toBe(true);
    expect(firstNameBlocking("KELLI", "KELLY")).toBe(true);
    expect(firstNameBlocking("DATANE", "DAIANE")).toBe(true);
  });

  it("should BLOCK completely different first names", () => {
    expect(firstNameBlocking("SIMONE", "JULIANA")).toBe(false);
    expect(firstNameBlocking("CARMEM", "TATIANE")).toBe(false);
    expect(firstNameBlocking("MARIA", "ROSELAINE")).toBe(false);
    expect(firstNameBlocking("DIOVANA", "GIOVANA")).toBe(false);
  });
});

describe("removeParticles", () => {
  it("removes DE, DA, DOS, DAS", () => {
    expect(removeParticles("JOAO DA SILVA")).toBe("JOAO SILVA");
    expect(removeParticles("MARIA DOS SANTOS")).toBe("MARIA SANTOS");
  });
});

describe("matchNameDirect - robust matching", () => {
  const norm = normalizeForMatch;

  // === FALSE POSITIVE PREVENTION ===
  it("should NOT match SIMONE CARVALHO PADILHA with JULIANA MARIELI DE CARVALHO", () => {
    expect(matchNameDirect(norm("SIMONE CARVALHO PADILHA"), norm("JULIANA MARIELI DE CARVALHO"))).toBe(false);
  });

  it("should NOT match DIOVANA DA SILVA with GIOVANA SIDES DA SILVA", () => {
    expect(matchNameDirect(norm("DIOVANA DA SILVA"), norm("GIOVANA SIDES DA SILVA"))).toBe(false);
  });

  it("should NOT match CARMEM OLIVEIRA DA SILVA with TATIANE OLIVEIRA DA SILVA", () => {
    expect(matchNameDirect(norm("CARMEM OLIVEIRA DA SILVA"), norm("TATIANE OLIVEIRA DA SILVA"))).toBe(false);
  });

  it("should NOT match MARIA SILVA with MARTA SILVA (different first name)", () => {
    expect(matchNameDirect(norm("MARIA SILVA"), norm("MARTA SILVA"))).toBe(false);
  });

  it("should NOT match names sharing only common surname SILVA", () => {
    expect(matchNameDirect(norm("BEATRIZ GALL DA SILVA"), norm("JESSICA DAIANA ELIAS DA SILVA"))).toBe(false);
  });

  it("should NOT match names sharing only SANTOS", () => {
    expect(matchNameDirect(norm("NIURA LUIZA SOARES"), norm("IVONEI SOARES"))).toBe(false);
  });

  // === TRUE POSITIVE: EXACT MATCHES ===
  it("should match exact names", () => {
    expect(matchNameDirect(norm("JOAO DA SILVA"), norm("JOAO DA SILVA"))).toBe(true);
  });

  it("should match same first+last with different middle names", () => {
    expect(matchNameDirect(norm("JOAO CARLOS SILVA"), norm("JOAO PEREIRA SILVA"))).toBe(true);
  });

  // === TRUE POSITIVE: OCR TOLERANCE ===
  it("should match JOICE/JOICI BEATRIZ MEES (OCR first name)", () => {
    expect(matchNameDirect(norm("JOICE BEATRIZ MEES"), norm("JOICI BEATRIZ MEES"))).toBe(true);
  });

  it("should match GISELE/GISELA APARECIDA SILVA SOARES (OCR first name)", () => {
    expect(matchNameDirect(norm("GISELE APARECIDA SILVA SOARES"), norm("GISELA APARECIDA SILVA SOARES"))).toBe(true);
  });

  it("should match KELLI/KELLY CRISTINA MONTEIRO (OCR first name)", () => {
    expect(matchNameDirect(norm("KELLI CRISTINA MONTEIRO"), norm("KELLY CRISTINA MONTEIRO"))).toBe(true);
  });

  // === TRUE POSITIVE: TRUNCATED LAST NAMES ===
  it("should match truncated last name SANTOS/SANTO", () => {
    expect(matchNameDirect(norm("ANA CRISTINA PEREIRA DOS SANTOS"), norm("ANA CRISTINA PEREIRA DOS SANTO"))).toBe(true);
  });

  it("should match truncated FERNANDES/FERNA", () => {
    expect(matchNameDirect(norm("CARLA SIMONE DA SILVEIRA FERNANDES"), norm("CARLA SIMONE DA SILVEIRA FERNA"))).toBe(true);
  });

  it("should match truncated CONCEICAO/CONCEI", () => {
    expect(matchNameDirect(norm("PAMELA MAURILIA DA ROSA CONCEICAO"), norm("PAMELA MAURILIA DA ROSA CONCEI"))).toBe(true);
  });

  it("should match truncated OLIVEIRA/OLIVEI", () => {
    expect(matchNameDirect(norm("GERTRUDES BERNARDINO DE OLIVEIRA"), norm("GERTRUDES BERNARDINO DE OLIVEI"))).toBe(true);
  });

  // === NEGATIVE: DIFFERENT LAST NAMES ===
  it("should NOT match different last names", () => {
    expect(matchNameDirect(norm("JOAO DA SILVA"), norm("JOAO DA COSTA"))).toBe(false);
  });
});

describe("calculateNameMatchScore - scoring validation", () => {
  const norm = normalizeForMatch;

  it("returns score 0 for completely different first names", () => {
    const { score } = calculateNameMatchScore(norm("SIMONE CARVALHO"), norm("JULIANA CARVALHO"));
    expect(score).toBe(0);
  });

  it("returns high score for OCR-similar names", () => {
    const { score } = calculateNameMatchScore(norm("JOICE BEATRIZ MEES"), norm("JOICI BEATRIZ MEES"));
    expect(score).toBeGreaterThan(0.85);
  });

  it("returns score >= 0.85 for truncated last name matches", () => {
    const { score } = calculateNameMatchScore(
      norm("ROSANE TERESINHA MELLO DE ASSIS"), 
      norm("ROSANE TERESINHA MELLO DE ASSI")
    );
    expect(score).toBeGreaterThan(0.85);
  });

  it("includes reason with PRIMEIRO NOME DIFERENTE for blocked names", () => {
    const { reason } = calculateNameMatchScore(norm("SIMONE PADILHA"), norm("JULIANA PADILHA"));
    expect(reason).toContain("PRIMEIRO NOME DIFERENTE");
  });
});

describe("findEmployeeInSpreadsheet - strict metadata lookup", () => {
  const records: EmployeeRecord[] = [
    { empresa: "EMPRESA A", cidade: "CIDADE A", contrato: "001", colaborador: "DIOVANA DA SILVA" },
    { empresa: "EMPRESA B", cidade: "CIDADE B", contrato: "002", colaborador: "GIOVANA SIDES DA SILVA" },
    { empresa: "EMPRESA C", cidade: "CIDADE C", contrato: "003", colaborador: "MARIA SOUZA" },
    { empresa: "EMPRESA D", cidade: "CIDADE D", contrato: "004", colaborador: "MARIA SOUZA" }, // duplicate
  ];

  it("should find exact match", () => {
    const result = findEmployeeInSpreadsheet("DIOVANA DA SILVA", records);
    expect(result?.empresa).toBe("EMPRESA A");
  });

  it("should NOT cross-match DIOVANA with GIOVANA", () => {
    const result = findEmployeeInSpreadsheet("DIOVANA DA SILVA", records);
    expect(result?.empresa).not.toBe("EMPRESA B");
  });

  it("should return null for ambiguous matches (duplicate names)", () => {
    const result = findEmployeeInSpreadsheet("MARIA SOUZA", records);
    expect(result).not.toBeNull();
  });

  it("should return null when no match found", () => {
    const result = findEmployeeInSpreadsheet("CARLOS ROBERTO", records);
    expect(result).toBeNull();
  });
});
