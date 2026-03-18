

## Problem

The payroll report `.xls` file fails to import because:

1. **Detection failure**: `isPayrollReport()` joins cells in each row and searches for "RELAÇÃO DA FOLHA", but in `.xls` format with merged cells, the title text may end up in unexpected cell positions or rows
2. **Fixed column assumptions**: `parsePayrollReport()` hardcodes financial data to columns C-J (indices 2-9), but merged cells in `.xls` can shift positions
3. **Header row not found dynamically**: The parser doesn't search for the actual column header row ("Código", "Nome do empregado")

## Fix

### File: `src/lib/excelUtils.ts`

**1. Make `isPayrollReport()` more robust:**
- Expand scan to 20 rows instead of 10
- Also check individual cells (not just joined row text) for the title
- Add fallback detection: if any row contains both "Código" and "Nome do empregado" columns, treat as payroll report

**2. Make `parsePayrollReport()` dynamic:**
- Scan all rows (up to 20) for the column header row by looking for cells containing "Código" and "Nome do empregado"
- Use `findColumnIndex()` (already exists) to map columns dynamically instead of hardcoded indices
- Extract empresa by scanning first rows for a non-empty text cell that matches the pattern `N - COMPANY NAME`
- Handle merged cells: check all cells in each row when looking for "Serviço:"

**3. Improve empresa/metadata extraction:**
- Scan first 6 rows for empresa (pattern: `^\d+\s*-\s*.+`)
- Scan for CNPJ pattern to confirm report header area

### No other files change — the fix is entirely within `excelUtils.ts`.

## Technical details

```text
Current flow:
  .xls upload → isPayrollReport() → false (title not found)
  → validateExcelStructure() → no "Todos" sheet → invalid
  → parseMunicipalitySheets() → no city-format sheets → 0 records
  → throws "Nenhum funcionário encontrado"

Fixed flow:
  .xls upload → isPayrollReport() → true (finds "Código"+"Nome do empregado" header)
  → parsePayrollReport() → dynamically finds header row → maps columns
  → parses employee rows → returns records
```

### Key changes in `parsePayrollReport()`:
- Find header row dynamically using `findColumnIndex` with aliases for each column
- Column aliases: `["CODIGO", "CÓDIGO", "COD"]` for code, `["NOME DO EMPREGADO", "NOME", "EMPREGADO"]` for name
- Use found indices for all financial columns instead of hardcoded 2-9
- Empresa extraction: scan rows 0-5 for pattern `^\d+\s*-\s*`

