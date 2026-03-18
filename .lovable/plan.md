

## Diagnóstico

O bug está nas linhas 852-859. Quando uma célula contém "Serviço:" e o valor está vazio, o código procura a **próxima célula não-vazia** na linha. Porém, se a próxima célula também contiver "Serviço:" (o que acontece neste layout — a planilha tem "Serviço:" repetido em múltiplas colunas na mesma linha), o `servicoValue` é setado como `"Serviço:"` literalmente.

Resultado:
- `currentContrato = "Serviço:"` 
- `isServicoMunicipio("Serviço:")` retorna `true` (a string tem >= 3 chars e não parece empresa)
- `extractCidadeFromServico("Serviço:")` retorna `"Serviço:"` como cidade

Isso explica exatamente a imagem: todas as linhas mostram "Serviço:" em CIDADE e CONTRATO.

## Correção — Arquivo: `src/lib/excelUtils.ts`

### 1. Filtrar células "Serviço:" ao buscar o valor (linhas 852-859)
- Ao procurar a próxima célula não-vazia após "Serviço:", **pular células** que também contenham "Serviço:" ou "Serviço"
- Isso garante que o código encontre o valor real (ex: "8-MUNICIPIO DE CACHOEIRA DO SUL")

### 2. Proteger `isServicoMunicipio` contra o valor literal "Serviço:"
- Adicionar guard no início: se o valor normalizado for apenas "SERVICO" ou "SERVICO:", retornar `false`
- Isso evita que "Serviço:" sozinho seja tratado como nome de município

### 3. Proteger `extractCidadeFromServico` 
- Se o valor passado for vazio ou "Serviço:" literal, retornar string vazia

### 4. Melhorar fallback (linhas 876-888)
- No regex do `fullRowText`, o `.+` após "Serviço:" pode capturar outro "Serviço:" concatenado
- Limpar o valor capturado removendo ocorrências de "Serviço:" residuais

Resultado: cidade e contrato passarão a mostrar os valores reais (ex: "CACHOEIRA DO SUL" e "8-MUNICIPIO DE CACHOEIRA DO SUL").

