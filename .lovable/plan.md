

## Diagnóstico

O log LOGS3.txt mostra que **Pattern 0 NÃO está funcionando** — o sistema ainda extrai "SILVA MARIANO" em vez de "CARLOS HENRIQUE DA SILVA MARIANO" (linha 46). Isso significa que Pattern 0 falha silenciosamente e o sistema cai no Pattern 7 genérico.

O problema principal é que **"SUPERVISOR" e "ADMINISTRATIVO" foram adicionados à `invalidWords`**. No texto do holerite B SERVICE, CADA página contém algo como:

```
...CARLOS HENRIQUE DA SILVA MARIANO 410105 1 1 SUPERVISOR ADMINISTRATIVO ADMISSAO...
```

Quando Pattern 7 (`\b([A-Z]{3,15}(?:\s+[A-Z]{2,15}){1,4})\b`) com `matchAll` encontra matches nesse texto, ele captura fragmentos como "SILVA MARIANO SUPERVISOR ADMINISTRATIVO" — que é REJEITADO por conter SUPERVISOR e ADMINISTRATIVO nas invalidWords. Como `matchAll` itera por todas as ocorrências, muitos matches válidos anteriores (como "SILVA MARIANO") que antes passavam agora são "pulados" porque o `matchAll` encontra primeiro combinações maiores que incluem essas palavras.

Além disso, Pattern 0 provavelmente falha porque o `\s+` entre a captura e `S?\d{4,6}` compete com o `[A-Z\s]` da captura (ambos aceitam espaços), causando backtracking problemático em textos com formatação variável.

## Correção

### Arquivo: `src/lib/pdfUtils.ts`

**1. Remover "SUPERVISOR", "ADMINISTRADOR", "ADMINISTRATIVO" da `invalidWords`** (linha 364)

Esses são cargos/departamentos que aparecem no corpo de CADA holerite. Adicioná-los bloqueia a extração de nomes legítimos que aparecem perto dessas palavras. O Pattern 1 já usa esses termos como terminadores (fora do capture group), então não precisam estar em invalidWords.

**2. Corrigir Pattern 0** — usar `[A-Z]` em vez de `[A-Z\s]` para o corpo do nome, com espaços explícitos:

```typescript
/NOME\s+DO\s+FUNCIONARIO\s+CBO\s+(?:DEPARTAMENTO\s+)?(?:FILIAL\s+)?\d{1,5}\s+((?:[A-Z]{2,15}\s+){1,6}[A-Z]{2,15})\s+S?\d{4,6}/
```

Isso evita a ambiguidade lazy entre `[A-Z\s]` e `\s+` que pode causar falhas.

**3. Manter COMUNICADO, DESCONTO, EMPRESTIMO, AVISO, INFORMATIVO** — esses são legitimamente inválidos como nomes.

## Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/pdfUtils.ts` | Remover SUPERVISOR/ADMINISTRADOR/ADMINISTRATIVO de invalidWords; corrigir Pattern 0 para usar grupos de palavras explícitos |

