
# Correção: Padrões Regex para Extrair Nome de Holerites Escaneados

## Problema Identificado

O OCR está funcionando corretamente e extraindo o texto:
```
2049 CARLOS HENRIQUE DA SILVA MARIANO 410105 1 1
SUPERVISOR ADMINISTRATIVO Admissão: 03/02/2025
```

Porém, a função `extractEmployeeName()` não consegue encontrar o nome porque **nenhum padrão regex cobre o formato onde o nome aparece entre números**.

### Formato do Documento
No holerite da B SERVICE, o nome aparece assim:
```
[MATRÍCULA] [NOME COMPLETO] [CÓDIGOS]
   2049    CARLOS HENRIQUE DA SILVA MARIANO  410105 1 1
```

---

## Correção a Implementar

### Arquivo: `src/lib/pdfUtils.ts`

Adicionar novos padrões regex à função `extractEmployeeName()`:

**Novos Padrões Necessários:**

1. **Nome entre números (matrícula e código)**
   - Padrão: `\d{3,6}\s+([A-Z][A-Z\s]{8,45})\s+\d{4,}`
   - Captura: Nome após número de 3-6 dígitos, seguido de número de 4+ dígitos

2. **Nome após código numérico isolado**
   - Padrão: `^\d{3,6}\s+([A-Z][A-Z\s]{8,45})(?=\s+\d|\s+SUPERVISOR|\s+ANALISTA|\s+AUXILIAR)`
   - Captura: Nome após matrícula, antes de cargo ou código

3. **Nome seguido de cargo comum brasileiro**
   - Padrão: `([A-Z][A-Z\s]{8,45})\s+(?:SUPERVISOR|ANALISTA|AUXILIAR|GERENTE|COORDENADOR|ASSISTENTE|OPERADOR|TECNICO)`
   - Captura: Nome que precede um cargo conhecido

---

## Código Atualizado

A função `extractEmployeeName` será modificada para incluir estes padrões:

```typescript
export function extractEmployeeName(text: string): string | null {
  const normalizedText = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ');

  console.log('[DEBUG] Texto normalizado (primeiros 300 chars):', normalizedText.substring(0, 300));

  const namePatterns = [
    // 1. Nome entre matrícula e código (NOVO - formato B SERVICE)
    /\b\d{3,6}\s+([A-Z][A-Z\s]{8,45}?)\s+\d{4,}/,
    
    // 2. Nome seguido de cargo brasileiro (NOVO)
    /([A-Z][A-Z\s]{8,45}?)\s+(?:SUPERVISOR|ANALISTA|AUXILIAR|GERENTE|COORDENADOR|ASSISTENTE|OPERADOR|TECNICO|ADMINISTRATIVO)/,
    
    // 3. Labels explícitos brasileiros
    /(?:NOME|FUNCIONARIO|EMPREGADO|COLABORADOR|TRABALHADOR|TITULAR|SEGURADO|BENEFICIARIO)\s*:?\s*([A-Z][A-Z\s]{4,50}?)(?=\s*(?:CPF|CARGO|FUNCAO|ADMISSAO|CNPJ|MATRICULA|\d{3}\.\d{3}|$))/,
    
    // 4. Recibo de pagamento padrão
    /RECIBO\s+DE\s+PAGAMENTO[^A-Z]*([A-Z][A-Z\s]{5,40}?)(?=\s*(?:CPF|CARGO))/,
    
    // 5. Nome imediatamente antes de CPF
    /([A-Z][A-Z\s]{5,40}?)\s*\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}/,
    
    // 6. Linha com nome completo isolado
    /^([A-Z][A-Z\s]{8,40})$/m,
  ];

  for (const pattern of namePatterns) {
    const match = normalizedText.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim().replace(/\s+/g, ' ');
      const words = name.split(' ').filter(w => w.length > 1);
      
      if (words.length >= 2 && name.length >= 5 && name.length <= 60) {
        const invalidWords = [
          'CNPJ', 'CPF', 'CARGO', 'FUNCAO', 'ADMISSAO', 'SALARIO', 
          'EMPRESA', 'LTDA', 'EIRELI', 'SA', 'PRESTADORA', 'SERVICOS',
          'FOLHA', 'MENSAL', 'RECIBO', 'PAGAMENTO'
        ];
        const hasInvalidWord = words.some(w => invalidWords.includes(w));
        if (!hasInvalidWord) {
          console.log('[DEBUG] Nome extraído:', name);
          return name;
        }
      }
    }
  }

  console.log('[DEBUG] Nenhum nome encontrado');
  return null;
}
```

---

## Arquivo a Modificar

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/pdfUtils.ts` | Adicionar 2 novos padrões regex e expandir lista de palavras inválidas |

---

## Teste do Padrão

Com o texto OCR:
```
2049 CARLOS HENRIQUE DA SILVA MARIANO 410105 1 1
```

O padrão `\b\d{3,6}\s+([A-Z][A-Z\s]{8,45}?)\s+\d{4,}` irá:
1. Encontrar `2049` (matrícula - 4 dígitos)
2. Capturar `CARLOS HENRIQUE DA SILVA MARIANO`
3. Verificar que `410105` (6 dígitos) segue

**Resultado esperado:** `CARLOS HENRIQUE DA SILVA MARIANO`

---

## Resultado Esperado

Após a correção:
- O nome será extraído corretamente do texto OCR
- O padrão funcionará para outros holerites com formato similar
- A lista expandida de palavras inválidas evitará falsos positivos com nomes de empresas
