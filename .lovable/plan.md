

# Plano: Seção "Relatórios" no menu lateral + Dashboard

## Resumo

Mover o "Histórico" para uma página dedicada (`/relatorios/historico`), criar uma página de Dashboard (`/relatorios/dashboard`), e adicionar a seção "Relatórios" no menu lateral.

## Alterações

### 1. Nova página: `src/pages/Dashboard.tsx`
- Cards com métricas dinâmicas via Supabase:
  - Total de funcionários ativos (`funcionarios` where `ativo = true`)
  - Total de empresas (`empresas` count)
  - Total de municípios (`municipios` count)
  - Último processamento (data mais recente de `processing_history`)
  - Total de PDFs gerados (soma de `pdf_count` em `processing_history`)
  - Taxa de sucesso (% de funcionários processados vs não processados, calculado dos `unprocessed_data`)
- Layout responsivo com grid de cards usando componentes existentes (Card, Badge)
- Ícones visuais e cores para cada métrica

### 2. Nova página: `src/pages/Historico.tsx`
- Extrair o conteúdo de `ProcessingHistory` que hoje vive dentro de `Index.tsx` (o bloco `showRepository`) para uma página standalone
- Reutiliza o componente `ProcessingHistory` já existente

### 3. Atualizar `src/components/AppLayout.tsx`
- Adicionar seção "Relatórios" no menu lateral com ícone `BarChart3`:
  - "Dashboard" → `/relatorios/dashboard`
  - "Histórico" → `/relatorios/historico`
- Visível para todos os usuários autenticados (não restrito a admin)

### 4. Atualizar `src/App.tsx`
- Adicionar rotas protegidas:
  - `/relatorios/dashboard` → `Dashboard`
  - `/relatorios/historico` → `Historico`

### 5. Atualizar `src/pages/Index.tsx`
- Remover o estado `showRepository` e todo o bloco condicional que renderiza o histórico inline
- Remover o botão "Histórico" do topo e do final da página
- Manter toda a lógica de processamento intacta

