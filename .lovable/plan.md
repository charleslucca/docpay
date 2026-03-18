

## Diagnóstico (dos logs do console)

Os logs revelam exatamente os problemas:

```text
Row 8: "Serviço:" + "1-B SERVICE PRESTADORA DE SERVICOS EIRELI"
Parsed payroll report: 646 employees, 1 companies, 1 cities
```

**Problemas identificados:**

1. **cidade**: `extractCidadeFromServico` trata TODOS os valores de "Serviço:" como cidades — inclusive valores que são empresas (ex: "1-B SERVICE PRESTADORA DE SERVICOS EIRELI"). Resultado: 1 cidade errada.

2. **contrato**: É preenchido com o valor bruto do "Serviço:", mas quando é uma empresa, deveria manter o contrato anterior ou extrair diferente.

3. **tipo**: A seção "Empregados" / "Contribuintes" (Row 10) aparece como header de grupo mas é ignorada pelo parser. Deveria ser capturada e aplicada aos registros subsequentes.

4. **banco**: Não existe como coluna neste formato de relatório. Não há dados de banco disponíveis nesta planilha.

## Plano de Correção

### Arquivo: `src/lib/excelUtils.ts`

**1. Distinguir empresa vs município nos blocos "Serviço:"**
- Na função `parsePayrollReport`, ao detectar "Serviço:", classificar o valor:
  - Se contém palavras-chave de empresa (EIRELI, LTDA, SERVICOS, PRESTADORA, S/A, ME, EPP), tratar como sub-contrato da empresa, NÃO como cidade
  - Se contém MUNICIPIO, PREFEITURA, CÂMARA, ou parece nome de cidade, extrair como cidade normalmente
- Quando o serviço é uma empresa, manter `currentCidade` do bloco anterior (ou vazio)

**2. Capturar "Empregados" / "Contribuintes" como `tipo`**
- Adicionar detecção de linhas com "Empregados" ou "Contribuintes" (sem ser "Empregados: N" que é total)
- Manter um `currentTipo` que é aplicado a cada registro subsequente
- Padrão: linha que contém exatamente "Empregados" ou "Contribuintes" (Row 10 no log)

**3. Melhorar `extractCidadeFromServico`**
- Adicionar filtro para rejeitar valores que são claramente empresas
- Manter a lógica existente para extrair nomes de municípios

**4. Preencher `contrato` de forma mais útil**
- Quando "Serviço:" é uma empresa, usar como complemento do campo empresa
- Quando é um município, usar como contrato (comportamento atual)

**5. Campo `banco`**
- Este campo não existe no formato "Relação da Folha por Empregado"
- Manter vazio (sem alteração) — não há dados para extrair

### Sem alterações em outros arquivos

## Resultado esperado
- **cidade**: preenchida apenas com nomes de municípios reais (ex: "SANTO ANTONIO DA PATRULHA")
- **contrato**: preenchido com o valor do serviço/município correspondente
- **tipo**: preenchido com "Empregados" ou "Contribuintes" conforme a seção
- **banco**: permanece vazio (dado não disponível neste formato)

