

# Refatoração do Layout — Step 1 "Enviar Planilha"

O problema é simples: o step 1 usa `max-w-lg` (~32rem/512px), deixando tudo apertado.

## Alterações

### 1. `src/pages/Index.tsx` — Expandir container do Step 1
- Linha 150: trocar `max-w-lg` por `max-w-4xl` (~896px), dando espaço adequado para a tabela e os cards de resumo.

### 2. `src/components/ExcelDropzone.tsx` — Melhorar layout interno

**Tabela de preview (linhas 196-223)**:
- Aumentar altura do ScrollArea de `h-[300px]` para `h-[400px]`
- Adicionar padding nas células (`py-2.5 px-3` em vez de `py-1.5`)
- Aumentar tamanho do texto de `text-xs` para `text-sm` nas células

**Cards de resumo (linhas 357-384)**:
- Aumentar gap de `gap-2` para `gap-4`
- Aumentar padding interno de `p-2` para `p-4`
- Melhorar tipografia: `text-2xl` para os números

**Botões de ação (linhas 231-254)**:
- Aumentar tamanho dos botões de `size="sm"` para `size="default"`
- Manter alinhamento à direita

**Espaçamento geral**:
- Aumentar `space-y-3` para `space-y-5` no container principal (linha 326)
- Aumentar padding do CardContent e CardHeader

**Nome do arquivo (linha 334)**:
- Aumentar `max-w-[200px]` para `max-w-[400px]` no truncate do nome

**Dropzone vazio (linha 426)**:
- Aumentar padding de `p-6` para `p-10`

Nenhuma alteração de lógica — apenas classes CSS e tamanhos.

