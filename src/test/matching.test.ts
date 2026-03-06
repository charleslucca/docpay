import { describe, it, expect } from "vitest";
import { matchNameDirect, normalizeForMatch } from "@/lib/pdfUtils";
import { findEmployeeInSpreadsheet, type EmployeeRecord } from "@/lib/excelUtils";

describe("matchNameDirect - strict first/last name", () => {
  const norm = normalizeForMatch;

  it("should NOT match DIOVANA DA SILVA with GIOVANA SIDES DA SILVA", () => {
    expect(matchNameDirect(norm("DIOVANA DA SILVA"), norm("GIOVANA SIDES DA SILVA"))).toBe(false);
  });

  it("should NOT match DIOVANA with GIOVANA (different first name)", () => {
    expect(matchNameDirect(norm("DIOVANA PEREIRA"), norm("GIOVANA PEREIRA"))).toBe(false);
  });

  it("should NOT match MARIA SILVA with MARTA SILVA (different first name)", () => {
    expect(matchNameDirect(norm("MARIA SILVA"), norm("MARTA SILVA"))).toBe(false);
  });

  it("should match exact names", () => {
    expect(matchNameDirect(norm("JOAO DA SILVA"), norm("JOAO DA SILVA"))).toBe(true);
  });

  it("should match same first+last with different middle names", () => {
    expect(matchNameDirect(norm("JOAO CARLOS SILVA"), norm("JOAO PEREIRA SILVA"))).toBe(true);
  });

  it("should NOT match different last names", () => {
    expect(matchNameDirect(norm("JOAO DA SILVA"), norm("JOAO DA COSTA"))).toBe(false);
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
    // DIOVANA should find EMPRESA A, not EMPRESA B
    const result = findEmployeeInSpreadsheet("DIOVANA DA SILVA", records);
    expect(result?.empresa).not.toBe("EMPRESA B");
  });

  it("should return null for ambiguous matches (duplicate names)", () => {
    const result = findEmployeeInSpreadsheet("MARIA SOUZA", records);
    // Exact match exists twice, but first exact match should win
    expect(result).not.toBeNull();
  });

  it("should return null when no match found", () => {
    const result = findEmployeeInSpreadsheet("CARLOS ROBERTO", records);
    expect(result).toBeNull();
  });
});
