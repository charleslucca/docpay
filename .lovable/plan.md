

# Integração de Planilha: Identificar Empresa e Município por Funcionário

## Objetivo

Adicionar funcionalidade para fazer upload de uma planilha Excel (como a "geral-Empresas-e-funcionarios-SETEMBRO.xlsx") e, após finalizar a extração e criação de PDFs, automaticamente identificar a qual **empresa** e **município** cada funcionário pertence.

---

## Estrutura da Planilha (Aba "Todos")

A Page 1 da planilha contém a estrutura normalizada:

| EMPRESA   | CIDADE           | CONTRATO               | COLABORADOR              |
|-----------|------------------|------------------------|--------------------------|
| B SERVICE | ALEGRETE         | PREFEITURA             | BARBARA LENI PRADO       |
| B SERVICE | CACHOEIRA DO SUL | CEMITERIO VAI COM DEUS | ADRIANA APARECIDA...     |

Colunas necessárias:
- **EMPRESA**: Nome da empresa (ex: "B SERVICE")
- **CIDADE**: Município (ex: "ALEGRETE", "CACHOEIRA DO SUL")
- **COLABORADOR**: Nome do funcionário

---

## Funcionalidades a Implementar

### 1. Upload da Planilha Excel
- Adicionar área de upload para arquivo `.xlsx` na interface
- Posição: Acima das dropzones de holerite/comprovante, ou em aba separada
- Feedback visual mostrando quantos funcionários foram carregados

### 2. Parser de Excel
- Criar utilitário `src/lib/excelUtils.ts` para:
  - Ler arquivo Excel usando biblioteca SheetJS (xlsx)
  - Extrair dados da aba "Todos" ou primeira aba
  - Mapear colunas: EMPRESA, CIDADE, COLABORADOR
  - Retornar lista estruturada de funcionários

### 3. Busca de Funcionário na Planilha
- Função de matching flexível (normalizar acentos, maiúsculas)
- Lidar com variações de nome (ex: "ADRIANA APARECIDA DE FREITAS JARDIM" vs "ADRIANA A. DE FREITAS")
- Retornar `{ empresa, cidade }` ou `null` se não encontrado

### 4. Enriquecer Documentos Gerados
- Após extração de nomes dos holerites, buscar cada nome na planilha
- Adicionar campos `empresa` e `municipio` ao `GeneratedDocument`
- Exibir essa informação no Repositório de Documentos

### 5. Organização por Empresa/Município no Repositório
- Permitir agrupar documentos por empresa ou município
- Adicionar filtros por empresa e município
- Mostrar empresa/município junto ao nome do funcionário

---

## Mudanças Técnicas

### Novos Arquivos

| Arquivo | Descrição |
|---------|-----------|
| `src/lib/excelUtils.ts` | Parser de Excel e busca de funcionários |
| `src/components/ExcelDropzone.tsx` | Componente de upload da planilha |

### Arquivos a Modificar

| Arquivo | Alteração |
|---------|-----------|
| `src/types/document.ts` | Adicionar `empresa?` e `municipio?` ao `GeneratedDocument` e criar tipo `EmployeeRecord` |
| `src/hooks/useDocumentProcessor.ts` | Adicionar estado da planilha, integrar busca após extração |
| `src/components/DocumentRepository.tsx` | Exibir empresa/município, adicionar filtros |
| `src/pages/Index.tsx` | Adicionar dropzone da planilha |

### Dependência Necessária

```bash
npm install xlsx
```

A biblioteca **SheetJS (xlsx)** é leve (~400KB) e permite ler arquivos Excel no navegador sem servidor.

---

## Fluxo de Uso

```text
┌─────────────────────────────────────────────────────────────────┐
│  1. Upload da Planilha Excel                                    │
│     → Carregar "geral-Empresas-e-funcionarios-SETEMBRO.xlsx"    │
│     → Exibir: "854 funcionários carregados"                     │
├─────────────────────────────────────────────────────────────────┤
│  2. Upload de Holerites e Comprovantes (fluxo existente)        │
├─────────────────────────────────────────────────────────────────┤
│  3. Processamento e Extração                                    │
│     → Para cada nome extraído, buscar na planilha               │
│     → Enriquecer com empresa e município                        │
├─────────────────────────────────────────────────────────────────┤
│  4. Geração de PDFs                                             │
│     → Nome do arquivo: Empresa_Municipio_Nome.pdf               │
│     → Ou: Organizar em pastas por empresa no ZIP                │
├─────────────────────────────────────────────────────────────────┤
│  5. Repositório de Documentos                                   │
│     → Exibir: "BARBARA LENI PRADO | B SERVICE - ALEGRETE"       │
│     → Filtrar por empresa ou município                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Interface Proposta

### Área de Upload da Planilha (acima das dropzones)

```
┌────────────────────────────────────────────────────────────────┐
│ 📊 Planilha de Funcionários                                    │
│                                                                │
│ ┌────────────────────────────────────────────────────────────┐ │
│ │  📁 Arraste a planilha Excel aqui ou clique para selecionar│ │
│ │     Suporta .xlsx e .xls                                   │ │
│ └────────────────────────────────────────────────────────────┘ │
│                                                                │
│ ✓ 854 funcionários carregados de "geral-Empresas-SETEMBRO.xlsx"│
│   Empresas: B SERVICE | Cidades: 42                            │
└────────────────────────────────────────────────────────────────┘
```

### Repositório com Empresa/Município

```
┌────────────────────────────────────────────────────────────────┐
│ 📄 Repositório de Documentos                                   │
│                                                                │
│ [Buscar por nome...]  [Empresa ▼]  [Município ▼]  [Ano ▼]     │
│                                                                │
│ ├── Setembro de 2026 (345 arquivos)                           │
│ │   ├── BARBARA LENI PRADO                                     │
│ │   │   B SERVICE • ALEGRETE                                   │
│ │   ├── ADRIANA APARECIDA DE FREITAS JARDIM                   │
│ │   │   B SERVICE • CACHOEIRA DO SUL                           │
│ │   └── ...                                                    │
└────────────────────────────────────────────────────────────────┘
```

---

## Lógica de Matching de Nomes

Como os nomes podem ter variações (acentos, abreviações), a busca será:

1. **Normalização**: Remover acentos, converter para maiúsculas
2. **Matching exato**: Comparar strings normalizadas
3. **Matching parcial**: Se não encontrar exato, usar algoritmo de similaridade
4. **Fallback**: Se não encontrar, marcar como "Empresa não identificada"

```typescript
function findEmployeeInSheet(name: string, records: EmployeeRecord[]): EmployeeRecord | null {
  const normalizedName = normalize(name);
  
  // 1. Matching exato
  const exact = records.find(r => normalize(r.colaborador) === normalizedName);
  if (exact) return exact;
  
  // 2. Matching parcial (primeiro e último nome)
  const [firstName, ...rest] = normalizedName.split(' ');
  const lastName = rest[rest.length - 1] || '';
  
  const partial = records.find(r => {
    const rNorm = normalize(r.colaborador);
    const [rFirst, ...rRest] = rNorm.split(' ');
    const rLast = rRest[rRest.length - 1] || '';
    return rFirst === firstName && rLast === lastName;
  });
  
  return partial || null;
}
```

---

## Resultado Esperado

Após implementação:
- Upload de planilha mostra feedback com contagem de funcionários
- Documentos gerados exibem empresa e município
- Filtros adicionais no repositório por empresa/município
- Nome do arquivo PDF pode incluir empresa/município

