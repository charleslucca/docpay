

# Simplificar painel de "zero correspondências"

## Objetivo

Remover o painel de diagnóstico detalhado (métricas OCR, botão de reprocessar com OCR reforçado) quando nenhuma correspondência é encontrada. Substituir por uma mensagem simples informando que não encontrou correspondências e orientando o usuário a reiniciar o processo.

## Alterações em `src/components/ProcessingStatus.tsx`

Substituir o bloco `{isZeroMatchesState && ...}` (linhas 102-175) por uma versão simplificada:

- Manter o `Card` com borda destrutiva
- Exibir apenas: icone de alerta + mensagem "Nenhuma correspondência foi encontrada."
- Texto de orientação: "Verifique se os arquivos enviados estão corretos e tente novamente."
- Manter apenas o botão "Reiniciar" (`onReset`) para o usuário refazer o processo
- Remover: métricas OCR (páginas totais, OCR, vazias, timeouts), botão "Reprocessar com OCR reforçado"
- Remover prop `onReprocessEnhanced` da interface (e usos no componente pai, se houver)

| Arquivo | Alteração |
|---------|-----------|
| `src/components/ProcessingStatus.tsx` | Simplificar painel zero matches, remover métricas e botão reprocessar |

