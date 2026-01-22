
# Plano: Correção da Extração de Nomes - Filtrar Headers de Tabelas

## Problema Identificado

O OCR está extraindo o **cabeçalho da tabela** como se fosse o nome do funcionário:

```text
EXTRAÍDO (errado):  "CODIGO NOMEDOFUNDANARO E DEPARTAMENTO FAR"
ESPERADO (correto): "JOCELI BRZEZINSKI"
```

Isso acontece porque:
1. O OCR lê as colunas do cabeçalho juntas: "Código | Nome do Funcionário | Departamento"
2. O regex `\b\d{3,6}\s+([A-Z][A-Z\s]{8,45}?)\s+\d{4,}` captura isso incorretamente
3. A lista de palavras inválidas (`invalidWords`) não inclui termos de cabeçalho como "CODIGO", "NOME", "DEPARTAMENTO"

---

## Solução

### 1. Expandir Lista de Palavras Inválidas

**Arquivo:** `src/lib/pdfUtils.ts`

Adicionar termos comuns de cabeçalhos de holerites brasileiros:

```typescript
const invalidWords = [
  // Termos de empresa
  'CNPJ', 'CPF', 'CARGO', 'FUNCAO', 'ADMISSAO', 'SALARIO', 
  'EMPRESA', 'LTDA', 'EIRELI', 'SA', 'PRESTADORA', 'SERVICOS',
  'FOLHA', 'MENSAL', 'RECIBO', 'PAGAMENTO',
  
  // NOVOS: Termos de cabeçalho de tabelas
  'CODIGO', 'NOME', 'FUNCIONARIO', 'DEPARTAMENTO', 'FILIAL',
  'MATRICULA', 'DATA', 'REFERENCIA', 'VENCIMENTOS', 'DESCONTOS',
  'LIQUIDO', 'VALOR', 'TOTAL', 'BASE', 'FGTS', 'INSS', 'IRRF',
  'DESCRICAO', 'OBSERVACAO', 'PERIODO', 'COMPETENCIA',
  'FAR', // Fragmento visto no erro
];
```

### 2. Adicionar Validação de Fragmentos OCR

Quando o OCR junta palavras incorretamente (ex: "NOMEDOFUNDANARO"), o resultado contém sequências incomuns. Adicionar validação para detectar:

```typescript
// Detectar palavras muito longas (provavelmente OCR incorreto)
const hasVeryLongWord = words.some(w => w.length > 15);
if (hasVeryLongWord) {
  console.log('[DEBUG] Ignorando - palavra muito longa (OCR incorreto):', name);
  continue; // Tentar próximo padrão
}
```

### 3. Melhorar Padrão para B SERVICE

O formato do holerite B SERVICE tem uma estrutura específica:
- Linha 1: Código | Nome do Funcionário | CBO | Departamento | Filial
- Linha 2: (cargo) | | Admissão

O nome real aparece na interseção de "Código" (2445) com a linha de dados. Adicionar padrão mais específico:

```typescript
// Formato B SERVICE: CODIGO NOME CARGO (mesma linha)
// Ex: "2445 JOCELI BRZEZINSKI COZINHEIRA"
/\b\d{3,5}\s+([A-Z][A-Z\s]{5,35})\s+(?:COZINHEIRA|SERVENTE|AJUDANTE|AUXILIAR|OPERADOR)/i,
```

---

