

# Otimizacao da Sincronizacao - Processamento em Lote

## Problema Identificado

O codigo atual e extremamente lento porque processa cada funcionario individualmente:

| Operacao | Antes (atual) | Problema |
|----------|---------------|----------|
| Empresas | 1 SELECT + 1 INSERT por empresa | ~2-4 requisicoes |
| Municipios | 1 SELECT + 1 INSERT por municipio | ~42 requisicoes (21 cidades) |
| Funcionarios | 1 SELECT + 1 INSERT por funcionario | ~834 requisicoes (417 funcionarios) |
| Desativacao | 1 UPDATE por funcionario ausente | Variavel |
| **TOTAL** | | **~900+ requisicoes HTTP sequenciais** |

Com latencia media de 100-200ms por requisicao, o tempo total fica entre **2-4 minutos**.

---

## Solucao: Processamento em Lote (Batch Processing)

Substituir operacoes individuais por operacoes em lote, reduzindo de ~900 requisicoes para **~10-15 requisicoes**.

---

## Mudancas Tecnicas

### 1. Buscar Todos os Dados Existentes em Uma Unica Requisicao

```typescript
// ANTES: 21 requisicoes para municipios
for (const municipio of municipios) {
  const { data } = await supabase.from("municipios").select("id").eq("nome_normalizado", municipio);
}

// DEPOIS: 1 requisicao
const { data: allMunicipios } = await supabase.from("municipios").select("id, nome_normalizado");
const municipioMap = new Map(allMunicipios.map(m => [m.nome_normalizado, m.id]));
```

### 2. Inserir Novos Registros em Lote

```typescript
// ANTES: N requisicoes individuais
for (const novo of novos) {
  await supabase.from("funcionarios").insert(novo);
}

// DEPOIS: 1 requisicao para todos
await supabase.from("funcionarios").insert(novos);
```

### 3. Buscar Funcionarios Existentes em Uma Requisicao

```typescript
// ANTES: 417 requisicoes
for (const record of records) {
  const { data } = await supabase.from("funcionarios")
    .select("id, banco, contrato, ativo")
    .eq("empresa_id", empresaId)
    .eq("municipio_id", municipioId)
    .eq("nome_normalizado", nomeNorm)
    .single();
}

// DEPOIS: 1 requisicao
const { data: allExisting } = await supabase
  .from("funcionarios")
  .select("id, empresa_id, municipio_id, nome_normalizado, banco, contrato, ativo");

// Lookup em memoria O(1)
const existingMap = new Map(
  allExisting.map(f => [`${f.empresa_id}|${f.municipio_id}|${f.nome_normalizado}`, f])
);
```

### 4. Processar Updates em Paralelo com Chunks

```typescript
// Dividir em chunks de 50 para evitar timeout
const updateChunks = chunkArray(toUpdate, 50);
await Promise.all(
  updateChunks.map(chunk =>
    Promise.all(chunk.map(item =>
      supabase.from("funcionarios").update(item.data).eq("id", item.id)
    ))
  )
);
```

### 5. Desativar em Lote com IN Clause

```typescript
// ANTES: N requisicoes
for (const id of toDeactivate) {
  await supabase.from("funcionarios").update({ ativo: false }).eq("id", id);
}

// DEPOIS: 1 requisicao
await supabase.from("funcionarios").update({ ativo: false }).in("id", toDeactivate);
```

### 6. Adicionar Feedback de Progresso Detalhado

```typescript
interface SyncProgress {
  stage: 'uploading' | 'syncing-empresas' | 'syncing-municipios' | 'syncing-funcionarios' | 'finalizing';
  message: string;
}

// Callback para atualizar UI
onProgress?: (progress: SyncProgress) => void;
```

---

## Comparacao de Performance

| Metrica | Antes | Depois |
|---------|-------|--------|
| Requisicoes HTTP | ~900+ | ~10-15 |
| Tempo estimado | 2-4 minutos | 2-5 segundos |
| Risco de timeout | Alto | Baixo |
| Feedback visual | "Sincronizando..." | Etapas detalhadas |

---

## Arquivos a Modificar

| Arquivo | Alteracao |
|---------|-----------|
| `src/lib/supabaseExcelSync.ts` | Refatorar para batch processing |
| `src/components/ExcelDropzone.tsx` | Adicionar indicador de progresso por etapa |

---

## Fluxo Otimizado

```text
1. Upload arquivo (1 req)
2. Buscar TODAS empresas existentes (1 req)
3. Inserir empresas novas em lote (1 req)
4. Buscar TODOS municipios existentes (1 req)
5. Inserir municipios novos em lote (1 req)
6. Buscar TODOS funcionarios existentes (1 req)
7. Comparar em memoria (0 req)
8. Inserir funcionarios novos em lote (1 req)
9. Atualizar modificados em paralelo (chunks de 50)
10. Desativar ausentes em lote (1 req)
11. Registrar historico (1 req)

TOTAL: ~10-15 requisicoes
```

---

## Resultado Esperado

- Upload de 417+ funcionarios: **< 5 segundos**
- Feedback claro mostrando cada etapa
- Sem risco de timeout do navegador
- Experiencia fluida para o usuario

