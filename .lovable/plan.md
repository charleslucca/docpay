
Diagnóstico

O problema está antes da sincronização com o banco. Pelos logs, o fluxo está caindo no parser antigo de “abas por município”:

```text
[Excel] Parsed 0 sheets: 0 employees...
[Excel] Parse error: Nenhum funcionário encontrado na planilha
```

Isso mostra que o sistema não reconheceu a planilha como “Relação da Folha por Empregado”. Como você confirmou que existem variações do relatório, a detecção atual está rígida demais:
- procura sinais só nas primeiras linhas
- depende de nomes/cabeçalhos muito específicos
- separa “detectar” e “parsear”, então qualquer variação pequena faz o arquivo cair no fluxo errado
- o parser numérico ainda é frágil para formatos como `1.234,56`

Plano de correção

1. Tornar a detecção do relatório realmente flexível
- parar de depender só do `isPayrollReport()` atual
- varrer toda a área útil da planilha, não apenas as primeiras 20 linhas
- detectar o layout por combinação de sinais:
  - cabeçalho com “Código” + “Nome do empregado”
  - colunas financeiras conhecidas
  - linhas de agrupamento com “Serviço:”
  - título “Relação da Folha” quando existir

2. Unificar detecção e análise do layout
- criar uma análise única do sheet que devolve:
  - linha do cabeçalho
  - mapa de colunas encontradas
  - empresa identificada
  - indícios de blocos “Serviço:”
- o `parseExcelFile()` vai tentar esse analisador primeiro
- só cai para os formatos antigos se o layout novo realmente não estiver presente

3. Aceitar variações reais do `.xls`
- suportar aliases extras para cabeçalhos
- aceitar código do funcionário vindo como número, texto, com espaços ou `.0`
- localizar “Serviço:” em qualquer célula da linha
- não exigir posição fixa de colunas

4. Corrigir parsing de valores monetários
- substituir o parse atual por um parser locale-aware
- aceitar:
  - `1.234,56`
  - `1234,56`
  - `1,234.56`
  - valores com `R$`, espaços ou separadores mistos

5. Melhorar erro e logging
- quando o layout novo for reconhecido mas faltar coluna/chave, retornar erro útil em vez de “Nenhum funcionário encontrado”
- logs seguros, sem expor valores salariais, mostrando apenas:
  - linha de cabeçalho detectada
  - colunas encontradas
  - quantidade de blocos/linhas válidas

Arquivos que serão alterados

1. `src/lib/excelUtils.ts`
- refatorar a detecção do relatório
- criar análise dinâmica do layout
- tornar o `parsePayrollReport()` robusto para variações
- melhorar parsing numérico
- ajustar o `parseExcelFile()` para tentar o formato novo antes dos legados de forma mais confiável

2. `src/components/ExcelDropzone.tsx`
- ajuste mínimo apenas para exibir mensagens de erro mais claras se o parser identificar o layout mas não conseguir mapear colunas suficientes

O que não será alterado
- banco de dados
- sincronização com Supabase
- telas administrativas
- fluxo de PDFs

Resultado esperado

Depois da correção, o sistema deve:
- reconhecer automaticamente as variações do relatório `.xls`
- ler a planilha mesmo com diferenças pequenas no cabeçalho/posicionamento
- importar os funcionários sem cair no parser antigo por engano
- mostrar erro específico quando houver uma variação realmente fora do padrão
