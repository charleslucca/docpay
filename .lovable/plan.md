
# Plano: Exibir Contagem de Funcionários Após Upload

## Objetivo

Mostrar a quantidade estimada de funcionários encontrados nos arquivos PDF logo após o upload, antes mesmo de iniciar o processamento completo.

## Contexto

Atualmente, ao fazer upload de arquivos:
- O sistema apenas lista os arquivos com nome e status
- O usuário não sabe quantas páginas (funcionários) existem nos PDFs
- A contagem só aparece após o processamento OCR completo

## Solução Proposta

Adicionar uma **contagem rápida de páginas** imediatamente após o upload. Como cada página de um holerite contém um funcionário, a contagem de páginas serve como estimativa de funcionários.

## Arquitetura da Solução

```text
┌─────────────────────────────────────────────────────────────────┐
│                    FLUXO DE CONTAGEM                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Upload do PDF                                                │
│           │                                                      │
│           ▼                                                      │
│  2. getCachedPdf(file) → pdf.numPages                           │
│           │                                                      │
│           ▼                                                      │
│  3. Atualiza UploadedFile com:                                  │
│     • pageCount: number                                          │
│     • estimatedEmployees: number                                │
│           │                                                      │
│           ▼                                                      │
│  4. FileDropzone exibe:                                         │
│     "📄 RECIBO.pdf (691 págs • ~691 func.)"                     │
│                                                                  │
│  5. Resumo total abaixo do dropzone:                            │
│     "📊 Total: 3 arquivos • ~750 funcionários"                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Mudanças a Implementar

### Mudança 1: Atualizar Tipo UploadedFile

**Arquivo:** `src/types/document.ts`

Adicionar campos para contagem de páginas:

```typescript
export interface UploadedFile {
  // ... campos existentes
  pageCount?: number;           // Número total de páginas do PDF
  estimatedEmployees?: number;  // Estimativa de funcionários (= pageCount para holerites)
}
```

### Mudança 2: Contar Páginas Após Upload

**Arquivo:** `src/hooks/useDocumentProcessor.ts`

Modificar a função `addFiles` para:
1. Criar os arquivos normalmente
2. Em paralelo, contar as páginas de cada PDF
3. Atualizar o estado com a contagem

```typescript
const addFiles = useCallback(async (files: File[], type: 'holerite' | 'comprovante') => {
  const newFiles: UploadedFile[] = files.map((file) => ({
    id: generateId(),
    file,
    name: file.name,
    type,
    status: 'pending',
    progress: 0,
    pageCount: undefined, // Será preenchido após contagem
  }));

  // Adicionar arquivos imediatamente (UX responsiva)
  if (type === 'holerite') {
    setHolerites((prev) => [...prev, ...newFiles]);
  } else {
    setComprovantes((prev) => [...prev, ...newFiles]);
  }

  // Contar páginas em background (paralelo)
  for (const uploadedFile of newFiles) {
    try {
      const pdf = await getCachedPdf(uploadedFile.file);
      const pageCount = pdf.numPages;
      
      // Atualizar com contagem
      const setter = type === 'holerite' ? setHolerites : setComprovantes;
      setter((prev) => prev.map((f) => 
        f.id === uploadedFile.id 
          ? { ...f, pageCount, estimatedEmployees: pageCount }
          : f
      ));
    } catch (error) {
      console.warn(`[PageCount] Erro ao contar páginas de ${uploadedFile.name}:`, error);
    }
  }
}, []);
```

### Mudança 3: Exibir Contagem no FileDropzone

**Arquivo:** `src/components/FileDropzone.tsx`

Adicionar exibição da contagem de páginas por arquivo e resumo total:

```tsx
// Dentro de cada item de arquivo:
<div className="flex-1 min-w-0">
  <p className="text-sm font-medium truncate">{file.name}</p>
  {file.pageCount && (
    <p className="text-xs text-muted-foreground">
      {file.pageCount} {file.pageCount === 1 ? 'página' : 'páginas'} 
      • ~{file.estimatedEmployees} funcionário(s)
    </p>
  )}
  {/* ... resto do código */}
</div>

// Após a lista de arquivos, mostrar resumo total:
{files.length > 0 && (
  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground pt-2 border-t">
    <Users className="h-4 w-4" />
    <span>
      Total: {files.length} arquivo(s) • 
      ~{files.reduce((sum, f) => sum + (f.estimatedEmployees || 0), 0)} funcionário(s)
    </span>
  </div>
)}
```

## Arquivos a Modificar

| Arquivo | Alteração |
|---------|-----------|
| `src/types/document.ts` | Adicionar `pageCount` e `estimatedEmployees` ao tipo |
| `src/hooks/useDocumentProcessor.ts` | Modificar `addFiles` para contar páginas |
| `src/components/FileDropzone.tsx` | Exibir contagem por arquivo e total |

## Detalhes Técnicos

### Performance
- A contagem usa `getCachedPdf` que já está em cache se o arquivo foi aberto antes
- Apenas lê os metadados do PDF (muito rápido, ~50ms por arquivo)
- Não executa OCR ou renderização nesta etapa

### Precisão
- Para **holerites**: 1 página = 1 funcionário (alta precisão)
- Para **comprovantes**: 1 página pode conter múltiplos comprovantes (é uma estimativa)
- A contagem mostra "~" para indicar que é aproximada

### Estados de Loading
Durante a contagem, mostrar um indicador sutil:

```tsx
{file.pageCount === undefined ? (
  <p className="text-xs text-muted-foreground flex items-center gap-1">
    <Loader2 className="h-3 w-3 animate-spin" />
    Contando páginas...
  </p>
) : (
  <p className="text-xs text-muted-foreground">
    {file.pageCount} páginas • ~{file.estimatedEmployees} funcionário(s)
  </p>
)}
```

## Interface Esperada

```text
┌─────────────────────────────────────────────────────────────────┐
│  📤 Holerites                                                    │
│  Recibos de pagamento dos funcionários                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐                                                   │
│  │  Upload  │  Arraste arquivos PDF aqui                        │
│  └──────────┘  ou clique para selecionar                        │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  📄 RECIBO B SERVICE 08 AGOSTO 2025.pdf          ✓             │
│     691 páginas • ~691 funcionários                             │
│                                                                  │
│  📄 RECIBO B SERVICE 07 JULHO 2025.pdf           ✓             │
│     650 páginas • ~650 funcionários                             │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  👥 Total: 2 arquivos • ~1341 funcionários                      │
└─────────────────────────────────────────────────────────────────┘
```

## Resultado Esperado

1. Feedback imediato após upload mostrando quantidade de páginas
2. Estimativa visual de funcionários antes do processamento
3. Resumo total para planejamento do tempo de processamento
4. Experiência de usuário mais informativa e transparente
