

# Correção: Nomes sendo truncados na extração

## Problema identificado

Dois fatores causam o truncamento:

1. **Limites de caracteres baixos nas regex**: Vários padrões usam `{5,35}`, `{5,40}`, `{8,45}` — nomes brasileiros compostos como "ANA CRISTIANE MAIRESSE DE MEDEIROS HENI" (40 chars) atingem ou ultrapassam esses limites.

2. **Quantificadores lazy (`?`)**: O `?` após `{5,40}` faz a regex capturar o **mínimo possível** de caracteres. Se um dígito (CPF parcial, código) aparece no meio do texto OCR, o lookahead para prematuramente, cortando o nome.

### Exemplos do erro:
- `ANA CRISTIANE MAIRESSE DE MEDEIROS HENI` → captura `ANA CRISTIANE MAIRESSE DE MEDE` (para no primeiro `\d{3}` do CPF próximo)
- `CARINA ANDREIA DOS SANTOS DA ROSA` → captura `CARINA ANDREIA DOS SANTOS DA R` (para em algum anchor)

## Alterações

### `src/lib/pdfUtils.ts`

**1. extractEmployeeName — padrões de regex (linhas 238-270)**

Aumentar limites e ajustar quantificadores em todos os padrões:

| Padrão | Atual | Novo |
|--------|-------|------|
| 1 (B SERVICE) | `{5,35}` | `{5,55}` |
| 1.5 (OCR) | `{5,40}` | `{5,55}` |
| 2 (cargo) | `{8,45}` | `{8,60}` |
| 3a (label composto) | `{4,50}` | `{4,65}` |
| 3b (label simples) | `{4,50}` | `{4,65}` |
| 4 (recibo) | `{5,40}` | `{5,60}` |
| 5 (favorecido) | `{5,40}` | `{5,60}` |
| 6 (antes CPF) | `{5,40}` | `{5,60}` |
| 8 (linha isolada) | `{8,40}` | `{8,60}` |

**2. extractFavorecidoNames — regex principal (linha 700)**

Alterar `[A-Z][A-Z ]{4,60}?` para `[A-Z][A-Z ]{4,80}` (greedy, limite 80 chars). O lookahead já garante que para no ponto correto — o lazy é contraproducente aqui.

**3. extractFavorecidoNames — fallback (linhas 731-735)**

O fallback word-by-word já funciona sem limite de caracteres, não precisa de alteração.

### Resumo

- Aumentar limites de captura de `35-50` para `55-80` chars em todas as regex
- Trocar quantificadores lazy por greedy nos padrões de FAVORECIDO para capturar o nome completo até o próximo anchor real
- Nenhuma outra alteração (sem mudanças em matching, UI, ou outros fluxos)

