

# Reorganizar tela principal em fluxo por etapas (wizard)

## Estrutura proposta

Substituir o layout atual (tudo visivel ao mesmo tempo) por um stepper horizontal com 4 etapas:

```text
 ┌─────────────┐   ┌─────────────┐   ┌──────────────┐   ┌──────────────┐
 │ 1. Planilha │──▶│ 2. Arquivos │──▶│ 3. Processar │──▶│ 4. Resultado │
 └─────────────┘   └─────────────┘   └──────────────┘   └──────────────┘
```

**Etapa 1 - Planilha Excel**: Upload da planilha com dados de empresa, municipio, funcionario e valor. So avanca quando a planilha estiver carregada e sincronizada. Exibe resumo (qtd funcionarios, empresas, cidades).

**Etapa 2 - Upload de PDFs**: Duas areas lado a lado (holerites + comprovantes), identico ao atual. Botoes "Voltar" e "Avançar" (avanca quando ambos tem pelo menos 1 arquivo).

**Etapa 3 - Processamento**: Botao "Iniciar Processamento", barra de progresso (ProcessingStatus), botao de cancelar. Ao concluir matching, mostra matched pairs e botao "Gerar PDFs". Quando geração termina, avança automaticamente para etapa 4.

**Etapa 4 - Resultado**: Mostra matched pairs gerados + link para o Repositorio. Botao "Recomeçar" volta para etapa 1.

**Repositorio**: Permanece acessivel via tab/link no header ou como rota separada, independente do wizard.

## Alteracoes

### Arquivo: `src/pages/Index.tsx`
- Adicionar state `currentStep` (1-4)
- Criar componente `StepIndicator` com 4 passos visuais (circulo numerado + label + linha conectora)
- Renderizar conteudo condicional por step:
  - Step 1: `<ExcelDropzone />` centralizado + botao "Proximo" (habilitado so quando spreadsheetData != null e sync concluido)
  - Step 2: grid com 2 `<FileDropzone />` + botoes "Voltar"/"Proximo"
  - Step 3: botoes de acao + `<ProcessingStatus />` + `<MatchedPairCard />` grid + botao cancelar
  - Step 4: resumo final + cards gerados + botao "Ver Repositorio" e "Recomeçar"
- Tab `Repositorio` permanece no topo como antes
- Botao "Recomeçar" no header reseta `currentStep` para 1

### Arquivo: `src/components/ExcelDropzone.tsx`
- Remover label "(opcional)" do titulo — agora e obrigatorio como primeira etapa
- Expor status de sync para o pai (callback `onSyncComplete`) para que Index saiba quando habilitar "Proximo"

### Nenhuma alteracao em:
- `FileDropzone`, `ProcessingStatus`, `MatchedPairCard`, `DocumentRepository` — reutilizados como estao
- `useDocumentProcessor` — logica de processamento intacta

## Comportamento UX
- O stepper mostra visualmente qual etapa esta ativa, quais ja foram concluidas
- Navegacao "Voltar" disponivel em etapas 2-4 (exceto durante processamento ativo)
- Animacoes de transicao entre etapas (framer-motion, slide horizontal)
- Em mobile, stepper compacto (so numeros, sem labels)

