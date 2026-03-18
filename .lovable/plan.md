

## Diagnóstico

O código de detecção e parsing parece correto em teoria, mas continua falhando. O problema real é como o SheetJS lê arquivos `.xls` legados com células mescladas:

1. **`sheet_to_json({header: 1})` com `.xls` mesclados** — células mescladas só têm valor na célula âncora (canto superior esquerdo). As demais ficam vazias. Isso pode fazer com que cabeçalhos como "Salário" apareçam em posições inesperadas ou que o array da linha tenha comprimento diferente do esperado.

2. **Sem diagnóstico** — não há logs suficientes para entender se a detecção do layout está falhando (header não encontrado) ou se o parsing dos dados é que falha (nenhuma linha passa os filtros).

3. **Nenhum fallback para leitura direta de células** — se `sheet_to_json` produz resultados inesperados para `.xls` mesclado, o sistema simplesmente falha.

## Plano de correção (focado no layout da imagem)

### Arquivo: `src/lib/excelUtils.ts`

**1. Adicionar logging diagnóstico detalhado**
- Em `analyzeSheetForPayrollLayout`: logar os primeiros 15 arrays de linha (apenas cabeçalhos/textos, nunca valores financeiros) para ver exatamente o que `sheet_to_json` produz
- Em `parsePayrollReport`: logar quantas linhas são processadas, quantas são pulas por cada motivo (serviço, skipPattern, código inválido, nome curto)
- Em `parseExcelFile`: logar sheet names, número de linhas por sheet, e qual branch do parser foi escolhido

**2. Adicionar fallback com leitura direta de células (raw cell access)**
- Se `sheet_to_json` não encontrar o header, fazer um scan direto usando `sheet[XLSX.utils.encode_cell({r, c})]` para ler células individuais
- Isso contorna qualquer problema de como `sheet_to_json` trata merges em `.xls`
- Scan das primeiras 30 linhas × 50 colunas buscando "Código" e "Nome do empregado"

**3. Resolver merges antes do parsing**
- Ler `sheet['!merges']` e preencher células cobertas com o valor da célula âncora (fill-merges)
- Aplicar isso ANTES de chamar `sheet_to_json`, garantindo que os arrays reflitam o conteúdo visual real
- Isso resolve o problema na raiz: após fill-merges, o `sheet_to_json` produz dados consistentes

**4. Tornar a detecção de "Serviço:" mais robusta para .xls**
- Além de buscar em texto, verificar se há uma célula com valor que começa com número seguido de "-" na mesma linha (ex: "6-MUNICIPIO DE SANTO ANTONIO DA PATRULHA")

### Arquivo: `src/components/ExcelDropzone.tsx`
- Sem alterações necessárias

## Resultado esperado

Após a correção:
- O sistema vai logar exatamente o que está lendo do `.xls`, facilitando debug futuro
- A leitura de células mescladas será resolvida na raiz (fill-merges)
- O fallback de leitura direta garante que mesmo se `sheet_to_json` falhar, as células são encontradas
- O layout da imagem (B SERVICE, Serviço por município, Empregados/Contribuintes) será importado corretamente

