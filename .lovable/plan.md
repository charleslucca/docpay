

# Correção: Importação Excel - De 749 para 1004 Funcionários

## Problemas Identificados

Analisando o arquivo Excel enviado e comparando com a listagem manual, identifiquei os seguintes problemas:

### Problema 1: Estruturas Variadas de Abas

O arquivo tem **diferentes formatos de estrutura** que o parser atual não trata corretamente:

| Tipo | Exemplo | Estrutura |
|------|---------|-----------|
| **Tipo A** | Page 1-3 (Alegrete, Alvorada, etc.) | Linha 1: "B SERVICE" (empresa), Linha 2: "CIDADE - BANCO", Linha 3+: Funcionários |
| **Tipo B** | Page 4-7 (Cachoeirinha, Canela, Carazinho) | Linha 1: "Colunas1", Linha 2: "B SERVICE", Linha 3: "CIDADE - BANCO", Linha 4: "NOME" (header), Linha 5+: Funcionários |
| **Tipo C** | Page 43 (Canela extra) | Linha 1: "CANELA - ITAÚ" (cidade na linha 1!), sem empresa separada |
| **Tipo D** | Page 44-49 (Dois Irmãos, Ibirubá, etc.) | Linha 1: "Colunas1", Linha 2: "CIDADE - BANCO", Linha 3: "NOME", Linha 4+: Funcionários |

### Problema 2: Empresa na Linha 1 ou Linha 2

Algumas abas têm:
- **Linha 1 = Empresa** (B SERVICE) e **Linha 2 = Cidade** (tipo normal)
- **Linha 1 = Cidade** diretamente (sem linha de empresa separada - ex: Page 43 "CANELA - ITAÚ")

O parser atual assume sempre Linha 1 = Empresa, perdendo abas onde a cidade está na linha 1.

### Problema 3: Mais de 50 abas no arquivo

O documento tem **mais de 50 páginas/abas** (o parser de documentos cortou em 50). O arquivo real contém mais abas que não foram analisadas no preview mas são lidas pelo XLSX.

### Problema 4: Abas com Estrutura "SPACE"

Páginas 50+ contêm abas da empresa "SPACE" com estrutura similar:
- CANOAS TEC, CAPÃO DO CIPÓ, ELDORADO, ESTEIO, ITAQUI, PANAMBI, PASSO FUNDO, SÃO LOURENÇO, etc.

---

## Solução Proposta

### Mudança 1: Detectar cidade na linha 1 (sem empresa separada)

Quando a linha 1 contém um padrão de cidade (ex: "CANELA - ITAÚ", "DOIS IRMÃOS - SICREDI"), usar a cidade diretamente:

```text
SE linha 1 contém " - " E não começa com "B SERVICE" ou "SPACE":
   cidade = linha 1 (antes do hífen)
   empresa = extrair do nome (após hífen ou padrão conhecido)
   funcionários = linha 2+ (pulando "NOME" se existir)
```

### Mudança 2: Detectar empresa pelo padrão do nome

O arquivo tem duas empresas principais:
- **B SERVICE** (maioria das abas)
- **SPACE** (abas específicas como "CANOAS TEC", "ESTEIO", etc.)

Quando a empresa não está explícita na linha 1, detectar pelo padrão:
- Se o nome da aba contém "SPACE" ou a linha contém "SPACE": empresa = "SPACE"
- Caso contrário: empresa = "B SERVICE"

### Mudança 3: Melhorar detecção de offset para múltiplas linhas de cabeçalho

Algumas abas têm:
- Linha 1: "Colunas1"
- Linha 2: Cidade (não empresa!)
- Linha 3: "NOME"
- Linha 4+: Funcionários

Ajustar para detectar quando a linha 2 parece cidade (contém " - ITAÚ", " - SICREDI", etc.):

```text
SE linha 1 = "Colunas1" E linha 2 contém " - ITAU|SICREDI":
   offset = 1
   cidade = linha 2 (antes do hífen)
   empresa = detectar pelo padrão
   startIndex = 3 (ou 4 se linha 3 = "NOME")
```

### Mudança 4: Extrair cidade do nome completo da linha

Atualmente o parser pega só o texto antes do primeiro hífen. Mas algumas linhas têm:
- "LEBON REGIS - LIMPEZA - SICREDI" → cidade = "LEBON REGIS"
- "SÃO SEBASTIÃO DO CAÍ - PORTEIROS 01 - SICREDI" → cidade = "SÃO SEBASTIÃO DO CAÍ"

