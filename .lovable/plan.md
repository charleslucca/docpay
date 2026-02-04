
# Plano: Download Automático de PDFs Após Geração

## Objetivo

Fazer com que cada PDF gerado seja baixado automaticamente para o computador do usuário, permitindo consulta posterior sem depender do navegador.

---

## Situação Atual

Atualmente, quando os PDFs são gerados:
1. O sistema cria um `Blob` em memória
2. Gera uma URL temporária (`blobUrl`) 
3. Armazena em `generatedDocs` (estado React)
4. O usuário precisa clicar manualmente em "Download" para cada arquivo

**Problema:** Se a página for recarregada, todos os documentos são perdidos.

---

## Solução Proposta

Modificar a função `generatePdfs` para:
1. Gerar o PDF normalmente
2. **Baixar automaticamente** o arquivo para o computador do usuário
3. Opcionalmente mostrar uma notificação de sucesso

### Fluxo Atualizado

```text
Usuário clica "Gerar PDFs"
         │
         ▼
┌─────────────────────────────────────────┐
│ Para cada par correspondido:           │
│ 1. Gerar PDF combinado (createCombinedPdf)
│ 2. Criar link de download              │
│ 3. Disparar download automático        │
│ 4. Mostrar progresso                   │
└─────────────────────────────────────────┘
         │
         ▼
Arquivos baixados para pasta de Downloads:
  📁 Downloads/
     ├── 2026_Janeiro_ANA_BEATRIZ.pdf
     ├── 2026_Janeiro_CARLOS_SILVA.pdf
     └── 2026_Janeiro_MARIA_SANTOS.pdf
```

---

## Arquivos a Modificar

| Arquivo | Alteração |
|---------|-----------|
| `src/hooks/useDocumentProcessor.ts` | Adicionar download automático na função `generatePdfs` |

---

## Mudanças no Código

### `useDocumentProcessor.ts` - Função `generatePdfs`

Adicionar função de download automático e chamá-la após cada PDF gerado:

```typescript
// Nova função utilitária para download automático
const triggerDownload = (blobUrl: string, fileName: string) => {
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// Dentro de generatePdf (linha ~846-872):
const pdfBlob = await createCombinedPdf(...);
const blobUrl = URL.createObjectURL(pdfBlob);
const fileName = `${year}_${monthName}_${pair.employeeName.replace(/\s+/g, '_')}.pdf`;

// NOVO: Download automático
triggerDownload(blobUrl, fileName);

// ... resto do código existente
```

### Intervalo Entre Downloads

Para evitar que o navegador bloqueie múltiplos downloads rápidos, adicionar um pequeno delay:

```typescript
// Aguardar 300ms entre cada download para evitar bloqueio do navegador
await new Promise(resolve => setTimeout(resolve, 300));
```

---

## Detalhes Técnicos

### Limitações dos Navegadores

1. **Bloqueio de popups:** Alguns navegadores podem bloquear downloads em sequência muito rápida. O delay de 300ms mitiga isso.

2. **Pasta de destino:** Os arquivos vão para a pasta padrão de Downloads do navegador. O usuário pode alterar nas configurações do navegador.

3. **Confirmação:** O Chrome/Edge geralmente não pedem confirmação para downloads múltiplos do mesmo site após os primeiros.

### Organização dos Arquivos

Os arquivos seguem o padrão existente:
- **Formato:** `ANO_MES_NOME.pdf`
- **Exemplo:** `2026_Janeiro_MARIA_SILVA.pdf`

O usuário pode organizar manualmente em pastas no computador após o download.

---

## Notificação ao Usuário

Após todos os downloads, mostrar um toast informativo:

```typescript
toast({
  title: "Downloads concluídos",
  description: `${validDocs.length} arquivo(s) baixado(s) para sua pasta de Downloads`,
});
```

---

## Resultado Esperado

1. Ao clicar em "Gerar PDFs", cada documento é baixado automaticamente
2. Os arquivos ficam salvos permanentemente no computador do usuário
3. Organização por nome com padrão `ANO_MES_NOME.pdf`
4. Feedback visual do progresso e conclusão
5. Sistema continua mostrando os documentos no "Repositório" para referência rápida durante a sessão

---

## Considerações

- **Privacidade mantida:** Os documentos são gerados localmente e baixados diretamente, sem envio para servidores
- **Backup permanente:** Os arquivos ficam no computador do usuário, não dependendo do navegador
- **Simplicidade:** Não requer configuração adicional ou armazenamento no navegador