## Arquivo a Modificar

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/pdfUtils.ts` | Expandir `invalidWords`, adicionar validação de palavras longas, melhorar regex |

---

## Mudanças Específicas no Código

### `src/lib/pdfUtils.ts` - Função `extractEmployeeName`

```typescript
export function extractEmployeeName(text: string): string | null {
  const normalizedText = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ');

  // Padrões ordenados do mais específico ao mais genérico
  const namePatterns = [
    // 1. Formato B SERVICE: código + nome + cargo na mesma linha
    // Ex: "2445 JOCELI BRZEZINSKI 513205" ou "2445 JOCELI BRZEZINSKI COZINHEIRA"
    /\b(\d{3,5})\s+([A-Z][A-Z\s]{5,35}?)\s+(?:COZINHEIRA|SERVENTE|AJUDANTE|AUXILIAR|SUPERVISOR|OPERADOR|TECNICO|LIDER|ENCARREGADO|\d{5,6})\b/,
    
    // 2. Nome seguido de cargo brasileiro (mantido)
    /([A-Z][A-Z\s]{8,45}?)\s+(?:SUPERVISOR|ANALISTA|AUXILIAR|GERENTE|COORDENADOR|ASSISTENTE|OPERADOR|TECNICO|ADMINISTRATIVO|COZINHEIRA|SERVENTE)/,
    
    // ... outros padrões mantidos
  ];

  // Lista expandida de palavras inválidas
  const invalidWords = [
    // Termos de empresa/documento
    'CNPJ', 'CPF', 'CARGO', 'FUNCAO', 'ADMISSAO', 'SALARIO', 
    'EMPRESA', 'LTDA', 'EIRELI', 'SA', 'PRESTADORA', 'SERVICOS',
    'FOLHA', 'MENSAL', 'RECIBO', 'PAGAMENTO',
    
    // Termos de cabeçalho de tabelas
    'CODIGO', 'NOME', 'FUNCIONARIO', 'DEPARTAMENTO', 'FILIAL',
    'MATRICULA', 'DATA', 'REFERENCIA', 'VENCIMENTOS', 'DESCONTOS',
    'LIQUIDO', 'VALOR', 'TOTAL', 'BASE', 'FGTS', 'INSS', 'IRRF',
    'DESCRICAO', 'OBSERVACAO', 'PERIODO', 'COMPETENCIA',
    'CBO', 'CC', 'FAR',
  ];

  for (const pattern of namePatterns) {
    const match = normalizedText.match(pattern);
    if (match) {
      // Pegar o grupo de captura correto (pode ser [1] ou [2] dependendo do padrão)
      const nameGroup = match[2] || match[1];
      const name = nameGroup.trim().replace(/\s+/g, ' ');
      const words = name.split(' ').filter(w => w.length > 1);
      
      // Validação 1: pelo menos 2 palavras, tamanho razoável
      if (words.length < 2 || name.length < 5 || name.length > 60) {
        continue;
      }
      
      // Validação 2: detectar palavras muito longas (OCR incorreto)
      const hasVeryLongWord = words.some(w => w.length > 15);
      if (hasVeryLongWord) {
        console.log('[DEBUG] Ignorando - palavra OCR malformada:', name);
        continue;
      }
      
      // Validação 3: não contém palavras inválidas
      const hasInvalidWord = words.some(w => invalidWords.includes(w));
      if (hasInvalidWord) {
        console.log('[DEBUG] Ignorando - contém palavra inválida:', name);
        continue;
      }
      
      console.log('[DEBUG] Nome extraído:', name);
      return name;
    }
  }

  console.log('[DEBUG] Nenhum nome encontrado');
  return null;
}
```

---

## Fluxo de Validação Atualizado

```text
Texto OCR: "2445 JOCELI BRZEZINSKI 513205 1 1 COZINHEIRA"
                    │
                    ▼
┌───────────────────────────────────────────┐
│ Padrão 1: \d{3,5}\s+([A-Z...)\s+\d{5,6}  │
│ Match: "2445 JOCELI BRZEZINSKI 513205"   │
│ Grupo capturado: "JOCELI BRZEZINSKI"     │
└───────────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────┐
│ Validação 1: Palavras >= 2?              │
│ ["JOCELI", "BRZEZINSKI"] = 2 ✓           │
└───────────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────┐
│ Validação 2: Palavra > 15 chars?         │
│ Max: 10 (BRZEZINSKI) ✓                   │
└───────────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────┐
│ Validação 3: Contém invalidWord?         │
│ Nenhuma palavra inválida ✓               │
└───────────────────────────────────────────┘
                    │
                    ▼
           ✅ Retorna "JOCELI BRZEZINSKI"
```

---

## Casos de Teste

| Entrada OCR | Resultado Esperado |
|-------------|-------------------|
| `"2445 JOCELI BRZEZINSKI 513205"` | ✅ JOCELI BRZEZINSKI |
| `"CODIGO NOMEDOFUNDANARO E DEPARTAMENTO"` | ❌ null (palavra muito longa) |
| `"1234 MARIA SILVA AUXILIAR"` | ✅ MARIA SILVA |
| `"NOME FUNCIONARIO DEPARTAMENTO FILIAL"` | ❌ null (palavras inválidas) |

---

## Resultado Esperado

1. Nomes de cabeçalho como "CODIGO NOMEDOFUNDANARO" serão rejeitados
2. Nomes reais como "JOCELI BRZEZINSKI" serão extraídos corretamente
3. A validação de palavras longas (>15 chars) detectará erros de OCR
4. A lista expandida de `invalidWords` filtrará termos de tabelas

