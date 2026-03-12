

## Diagnóstico Completo

### Dados do Log

| Métrica | Valor |
|---------|-------|
| Funcionários extraídos dos holerites | 691 |
| Páginas de comprovante | 70 |
| Nomes FAVORECIDO extraídos | 70 (todos únicos) |
| Matches encontrados | 76 |
| Não processados | 615 |
| Taxa de sucesso | 11% |

### Causa Raiz: Nomes truncados pela extração

O log mostra centenas de nomes extraídos incorretamente -- apenas os últimos 2-3 sobrenomes em vez do nome completo:

```
Página 1:  CARLOS HENRIQUE DA SILVA MARIANO → extraído como "SILVA MARIANO"
Página 3:  ANA BEATRIZ DIAS PIRES         → "BEATRIZ DIAS PIRES"
Página 13: JOICE BANDEIRA CORREIA          → "BANDEIRA CORREIA"
Página 15: JUSSARA MARIA SILVA DOS SANTOS  → "SILVA DOS SANTOS"
Página 17: MARI INES DA ROCHA MARQUES      → "INES DA ROCHA MARQUES"
```

Também aparecem fragmentos sem sentido: "SOUZA PORT", "AZAMBUJA FERRAS", "SANTOS HAACK", "MELLO GARCIA", "PORT DOS REIS". E na página 691: "COMUNICADO SOBRE DESCONTO DE EMPRESTIMO" (não é funcionário).

### Por que os nomes são truncados (detalhes técnicos)

O formato B SERVICE normalizado é:
```
...NOME DO FUNCIONARIO CBO DEPARTAMENTO FILIAL 2049 CARLOS HENRIQUE DA SILVA MARIANO 410105 1 1 SUPERVISOR...
```

O pattern 1 (`\b[A-Z0-9]{2,5}\s+([A-Z]...)\s+(?:...|S?\d{4,6})\b`) deveria capturar `2049 {NOME} 410105`. Porém, `[A-Z0-9]{2,5}` também aceita `CBO` (3 letras) como "código". Quando `matchAll` processa o texto da esquerda para a direita:

1. Encontra: `CBO DEPARTAMENTO FILIAL 2049` → código=`CBO`, nome=`DEPARTAMENTO FILIAL`, CBO=`2049`
2. Rejeitado (DEPARTAMENTO é invalidWord), mas o cursor do `matchAll` avança ALÉM de `2049`
3. O próximo texto é `CARLOS HENRIQUE DA SILVA MARIANO 410105`
4. `CARLOS` tem 6 caracteres → NÃO cabe em `[A-Z0-9]{2,5}` → pattern 1 não pode mais capturar o nome
5. Sistema cai no pattern 7 (genérico), que captura apenas "SILVA MARIANO"

### Por que 76 matches com apenas 70 comprovantes

Com nomes truncados, fragmentos como "SILVA FERREIRA" podem coincidir com FAVORECIDO de outro funcionário por substring/word-overlap, gerando falsos positivos. Além disso, o log mostra duplicatas (CAMILLO ALVES PELZER nas páginas 146 e 147).

### Por que empresa/cidade/contrato estão vazios no nome do arquivo

O nome truncado "SILVA MARIANO" não corresponde a nenhum registro na planilha nem no banco de dados (que tem "CARLOS HENRIQUE DA SILVA MARIANO"). O lookup falha → variáveis ficam vazias → arquivo gerado com placeholders `EMPRESA_CIDADE_CONTRATO_SILVA_MARIANO.pdf`.

---

## Correção

### Arquivo: `src/lib/pdfUtils.ts`

**1. Novo pattern 0 (maior prioridade)** -- Formato B SERVICE com cabeçalho completo:
```typescript
// 0. Formato B SERVICE explícito: cabeçalho + código + nome + CBO
/NOME\s+DO\s+FUNCIONARIO\s+CBO\s+(?:DEPARTAMENTO\s+)?(?:FILIAL\s+)?\d{1,5}\s+([A-Z][A-Z\s]{5,55}?)\s+S?\d{4,6}/
```
Este pattern captura diretamente após o cabeçalho `NOME DO FUNCIONARIO CBO DEPARTAMENTO FILIAL {código}`, extraindo o nome completo até o CBO. Elimina a ambiguidade do `matchAll`.

**2. Corrigir pattern 1** -- Exigir pelo menos um dígito no código:
```typescript
// De: \b[A-Z0-9]{2,5}\s+
// Para: \b(?=[A-Z0-9]*\d)[A-Z0-9]{1,5}\s+
```
O lookahead `(?=[A-Z0-9]*\d)` garante que o "código" contenha ao menos um dígito. Isso impede `CBO`, `CC`, `GERAL` de serem interpretados como códigos de funcionário, enquanto permite OCR ruidoso como `S0` (tem dígito `0`).

**3. Expandir invalidWords:**
```typescript
"COMUNICADO", "DESCONTO", "EMPRESTIMO", "AVISO", "INFORMATIVO",
"SUPERVISOR", "ADMINISTRADOR", "ADMINISTRATIVO"
```

**4. Adicionar deduplicação de entries** no `useDocumentProcessor.ts`:

Após extrair todos os entries dos holerites, agrupar por nome normalizado e manter apenas um entry por nome único. Isso evita que holerites de 2 páginas gerem entradas duplicadas.

```typescript
// Após coletar allHoleriteEntries:
const uniqueEntries = new Map<string, HoleriteEntry>();
for (const entry of allHoleriteEntries) {
  const key = normalizeForMatch(entry.name);
  if (!uniqueEntries.has(key)) {
    uniqueEntries.set(key, entry);
  }
}
const dedupedEntries = [...uniqueEntries.values()];
```

### Impacto esperado

| Aspecto | Antes | Depois |
|---------|-------|--------|
| Nomes truncados | ~60% (SILVA MARIANO, etc.) | 0% |
| Matches encontrados | 76 (com falsos positivos) | ~70 (correto) |
| Nomes duplicados | Sim (2 páginas = 2 entries) | Não (deduplicados) |
| Empresa/cidade no arquivo | Vazios (placeholders) | Preenchidos via planilha/DB |
| Ruído (COMUNICADO, etc.) | Presente | Filtrado |

### Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/pdfUtils.ts` | Novo pattern 0 (B SERVICE explícito); fix pattern 1 (exigir dígito); expandir invalidWords |
| `src/hooks/useDocumentProcessor.ts` | Deduplicar entries por nome normalizado antes do matching |

