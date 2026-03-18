

# Análise de Confiabilidade: Extração e Matching

## Resumo Executivo

O processamento rápido NÃO indica necessariamente falta de confiabilidade. A velocidade se deve ao design otimizado com pré-processamento em memória. A análise abaixo identifica pontos fortes e fragilidades reais.

---

## Pontos Fortes do Sistema Atual

1. **Pré-processamento em lote**: Nomes e páginas são normalizados UMA vez antes do matching (linhas 1055, 1126-1129). Isso explica a velocidade — não é pressa, é eficiência algorítmica.

2. **Matching em 3 camadas** (`findNameInPreparedPage`):
   - FAVORECIDO/BENEFICIÁRIO via regex de labels bancários
   - Substring exata no texto normalizado
   - Word-overlap (70%) com validação de proximidade

3. **Proteção contra falsos positivos**: First-name blocking, lista de sobrenomes comuns, Jaro-Winkler, Levenshtein.

4. **Relatório completo**: Log estruturado de todos os não-processados com categorização de causas.

---

## Fragilidades Identificadas

### 1. Extração de FAVORECIDO depende de labels fixos
A função `extractFavorecidoNames` só encontra nomes que vêm após labels como "FAVORECIDO:", "BENEFICIARIO:", etc. Se o comprovante usar um label diferente (ex: "CREDITADO", "TITULAR DA CONTA", "RECEBEDOR"), o nome não será extraído. O fallback (substring/word-overlap) pode compensar, mas com menor precisão.

**Risco**: Comprovantes de bancos menos comuns ou formatos novos podem ter 0% de extração.

### 2. Substring fallback aceita matches sem validação de contexto
Na linha 918, se o nome normalizado aparece em qualquer lugar do texto da página, é aceito como match. Isso pode gerar falso positivo se o nome aparecer em um contexto não relacionado (ex: nome de gerente do banco, ou nome do pagador em vez do beneficiário).

**Risco**: Baixo para nomes longos, moderado para nomes curtos/comuns.

### 3. Word-overlap pode dar falso positivo com nomes compartilhando palavras comuns
Apesar da validação de proximidade (regex sequencial), nomes como "MARIA APARECIDA DOS SANTOS" podem coincidir parcialmente com "MARIA JOSE DOS SANTOS" se as palavras aparecerem na mesma página em outra ordem.

**Risco**: Moderado. A exigência de primeiro+último nome mitiga, mas não elimina.

### 4. Sem validação cruzada pós-matching
Após o matching, não há verificação de que cada funcionário foi associado a APENAS UM comprovante. Se o mesmo nome aparecer em duas páginas (ex: pagamento duplicado), ambos seriam aceitos mas apenas o primeiro seria usado (break na linha 1222).

**Risco**: Baixo. O `break` protege contra duplicatas, mas não informa o usuário.

### 5. OCR pode introduzir ruído não detectado
O sistema tolera erros de OCR (0→O, 1→I, 5→S), mas se o OCR produzir caracteres completamente incorretos (ex: "MARI4 S1LVA"), a normalização não corrigirá e o nome falhará silenciosamente.

**Risco**: Depende da qualidade dos scans. Para PDFs nativos (digitais), risco zero.

### 6. Campo `banco` nunca é preenchido no formato atual
O relatório "Relação da Folha por Empregado" não contém dados bancários. O campo existe na interface e no banco de dados mas permanece vazio.

---

## Recomendações de Melhoria

### Prioridade Alta — Aumentar confiabilidade sem alterar estrutura

1. **Adicionar mais labels de extração**: Incluir "CREDITADO", "TITULAR", "RECEBEDOR", "NOME COMPLETO" em `extractFavorecidoNames` para cobrir mais formatos bancários.

2. **Log de confiança por match**: Adicionar o `score` e `method` de cada match ao relatório final (não apenas para os não-processados). Isso permite auditoria: "140 matches por favorecido (alta confiança), 5 por substring (média), 1 por word-overlap (baixa)".

3. **Validação de duplicatas**: Após o matching, verificar se algum nome de funcionário foi associado a mais de um comprovante (ou vice-versa) e sinalizar como "possível duplicata".

### Prioridade Média — Melhorias de robustez

4. **Restringir substring match**: Exigir que o substring match ocorra dentro de um contexto de label bancário (próximo a "FAVORECIDO", "VALOR", "CPF"), não em qualquer lugar da página.

5. **Adicionar validação por CPF**: Se o CPF estiver disponível tanto no holerite quanto no comprovante, usá-lo como confirmação adicional do match (não como critério primário, mas como boost de confiança).

6. **Score mínimo configurável**: Permitir ao usuário ajustar o threshold de matching (atualmente fixo em 0.85) para cenários onde precisão é mais importante que cobertura.

### Prioridade Baixa — Nice to have

7. **Exportação de relatório de auditoria**: Gerar um CSV/PDF com TODOS os matches (não só os não-processados), incluindo score, método, e página do comprovante. Isso torna o processo auditável.

8. **Detecção de comprovantes sem nenhum match**: Sinalizar páginas de comprovante que não foram associadas a nenhum funcionário (pode indicar formato não reconhecido).

---

## Conclusão sobre a Velocidade

A velocidade do matching é esperada e não compromete a precisão. O algoritmo opera em O(C × E × P) onde C=comprovantes, E=empregados, P=páginas. Com pré-processamento, cada comparação é uma busca em Set + string.includes(), que são operações O(1) e O(n) respectivamente. Para 146 empregados × 70 páginas = ~10.000 comparações, isso leva milissegundos.

O que PODE comprometer a precisão não é a velocidade, mas sim:
- Qualidade da extração de FAVORECIDO (labels reconhecidos)
- Qualidade do OCR (se aplicável)
- Ambiguidade de nomes curtos/comuns

---

## Plano de Implementação Sugerido

Se aprovado, implementaria as melhorias 1, 2 e 3 (prioridade alta):

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/pdfUtils.ts` | Adicionar labels extras em `extractFavorecidoNames`; adicionar retorno de score/method em `findNameInPreparedPage` |
| `src/hooks/useDocumentProcessor.ts` | Log de confiança por match; detecção de duplicatas pós-matching |
| `src/components/UnprocessedList.tsx` | Mostrar distribuição de métodos de match no resumo |

