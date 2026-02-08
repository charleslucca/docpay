

# Fluxo de Upload Excel com Persistência no Supabase

## Resumo

Implementar um sistema completo de backend para:
1. Fazer upload de arquivos Excel para Supabase Storage
2. Parsear o conteúdo automaticamente usando a lógica existente
3. Armazenar os dados extraídos em tabelas normalizadas no banco de dados
4. Comparar e atualizar apenas registros modificados
5. Manter histórico de uploads com timestamps

---

## Arquitetura da Solução

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND                                       │
│  ┌──────────────────┐                                                   │
│  │ ExcelDropzone    │──── Upload arquivo .xlsx                          │
│  │ (existente)      │         │                                         │
│  └──────────────────┘         ▼                                         │
│                        ┌──────────────────┐                             │
│                        │ parseExcelFile() │◄── Lógica existente         │
│                        │ (client-side)    │                             │
│                        └────────┬─────────┘                             │
│                                 │                                       │
│                                 ▼                                       │
│                        ┌──────────────────┐                             │
│                        │ syncExcelData()  │◄── Nova função              │
│                        │ (Supabase SDK)   │                             │
│                        └────────┬─────────┘                             │
└─────────────────────────────────┼───────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          SUPABASE                                        │
│                                                                          │
│  ┌─────────────────────┐    ┌─────────────────────────────────────┐    │
│  │ Storage             │    │ Database (PostgreSQL)                │    │
│  │ ├── excel-uploads/  │    │                                      │    │
│  │ │   └── *.xlsx      │    │ ┌─────────────┐  ┌───────────────┐  │    │
│  │ └────────────────   │    │ │  empresas   │  │  municipios   │  │    │
│  └─────────────────────┘    │ └──────┬──────┘  └───────┬───────┘  │    │
│                             │        │                 │          │    │
│                             │        └────────┬────────┘          │    │
│                             │                 ▼                   │    │
│                             │        ┌─────────────────┐          │    │
│                             │        │  funcionarios   │          │    │
│                             │        │ (empresa_id,    │          │    │
│                             │        │  municipio_id,  │          │    │
│                             │        │  nome, cargo,   │          │    │
│                             │        │  banco, ativo)  │          │    │
│                             │        └─────────────────┘          │    │
│                             │                                      │    │
│                             │        ┌─────────────────┐          │    │
│                             │        │ upload_history  │          │    │
│                             │        │ (timestamp,     │          │    │
│                             │        │  file_name,     │          │    │
│                             │        │  stats)         │          │    │
│                             │        └─────────────────┘          │    │
│                             └──────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Schema do Banco de Dados

### Tabela: `empresas`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | uuid (PK) | Identificador único |
| nome | text (UNIQUE) | Nome da empresa |
| nome_normalizado | text | Nome sem acentos para busca |
| created_at | timestamptz | Data de criação |
| updated_at | timestamptz | Última atualização |

### Tabela: `municipios`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | uuid (PK) | Identificador único |
| nome | text (UNIQUE) | Nome do município |
| nome_normalizado | text | Nome sem acentos para busca |
| created_at | timestamptz | Data de criação |

### Tabela: `funcionarios`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | uuid (PK) | Identificador único |
| empresa_id | uuid (FK) | Referência à empresa |
| municipio_id | uuid (FK) | Referência ao município |
| nome | text | Nome completo |
| nome_normalizado | text | Nome sem acentos |
| cargo | text | Cargo/função (opcional) |
| banco | text | Nome do banco (da linha 2) |
| contrato | text | Identificador do contrato/aba |
| ativo | boolean | Se ainda está na planilha |
| created_at | timestamptz | Data de criação |
| updated_at | timestamptz | Última atualização |

**Constraint UNIQUE**: (empresa_id, municipio_id, nome_normalizado)

### Tabela: `excel_upload_history`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | uuid (PK) | Identificador único |
| file_name | text | Nome do arquivo |
| file_path | text | Caminho no Storage |
| uploaded_at | timestamptz | Timestamp do upload |
| total_empresas | int | Empresas encontradas |
| total_municipios | int | Municípios encontrados |
| total_funcionarios | int | Funcionários processados |
| funcionarios_novos | int | Novos inseridos |
| funcionarios_atualizados | int | Registros modificados |
| funcionarios_removidos | int | Marcados como inativos |

