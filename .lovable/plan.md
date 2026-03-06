

# Remover upload ao Storage e criar histórico de processamento

## Resumo

1. **Remover** o upload de PDFs ao bucket `generated-documents` do Supabase Storage (e todo código relacionado)
2. **Remover** a tabela `generated_documents` e o componente `DocumentRepository` (repositório que depende do Storage)
3. **Criar** uma tabela `processing_history` para registrar data, hora e quantidade de PDFs gerados
4. **Inserir** um registro no histórico ao final de cada processamento
5. **Exibir** o histórico na interface

## Alterações

### 1. Migration SQL — criar `processing_history` e dropar `generated_documents`

```sql
CREATE TABLE public.processing_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  pdf_count integer NOT NULL,
  duration_seconds integer,
  month integer,
  year integer,
  month_name text
);

ALTER TABLE public.processing_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own history" ON public.processing_history
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can insert own history" ON public.processing_history
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP TABLE IF EXISTS public.generated_documents;
```

### 2. `src/hooks/useDocumentProcessor.ts`

- **Remover** a função `uploadGeneratedPdf` (linhas 117-172) e a constante `GENERATED_BUCKET`
- **Remover** a chamada `await uploadGeneratedPdf(...)` no loop de geração (linha 1640-1641)
- **Remover** `storagePath`/`publicUrl` dos objetos `generatedDocuments`
- **Adicionar** no final da geração (após ZIP download): inserir registro em `processing_history`

```typescript
await supabase.from("processing_history").insert({
  pdf_count: generatedDocuments.length,
  duration_seconds: Math.round(totalDurationMs / 1000),
  month,
  year,
  month_name: monthName,
});
```

- Atualizar mensagens de toast/status para não mencionar "Supabase"

### 3. `src/components/DocumentRepository.tsx` → Substituir por histórico

Transformar o componente em um **histórico de processamento** que lista os registros da tabela `processing_history` (data/hora, quantidade de PDFs, duração). Sem links para download (já não há arquivos no Storage).

### 4. `src/pages/Index.tsx`

- Atualizar referências ao `DocumentRepository` para mostrar o histórico
- Atualizar textos ("repositório" → "histórico")
- Remover propriedade `documents` do componente (já não existe)

### 5. `src/types/document.ts`

- Remover campos `storagePath` e `publicUrl` de `GeneratedDocument`

## Arquivos alterados

| Arquivo | Alteração |
|---|---|
| Migration SQL | Criar `processing_history`, dropar `generated_documents` |
| `src/hooks/useDocumentProcessor.ts` | Remover upload Storage, adicionar insert histórico |
| `src/components/DocumentRepository.tsx` | Reescrever como lista de histórico |
| `src/pages/Index.tsx` | Atualizar referências e textos |
| `src/types/document.ts` | Remover campos de storage |

