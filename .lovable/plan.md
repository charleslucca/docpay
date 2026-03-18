
Diagnóstico atualizado

Do I know what the issue is? Sim.

O problema real não é mais o mapeamento de colunas. Pelos logs:

```text
[Excel] Sheet "Relação da Folha por Empregado": ref=empty, merges=0
```

isso mostra que o `XLSX.read(...)` não está montando a grade da aba. Ou seja:
- a planilha entra no app
- o nome da aba é lido
- mas a aba vem “vazia” para o parser
- por isso `fillMerges`, `sheet_to_json`, detecção de header e fallback por célula nunca conseguem funcionar

Isso é compatível com `.xls` legado (Excel 97-2003) mal interpretado no browser, especialmente em dois cenários:
1. arquivo `.xls` dependente de suporte de codepage legado no SheetJS
2. arquivo “.xls” exportado como HTML/tabela antiga disfarçada de Excel

Arquivos foco
- `src/lib/excelUtils.ts`
- opcionalmente um helper novo para inicializar SheetJS legado, se ficar mais limpo

Plano de correção

1. Corrigir a leitura base do `.xls` antes do parsing
- criar um leitor centralizado do workbook em `excelUtils`
- inicializar suporte a codepages legadas do SheetJS (`set_cptable` + `cpexcel.full.mjs`)
- tentar leitura em camadas:
  - leitura padrão atual por `ArrayBuffer`
  - fallback específico para `.xls` legado com opções de leitura mais tolerantes
  - fallback para conteúdo HTML disfarçado de `.xls` quando detectado no buffer

2. Detectar explicitamente “aba vazia”
- adicionar uma checagem logo após `XLSX.read(...)`:
  - se existir `SheetNames`, mas a sheet estiver sem `!ref` ou sem células úteis, marcar como falha de leitura do formato
- registrar logs claros para separar:
  - “arquivo lido mas layout não reconhecido”
  - “arquivo .xls não foi decodificado corretamente”
  - “sheet vazia / sem grade de células”

3. Só então reutilizar o parser já melhorado
- manter o fluxo atual de:
  - `fillMerges`
  - `analyzeSheetForPayrollLayout`
  - `rawCellScanForHeaders`
  - `parsePayrollReport`
- isso evita refazer a lógica de negócio que já existe; a correção entra antes, na leitura do arquivo

4. Adicionar fallback para `.xls` exportado como HTML
- inspecionar os primeiros bytes/texto do arquivo
- se o conteúdo parecer HTML/XML antigo de Excel, ler nesse modo em vez de tratar como BIFF puro
- isso cobre exportações antigas muito comuns em sistemas brasileiros

5. Melhorar a mensagem final para esse caso
- trocar o erro genérico “Nenhum funcionário encontrado na planilha” por algo específico quando a aba vier vazia na leitura, por exemplo:
  - “A planilha .xls foi aberta, mas o conteúdo não pôde ser decodificado corretamente. Vou tratar o formato Excel 97-2003 legado antes do parser.”
- isso facilita diferenciar falha de leitura de falha de layout

Resultado esperado
- o app deixa de tratar esse caso como “0 funcionários”
- a aba passa a gerar uma grade real de células
- o parser existente volta a ter dados para detectar “Relação da Folha por Empregado”
- o formato da imagem, em Excel 97-2003, passa a importar corretamente ou ao menos retorna um erro técnico preciso em vez de falso “nenhum funcionário”

Observação importante
- o warning de `ref` no `ExcelDropzone` é um problema separado de UI e não explica esse erro de importação
- eu priorizaria primeiro a leitura correta do `.xls`, porque hoje o parser nem chega a enxergar as linhas da planilha
