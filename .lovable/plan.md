

# Relatório de funcionários não processados e diagnóstico

## Análise do fluxo atual

Após ler todo o código, identifiquei o fluxo e os pontos de perda:

```text
ETAPA 1: Extração (holerites)
  300 páginas → extractEmployeeName() → N nomes extraídos
  ↓ possível perda: páginas sem nome reconhecível (OCR falho, formato diferente)

ETAPA 2: Pré-extração (comprovantes)
  M páginas → extractFavorecidoNames() → K nomes de FAVORECIDO extraídos
  ↓ possível perda: páginas sem label FAVORECIDO/BENEFICIARIO

ETAPA 3: Matching (cruzamento)
  N nomes de holerite × K nomes de comprovante → matchNameDirect()
  ↓ possível perda: primeiro/último nome diferente, nome não extraído do comprovante

ETAPA 4: Geração de PDF
  Apenas pares matched → PDF gerado (149 de ~300)
```

**Causa raiz provável**: O matching exige que o nome esteja presente como FAVORECIDO/BENEFICIARIO no comprovante (`findNameInPreparedPage` linha 641-654 retorna `false` se não encontrar nenhum favorecido match). Se o comprovante não tem o label, ou o OCR não o extraiu, ou o nome está ligeiramente diferente → sem match.

O diagnóstico existente (linhas 1214-1306) já loga motivos, mas:
- Não mostra TODOS os não-processados (apenas 10-15 amostras)
- Não gera relatório estruturado completo
- Não distingue "sem comprovante" de "comprovante existe mas nome não bateu"

## Alterações propostas

### `src/hooks/useDocumentProcessor.ts`

1. **Expandir diagnóstico completo** (após o matching, linhas ~1214-1306):
   - Gerar relatório de TODOS os funcionários não processados (não apenas 10-15 amostras)
   - Para cada não-processado, determinar a causa exata:
     - "Nome não encontrado em nenhum comprovante"
     - "Nome está no texto mas não extraído como FAVORECIDO"
     - "Primeiro nome diverge (ex: DIOVANA vs GIOVANA)"
     - "Último sobrenome diverge"
     - "Nome extraído do holerite pode estar incorreto (OCR)"
   - Incluir o match mais próximo encontrado (closest candidate)

2. **Adicionar log estruturado final** com formato de relatório:
   ```
   ===== RELATÓRIO DE PROCESSAMENTO =====
   Total extraído dos holerites: X
   Total de FAVORECIDOS nos comprovantes: Y
   Total matched: Z
   Total não processados: W
   
   FUNCIONÁRIOS NÃO PROCESSADOS:
   1. NOME COMPLETO | Motivo: ... | Candidato mais próximo: ...
   2. ...
   ```

3. **Cruzamento completo**: Para cada não-processado, verificar:
   - Se o nome normalizado aparece no texto completo do comprovante (substring)
   - Se aparece como FAVORECIDO mas com primeiro/último nome diferente
   - Mostrar o candidato FAVORECIDO mais parecido (por palavras compartilhadas)

4. **Toast final aprimorado** com contagem de não-processados

### Não será alterado
- Lógica de matching (já está correta para evitar falsos positivos)
- UI/componentes
- Funcionalidades não relacionadas

## Resultado esperado

No console do navegador, após cada processamento, aparecerá um relatório completo e estruturado com:
- Contagem por etapa (importação → extração → matching → geração)
- Lista nominal completa dos não processados
- Motivo individual de falha
- Candidato mais próximo encontrado nos comprovantes