---

## Arquivos a Criar/Modificar

### 1. Migração SQL (via Supabase Migration Tool)
Criar as 4 tabelas com índices e RLS policies

### 2. `src/lib/supabaseExcelSync.ts` (novo)
Funções para sincronizar dados com Supabase:
- `syncSpreadsheetToDatabase()` - Orquestra todo o processo
- `upsertEmpresas()` - Insere/atualiza empresas
- `upsertMunicipios()` - Insere/atualiza municípios
- `syncFuncionarios()` - Compara e atualiza funcionários
- `uploadExcelFile()` - Salva arquivo no Storage
- `logUploadHistory()` - Registra histórico

### 3. `src/components/ExcelDropzone.tsx` (modificar)
Adicionar:
- Estado para sincronização (`isSyncing`, `syncStatus`)
- Chamar `syncSpreadsheetToDatabase()` após parse
- Exibir feedback visual do progresso de sync

### 4. `supabase/config.toml` (modificar)
Adicionar bucket de storage para arquivos Excel

---

## Lógica de Comparação e Atualização

```text
Para cada funcionário no Excel:
  1. Normalizar nome (remover acentos, uppercase)
  2. Buscar registro existente por (empresa_id, municipio_id, nome_normalizado)
  3. Se não existe → INSERT
  4. Se existe e dados diferentes → UPDATE (cargo, banco, contrato, updated_at)
  5. Se existe e dados iguais → Nenhuma ação

Após processar todos:
  - Funcionários no banco que NÃO estão no Excel atual → marcar ativo = false
```

---

## Fluxo de Execução

1. **Usuário faz upload** do arquivo Excel
2. **Frontend** parseia localmente com `parseExcelFile()` (lógica existente)
3. **Frontend** exibe resumo (empresas, municípios, funcionários por cidade)
4. **Usuário confirma** ou sistema sincroniza automaticamente
5. **Sistema** faz upload do arquivo para Supabase Storage
6. **Sistema** upsert em `empresas` e `municipios`
7. **Sistema** compara e sincroniza `funcionarios`:
   - Novos → INSERT
   - Modificados → UPDATE
   - Removidos → UPDATE ativo = false
8. **Sistema** registra em `excel_upload_history`
9. **Frontend** exibe resultado (X novos, Y atualizados, Z removidos)

---

## Detalhes Técnicos

### Extração de Dados por Aba

Com base na estrutura atual do parser:
- **Linha 1 (índice 0)**: Nome da empresa
- **Linha 2 (índice 1)**: "MUNICÍPIO - BANCO" (ex: "CARAZINHO - ITAÚ")
- **Linha 3+**: Nomes dos funcionários

O campo `cargo` será extraído da linha 2 se houver um segundo hífen (ex: "CARAZINHO - OPERADOR - ITAÚ").

### RLS Policies

Por enquanto, as tabelas terão acesso público para leitura/escrita (sem autenticação), já que o sistema não requer login. Se autenticação for implementada posteriormente, as policies podem ser refinadas.

### Tratamento de Erros

- Se o upload falhar no Storage, interromper antes de modificar o banco
- Se a sincronização falhar parcialmente, usar transações para rollback
- Exibir mensagens claras de erro no frontend

---

## Arquivos Finais

| Arquivo | Ação |
|---------|------|
| SQL Migration | Criar tabelas via migration tool |
| `src/lib/supabaseExcelSync.ts` | Criar (novo) |
| `src/components/ExcelDropzone.tsx` | Modificar |
| `supabase/config.toml` | Modificar (storage bucket) |

---

## Resultado Esperado

Após a implementação:
1. Upload da planilha dispara sincronização automática
2. Dados são persistidos em tabelas normalizadas
3. Histórico de uploads é mantido
4. Uploads subsequentes atualizam apenas registros modificados
5. A base de dados fica pronta para geração de relatórios PDF

