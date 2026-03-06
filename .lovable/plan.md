

# Corrigir extração de nomes com label "Nome do Funcionário" e validar suporte a múltiplos comprovantes

## Diagnóstico

### 1. Múltiplos comprovantes
O sistema **já suporta** múltiplos comprovantes. O estado `comprovantes` é um array, `addFiles` aceita vários arquivos do tipo "comprovante", e o loop de matching itera por todos (`comprovanteList`). Nenhuma alteração necessária.

### 2. Padrão "Nome do Funcionário" não reconhecido
Na função `extractEmployeeName` (pdfUtils.ts, linha 252), o padrão 3 de labels é:
```
(?:NOME|FUNCIONARIO|...)\s*:?\s*([A-Z]...)
```
Quando o texto normalizado contém `NOME DO FUNCIONARIO: JOAO DA SILVA`, o regex casa `NOME` e tenta capturar `DO FUNCIONARIO JOAO DA SILVA...`. Isso falha na validação porque "FUNCIONARIO" está na lista `invalidWords` (linha 296). O nome é rejeitado.

### 3. Contagem 691 vs 690
A função `countPagesWithEmployeeName` (linha 146) tem o padrão `/NOME\s+DO\s+FUNCIONARIO/i` para **contagem**, então conta páginas com esse label. Porém, `extractEmployeeName` não consegue extrair o nome dessas páginas. Resultado: a contagem inclui uma página extra (provavelmente cabeçalho/template) que contém o label mas não um nome real — ou todas as 690 páginas de funcionários contêm esse label e uma página extra (sumário) também contém.

A correção do padrão de extração deve alinhar a contagem com a extração real.

## Correções

### Arquivo: `src/lib/pdfUtils.ts`

**Correção 1**: Adicionar padrão específico para "NOME DO FUNCIONARIO" antes do padrão genérico de labels (antes da linha 252):
```typescript
// Novo padrão: "NOME DO FUNCIONARIO" como label completo
/NOME\s+DO\s+FUNCIONARIO\s*:?\s*([A-Z][A-Z\s]{4,50}?)(?=\s*(?:CPF|CARGO|FUNCAO|ADMISSAO|CNPJ|MATRICULA|\d{3}\.\d{3}|$))/,
```

**Correção 2**: Adicionar também variantes similares no mesmo bloco:
```typescript
// "NOME DO EMPREGADO", "NOME DO COLABORADOR", "NOME DO TRABALHADOR"
/NOME\s+D[OA]\s+(?:EMPREGADO|COLABORADOR|TRABALHADOR|FUNCIONARIO)\s*:?\s*([A-Z][A-Z\s]{4,50}?)(?=\s*(?:CPF|CARGO|FUNCAO|ADMISSAO|CNPJ|MATRICULA|\d{3}\.\d{3}|$))/,
```

Esses padrões devem ser inseridos **antes** do padrão 3 genérico (linha 252), pois a lista é avaliada em ordem de prioridade.

## Impacto

| Aspecto | Antes | Depois |
|---------|-------|--------|
| "Nome do Funcionário: JOAO" | Não extraído (rejeitado por invalidWords) | Extraído corretamente |
| Contagem de funcionários | 691 (inclui página sem nome extraível) | ~690 (alinhada com extração) |
| Múltiplos comprovantes | Já suportado | Sem alteração |

## Arquivo alterado

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/pdfUtils.ts` | Adicionar padrão "NOME DO FUNCIONARIO" na lista de namePatterns |

