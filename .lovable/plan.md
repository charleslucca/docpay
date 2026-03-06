
Resumo simples
1) Confirmei pela imagem o erro crítico: o holerite está em nome de DIOVANA DA SILVA e o comprovante em GIOVANA SIDES DA SILVA, mas o sistema juntou os dois.
2) Também identifiquei por que o nome do arquivo pode sair com empresa errada: o enriquecimento de empresa/cidade/contrato está permissivo e pode “cair” em registro de outro colaborador/empresa.
3) Vou priorizar precisão total (evitar falso positivo), mesmo que alguns casos passem a ficar sem match automático.

Diagnóstico técnico (causas raiz)
- src/lib/pdfUtils.ts → matchNameDirect():
  - hoje aceita Levenshtein <= 1 no primeiro nome.
  - isso permite DIOVANA ↔ GIOVANA.
- src/lib/excelUtils.ts → findEmployeeInSpreadsheet():
  - possui fallback por overlap/partial (compartilhamento de palavras e prefixo de sobrenome), o que pode retornar colaborador de outra empresa.
- src/hooks/useDocumentProcessor.ts → generatePdfs():
  - dbLookup é Map por nome_normalizado único; se houver homônimo/ambiguidade, pode sobrescrever e puxar metadado incorreto.
- No matching atual, não há bloqueio explícito de ambiguidade entre candidatos muito parecidos.

Plano de implementação (assertivo para múltiplos documentos)
1) Endurecer matching de nomes (regressão DIOVANA/GIOVANA)
- Arquivo: src/lib/pdfUtils.ts
- Ajustar matchNameDirect para:
  - exigir primeiro nome EXATO normalizado (sem fuzzy no primeiro token);
  - exigir último sobrenome exato;
  - fuzzy apenas em nomes intermediários, com tolerância menor;
  - rejeitar quando houver divergência no primeiro nome.
- Adicionar teste de regressão explícito:
  - target: DIOVANA DA SILVA
  - candidate: GIOVANA SIDES DA SILVA
  - resultado esperado: false.

2) Introduzir regra de ambiguidade no match
- Arquivos: src/lib/pdfUtils.ts e src/hooks/useDocumentProcessor.ts
- Ao avaliar favorecidos por página:
  - aceitar match apenas quando houver candidato único e claramente válido;
  - quando houver empate/ambiguidade, não parear automaticamente (fail-safe).
- Resultado: reduz pareamento incorreto em lotes grandes.

3) Corrigir enriquecimento de empresa/cidade/contrato para nome de arquivo
- Arquivos: src/lib/excelUtils.ts e src/hooks/useDocumentProcessor.ts
- Separar “matching para metadado” do matching geral:
  - para metadado, usar apenas critérios estritos (exato normalizado; no máximo first+last exato quando único).
  - remover fallback permissivo por overlap/partial para naming.
- No fallback de banco:
  - trocar Map<string, único> por estrutura que preserve múltiplos candidatos por nome;
  - só usar dado de DB quando houver 1 candidato inequívoco;
  - se ambíguo, usar placeholders (EMPRESA/CIDADE/CONTRATO) em vez de empresa errada.

4) Robustez de detecção de colunas da planilha
- Arquivo: src/lib/excelUtils.ts
- Implementar busca de cabeçalho em 3 níveis (exact → startsWith → contains) com normalização e aliases para EMPRESA/CIDADE/CONTRATO/COLABORADOR.
- Evita mapear coluna errada em planilhas com variações de cabeçalho.

5) Observabilidade e feedback
- Arquivo: src/hooks/useDocumentProcessor.ts
- Adicionar contadores/logs:
  - matches bloqueados por ambiguidade;
  - PDFs com metadado em placeholder por falta de match seguro.
- Toast final com resumo de precisão (sem “adivinhar” empresa).

Validação (antes de concluir)
- Cenário 1: lote com DIOVANA e GIOVANA no mesmo processamento → nunca cruzar.
- Cenário 2: colaborador com homônimo em empresas diferentes → nome de arquivo não deve puxar empresa errada; se ambíguo, placeholder.
- Cenário 3: planilha com cabeçalho variante (ex.: EMPRESA CONVENIADA) → coluna correta detectada.
- Testes unitários:
  - matchNameDirect (casos positivos/negativos críticos),
  - resolver de metadados (único vs ambíguo),
  - detector de colunas flexível.
