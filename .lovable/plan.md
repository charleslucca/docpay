
# Correção: Parser de Excel para Múltiplas Abas por Município

## Problema Identificado

O código atual só lê a aba "Todos" (ou primeira aba) que possui uma estrutura tabular com colunas EMPRESA, CIDADE, COLABORADOR. Porém, a planilha real possui:

- **Aba "Todos"**: Estrutura consolidada (que já funciona) - MAS só tem 21 funcionários
- **9 abas adicionais** (uma por município): Cada uma com estrutura diferente:
  - **Linha 1**: Nome da empresa (ex: "B SERVICE")
  - **Linha 2**: Município + Banco (ex: "CARAZINHO - ITAÚ", "DOM PEDRITO - COZINHA - SICREDI")
  - **Linha 3+**: Lista de funcionários (coluna A contém o nome)

### Estrutura das Abas Individuais (exemplo):

```
| B SERVICE                   | SALARIO      |
| CARAZINHO - ITAÚ            |              |
|                             |              |
| NOME                        | SALARIO      |
| ALEXSANDRA JUNGES           | R$ 1,791.49  |
| ANA PAULA SOUZA DA SILVA    | R$ 1,836.49  |
```

O município está na linha 2, **antes do hífen** (ex: "CARAZINHO" de "CARAZINHO - ITAÚ").

---

## Solução

Modificar `parseExcelFile` em `src/lib/excelUtils.ts` para:

1. **Estratégia prioritária**: Primeiro tentar ler a aba "Todos" (já funciona)
2. **Fallback para múltiplas abas**: Se "Todos" não existir ou estiver vazia, iterar **todas as abas** e:
   - Extrair empresa da linha 1, coluna A
   - Extrair município da linha 2, coluna A (antes do hífen)
   - Extrair nomes dos funcionários das linhas seguintes (coluna A)

---

## Mudanças no Código

### Arquivo: `src/lib/excelUtils.ts`

```typescript
export async function parseExcelFile(file: File): Promise<SpreadsheetData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // 1. Primeiro tenta aba "Todos" (estrutura tabular)
        const todosSheet = workbook.SheetNames.find(
          name => normalizeForComparison(name) === 'TODOS'
        );
        
        if (todosSheet) {
          const result = parseTodosSheet(workbook, todosSheet, file.name);
          if (result.records.length > 0) {
            console.log(`[Excel] Usando aba "Todos" com ${result.records.length} registros`);
            resolve(result);
            return;
          }
        }
        
        // 2. Fallback: ler todas as abas (uma por município)
        const records: EmployeeRecord[] = [];
        const empresasSet = new Set<string>();
        const cidadesSet = new Set<string>();
        
        for (const sheetName of workbook.SheetNames) {
          // Pular aba "Todos" pois já tentamos
          if (normalizeForComparison(sheetName) === 'TODOS') continue;
          
          const sheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
          
          if (jsonData.length < 3) continue;
          
          // Linha 1: Empresa (coluna A)
          const empresaRaw = String((jsonData[0] as unknown[])?.[0] || '').trim();
          // Linha 2: Município + Banco (ex: "CARAZINHO - ITAÚ")
          const cidadeRaw = String((jsonData[1] as unknown[])?.[0] || '').trim();
          
          // Extrair município (antes do hífen)
          const cidade = cidadeRaw.split(' - ')[0].trim();
          const empresa = empresaRaw;
          
          if (!empresa || !cidade) continue;
          
          empresasSet.add(empresa);
          cidadesSet.add(cidade);
          
          // Linhas 3+: Funcionários (pular linha de cabeçalho "NOME")
          for (let i = 2; i < jsonData.length; i++) {
            const row = jsonData[i] as unknown[];
            if (!row) continue;
            
            const colaborador = String(row[0] || '').trim();
            
            // Pular linhas vazias, cabeçalhos e totais
            if (!colaborador) continue;
            if (normalizeForComparison(colaborador) === 'NOME') continue;
            if (colaborador.startsWith('R$')) continue;
            
            // Verificar se parece um nome (pelo menos 2 palavras, sem valores monetários)
            const words = colaborador.split(' ').filter(w => w.length >= 2);
            if (words.length < 2) continue;
            
            records.push({
              empresa,
              cidade,
              contrato: sheetName, // Usar nome da aba como contrato
              colaborador,
            });
          }
        }
        
        console.log(`[Excel] Lidas ${workbook.SheetNames.length - 1} abas com ${records.length} funcionários`);
        
        resolve({
          records,
          empresas: Array.from(empresasSet).sort(),
          cidades: Array.from(cidadesSet).sort(),
          fileName: file.name,
        });
      } catch (error) {
        console.error('[Excel] Parse error:', error);
        reject(error);
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Erro ao ler arquivo Excel'));
    };
    
    reader.readAsArrayBuffer(file);
  });
}

// Função auxiliar para parsear a aba "Todos" (estrutura tabular existente)
function parseTodosSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
  fileName: string
): SpreadsheetData {
  const sheet = workbook.Sheets[sheetName];
  const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
  
  // ... lógica existente para encontrar colunas EMPRESA, CIDADE, COLABORADOR ...
}
```

---

## Lógica de Parsing por Aba

```text
┌─────────────────────────────────────────────────────────────────┐
│  Para cada aba (exceto "Todos"):                                │
├─────────────────────────────────────────────────────────────────┤
│  Linha 1: "B SERVICE"          → empresa = "B SERVICE"          │
│  Linha 2: "CARAZINHO - ITAÚ"   → cidade = "CARAZINHO"           │
│  Linha 3: (cabeçalho - pular)                                   │
│  Linha 4+: nomes dos funcionários (coluna A)                    │
├─────────────────────────────────────────────────────────────────┤
│  Resultado: { empresa, cidade, colaborador, contrato: abaName } │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tratamento de Casos Especiais

A linha 2 pode conter variações como:
- `"CARAZINHO - ITAÚ"` → cidade = "CARAZINHO"
- `"DOM PEDRITO - COZINHA - SICREDI"` → cidade = "DOM PEDRITO"
- `"FLORES DA CUNHA - SICREDI"` → cidade = "FLORES DA CUNHA"

A solução é usar `split(' - ')[0]` para pegar tudo antes do primeiro hífen.

---

## Arquivos a Modificar

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/excelUtils.ts` | Reescrever `parseExcelFile` para suportar múltiplas abas por município |

---

## Resultado Esperado

| Antes | Depois |
|-------|--------|
| 21 funcionários | ~300+ funcionários (todos os municípios) |
| 1 empresa | 1 empresa (B SERVICE) |
| 3 cidades | 9 cidades (todos os municípios) |

O parser agora lerá **todas as abas** e consolidará os funcionários de cada município, permitindo o enriquecimento correto durante a geração de documentos.
