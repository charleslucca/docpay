
Objetivo: eliminar a lentidão/travamento na extração (ex.: parando em pág. 112–117) de forma definitiva, sem perder coerência dos nomes no match.

Diagnóstico confirmado (com base no código + logs)
1) O problema principal não é infraestrutura de servidor
- O processamento é 100% local no navegador (OCR/Tesseract + PDF.js no cliente).
- A lentidão observada vem de CPU/memória do browser + lógica de controle do pipeline.

2) Há um bug crítico de timeout no loop de OCR de holerites
- Em `src/hooks/useDocumentProcessor.ts` (função `processHolerite`) existe timeout absoluto de 5 minutos:
  - `MAX_LOOP_WAIT_MS = 300000`
  - quando estoura, o log mostra: `[OCR] Loop timeout - forcing exit after 5 minutes`
- Isso pode acontecer em documentos grandes (691 páginas), mesmo com processamento saudável.
- Depois do break, o `renderLoop` continua renderizando páginas sem OCR consumir a fila (comportamento visto nos logs), causando sensação de travamento e degradação forte.

3) A UI reforça percepção de “parou”
- Durante o primeiro holerite, `status.progress` global quase não avança até concluir o arquivo inteiro (fica próximo de 0%), mesmo OCR estando ativo.

O que será ajustado
1) Corrigir o timeout do pipeline (fix definitivo do travamento)
Arquivo: `src/hooks/useDocumentProcessor.ts`

- Substituir timeout absoluto por watchdog de inatividade real:
  - remover lógica “tempo total da etapa > 5 min”
  - usar `lastActivityAt` (atualizado a cada:
    - página renderizada para fila
    - batch OCR concluído
    - avanço de contadores)
  - só disparar erro se “sem progresso” por um período (ex.: 90–120s), não por duração total do documento.
- Introduzir flag de abort sincronizado do pipeline:
  - quando OCR loop falhar/abortar, parar também render loop (`pipelineAborted`)
  - limpar `canvasQueue` imediatamente para evitar renderização inútil.
- Garantir saída limpa e previsível:
  - em falha real, encerrar pipeline atual com mensagem clara
  - reinicializar worker pool (`terminateOcrWorker`) e retomar apenas páginas pendentes (fallback seguro), mantendo nomes já extraídos.

2) Tornar o OCR mais estável em documentos longos (sem perder qualidade)
Arquivo: `src/hooks/useDocumentProcessor.ts`

- Implementar batch adaptativo para holerite:
  - iniciar com concorrência moderada (ex.: 3–4 jobs por lote, não necessariamente `workerCount` inteiro)
  - reduzir batch automaticamente quando um lote ficar muito lento (ex.: >45s)
  - subir gradualmente quando estabilizar.
- Isso reduz contenção de CPU/memória e evita picos que derrubam throughput em máquinas mais limitadas.

3) Melhorar progressão visual durante extração (anti “travado”)
Arquivos:
- `src/hooks/useDocumentProcessor.ts`
- `src/components/ProcessingStatus.tsx` (ajuste de mensagem, se necessário)

- Atualizar `status.progress` continuamente dentro do OCR de holerite por página/batch:
  - em vez de só atualizar no fim do arquivo, mapear progresso da extração para faixa de 0–40% proporcional ao avanço real das páginas.
- Manter `ocrProgress` como barra secundária (já existe), mas com mensagem contextual clara de avanço real do lote atual.
- Resultado: o usuário vê progresso contínuo e não interpreta como congelamento.

4) Ajuste opcional de performance no upload (para não competir com OCR principal)
Arquivo: `src/lib/pdfUtils.ts` (função `countPagesWithEmployeeName`)

- Reduzir custo da contagem de funcionários durante upload para não disputar recursos:
  - evitar OCR de amostragem pesado nesse momento (modo “rápido” de estimativa)
  - manter OCR completo apenas no processamento principal.
- Benefício: upload + início do processamento ficam mais fluidos.

Sequência de implementação
1. Corrigir controle de timeout/abort do pipeline (passo crítico).
2. Adicionar fallback de recuperação para páginas pendentes após erro real.
3. Implementar batch adaptativo de OCR.
4. Ajustar progresso contínuo da extração.
5. (Opcional) simplificar estimativa no upload para reduzir competição de CPU.

Critérios de aceite
1) Em PDF grande (como o de 691 páginas), não deve mais ocorrer abort por “5 minutos” enquanto há progresso.
2) Não deve existir cenário em que render continua sozinho após OCR parar.
3) Barra principal deve avançar continuamente durante extração de holerites.
4) Tempo total deve cair e, principalmente, não “congelar” em faixas como pág. 112–117.
5) Match mantém coerência: nome do recibo e comprovante continuam validados pela regra atual (`namesEquivalent` + extração por página).

Teste de validação (fim a fim)
1) Upload de holerite grande + comprovante grande.
2) Rodar processamento completo e observar:
- ausência de log `Loop timeout - forcing exit after 5 minutes` em execução normal;
- progresso principal e OCR avançando continuamente;
- conclusão com pares consistentes.
3) Repetir em máquina/rede mais limitada para validar robustez do batch adaptativo.
