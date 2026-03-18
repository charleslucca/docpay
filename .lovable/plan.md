

# Correção: 67 PDFs em vez de 70 — Matches válidos sendo rejeitados

## Diagnóstico

As correções anteriores (word boundary + conflict resolution) foram excessivamente agressivas, removendo 6 matches em vez de apenas 3. Resultado: 73 → 67 (deveria ser 70). Há duas causas:

### Causa 1: Word boundary muito restritivo (substring fallback)
A validação na linha 988 de `pdfUtils.ts` exige que o caractere **após** o nome seja exatamente um espaço (`charAfter === " "`). No texto normalizado do comprovante, o nome pode ser seguido por outros delimitadores válidos — fim de string, quebra de texto processado, ou simplesmente `undefined`. O check atual rejeita matches legítimos quando o nome aparece no final de um bloco de texto ou é seguido por caracteres não-espaço.

### Causa 2: FAVORECIDO encontrado mas `matchNameDirect` rejeita (threshold 0.85)
O badge "Match rejeitado" no relatório aparece quando `foundAsFavorecido: true` — o nome foi extraído do rótulo FAVORECIDO/BENEFICIÁRIO no comprovante, mas `matchNameDirect` retorna `false` porque o score fica entre 0.70-0.84. Isso ocorre com variações sutis de nome (abreviações, caracteres OCR, nomes truncados no PDF bancário).

## Correções

### 1. Relaxar word boundary no substring (`src/lib/pdfUtils.ts`)
- Aceitar match quando `charBefore` é espaço ou início de texto
- Para `charAfter`, aceitar espaço, fim de texto, dígitos, e pontuação comum (`:`, `/`, `,`)  
- Isso corrige substring matches válidos que estavam sendo rejeitados

### 2. Reduzir threshold para FAVORECIDO matches (`src/lib/pdfUtils.ts`)
- Na função `findNameInPreparedPage`, quando o nome é extraído de um rótulo FAVORECIDO (alta confiança de contexto), usar threshold de **0.78** em vez de 0.85
- Isso é seguro porque o contexto FAVORECIDO já garante que estamos comparando com o nome do beneficiário real da transação
- Adicionar log quando um match FAVORECIDO é aceito com score entre 0.78-0.85

### 3. Manter conflict resolution intacta
- A lógica de resolução de conflitos por página está correta e necessária
- Não será alterada

## Arquivos Alterados
- `src/lib/pdfUtils.ts` — funções `findNameInPreparedPage` (word boundary + threshold FAVORECIDO)

## Resultado Esperado
67 → 70 PDFs. Os 3 matches legítimos serão restaurados sem reintroduzir os falsos positivos.

