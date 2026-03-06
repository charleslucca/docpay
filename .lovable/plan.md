

# Exibir lista de funcionários não processados na UI

## Problema
O relatório de funcionários não processados existe apenas no `console.log`. O usuário precisa ver essa informação diretamente na interface, integrada ao histórico de processamento.

## Solução
Armazenar o relatório de não-processados em estado React e exibi-lo como uma seção expansível (collapsible) na tela de resultados (step 4) e no histórico.

## Alterações

### 1. `src/types/document.ts`
- Adicionar interface `UnprocessedEmployee` com campos: `name`, `reason`, `closestCandidate`, `foundInFullText`, `foundAsFavorecido`
- Adicionar ao `ProcessingStatus`: campo opcional `unprocessedReport`

### 2. `src/hooks/useDocumentProcessor.ts`
- Após gerar o `unprocessedReport` (linha ~1410), salvar no estado em vez de só logar no console
- Adicionar estado `unprocessedList` ao hook e expô-lo no return
- Persistir resumo (contagem + lista de nomes/motivos) no `processing_history` do Supabase via coluna JSONB nova, OU armazenar localmente no estado do hook para exibição imediata

### 3. Novo componente: `src/components/UnprocessedList.tsx`
- Componente com `Collapsible` que mostra:
  - Header: "X funcionário(s) não processado(s)" com ícone de alerta
  - Conteúdo expandido: tabela com colunas Nome, Motivo, Candidato Próximo
  - Botão para exportar CSV da lista
- Usa cores de alerta (amber/yellow) para destaque sem ser destrutivo

### 4. `src/pages/Index.tsx`
- No step 4 (Resultados), importar e renderizar `<UnprocessedList>` abaixo do resumo de documentos gerados
- Passar `unprocessedList` do hook como prop

### 5. Supabase (opcional, recomendado)
- Adicionar coluna `unprocessed_data` (jsonb, nullable) à tabela `processing_history` para persistir o relatório
- Atualizar o insert no `generatePdfs` para incluir os dados
- Atualizar `ProcessingHistory.tsx` para exibir contagem de não-processados em cada entrada do histórico, com expansão para ver detalhes

## Fluxo
```text
Processamento termina
  → unprocessedReport gerado (já existe)
  → salvo em estado React (novo)
  → exibido em UnprocessedList no step 4 (novo)
  → salvo no processing_history via Supabase (novo)
  → visível no histórico com expand (novo)
```