O código atual já faz isso corretamente (`cidadeRaw.split(/\s*-\s*/)[0]`).

---

## Arquivos a Modificar

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/excelUtils.ts` | Reescrever `parseMunicipalitySheets()` com lógica mais robusta |

---

## Nova Lógica de Parsing

```text
PARA cada aba (exceto "Todos"):
  1. Ler todas as linhas

  2. DETECTAR OFFSET:
     - Se linha 1 contém "COLUNA" ou está vazia → offset = 1
     - Senão → offset = 0

  3. DETECTAR ESTRUTURA:
     linhaEmpresa = jsonData[offset]
     linhaCidade = jsonData[offset + 1]
     
     CASO A: linhaEmpresa começa com "B SERVICE" ou "SPACE"
       → empresa = linhaEmpresa
       → cidade = linhaCidade (antes do hífen)
       → startIndex = offset + 2
     
     CASO B: linhaEmpresa contém " - ITAU|SICREDI|PREFEITURA" (é cidade na linha 1)
       → cidade = linhaEmpresa (antes do hífen)
       → empresa = detectar pelo contexto (B SERVICE ou SPACE do nome da aba)
       → startIndex = offset + 1
     
     CASO C: Estrutura diferente
       → tentar extrair cidade do nome da aba

  4. PULAR CABEÇALHOS:
     Se jsonData[startIndex] = "NOME" ou "FUNCIONARIO" → startIndex++

  5. EXTRAIR FUNCIONÁRIOS:
     Para cada linha a partir de startIndex:
       - Pular linhas vazias
       - Pular totais e valores monetários
       - Adicionar nome limpo
```

---

## Comparação: Contagem Manual vs. Esperada

Somando sua listagem manual:

| Cidade | Manual | Observação |
|--------|--------|------------|
| carazinho | 32 + 6 = 38 | 2 abas |
| dom pedrito | 18 + 28 = 46 | cozinha + limpeza |
| flores da cunha | 3 | |
| gramado | 73 + 5 + 5 + 2 + 4 = 89 | cozinha + porteiros + recepção + assistência + obras |
| guaporé | 1 | |
| ifrs | 3 + 6 = 9 | ibirubá + zeladores |
| ipam | 6 | (4 na página?) |
| itaqui | 2 + 11 = 13 | 2 abas |
| ivora | 3 | |
| min agric | 4 | |
| quarai | 3 + 2 + 1 = 6 | 3 abas diferentes |
| são marcos | 7 | |
| santa barbara | 26 + 3 = 29 | 2 abas |
| sapiranga | 31 + 50 + 72 = 153 | manutenção + limpeza + vigilância |
| sesi | 3 | |
| ss cai | 2 + 2 + 7 + 16 = 27 | 4 abas (porteiros + cozinha) |
| são joão urtiga | 17 | |
| são josé norte | 20 | |
| taquara | 11 | |
| torres | 53 | |
| uruguaiana | 2 | |
| viamão | 48 + 8 = 56 | 2 abas |
| alegrete | 1 + 6 = 7 | 2 abas (1 + câmara?) |
| cachoeirinha | 8 + 1 = 9 | (cacique = cachoeirinha?) |
| canela | 18 + 1 + 20 = 39 | + paço + extra |
| 2 irmãos | 1 | |
| ibirubá | 2 | câmara |
| lebon regis | 31 + 18 = 49 | limpeza + cozinha |
| salto jacuí | 33 | |
| canoas | 1 | SPACE |
| capão do cipó | 3 | SPACE |
| eldorado | 1 + 1 = 2 | 2 abas |
| esteio | 75 | SPACE |
| panambi | 42 + 16 = 58 | 2 abas |
| passo fundo | 8 | SPACE |
| são lourenço | 2 | SPACE |
| tupandi | 22 | SPACE |
| ajuricaba | 7 | SPACE |
| carlos barbosa | 1 | SPACE |
| erechim | 9 | SPACE |
| farmácia | 3 | |
| mato leão | 26 | |
| rio grande | 28 | |
| metropolitana | 20 | |
| osório | 2 | |
| pinheiro machado | 8 | |
| cachoeira do sul | 12 | (do arquivo) |
| alvorada | 2 | (do arquivo) |

**Total aproximado**: ~1004 funcionários

---

## Resultado Esperado

Após as correções:
- Todas as abas serão processadas corretamente
- Ambos os formatos de estrutura serão detectados
- Contagem final: ~1004 funcionários (correspondendo à listagem manual)

