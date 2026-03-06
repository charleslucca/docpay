

# Remover cards de correspondências da interface

## O que será feito

Remover completamente a seção "Correspondências Encontradas" (os cards com preview de Holerite/Comprovante) tanto do Step 3 quanto do Step 4. Manter apenas o botão "Gerar PDFs" e os controles de navegação.

## Alterações

### Arquivo: `src/pages/Index.tsx`

1. **Step 3 (linhas 307-323)**: Remover o bloco inteiro que renderiza os `MatchedPairCard` na seção "Correspondências Encontradas".

2. **Step 4 (linhas 367-376)**: Remover o bloco que renderiza os `MatchedPairCard` filtrados por status "completed".

3. **Import**: Remover o import de `MatchedPairCard` (não será mais usado).

O botão "Gerar PDFs" (linhas 272-281) e o `ProcessingStatus` continuam intactos.

