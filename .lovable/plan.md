

# Correção: 3 PDFs Excedentes na Geração

## Causa Raiz

O sistema gera 73 PDFs em vez de 70 porque o matching produz **3 falsos positivos**. O comprovante tem 70 funcionários, mas 73 nomes do holerite são associados a páginas do comprovante. Isso ocorre por duas razões:

1. **Fallback de substring sem restrição**: Se o nome normalizado de um funcionário (≥8 chars) aparece como substring no texto da página do comprovante, é aceito como match — mesmo que seja parte do nome de OUTRO funcionário (ex: "MARIA SANTOS" encontrado dentro de "MARIA APARECIDA DOS SANTOS").

2. **Múltiplos matches por página sem validação**: O sistema detecta e loga páginas com múltiplos matches, mas não impede que todos virem PDFs. Cada match vira um `MatchedPair` e gera um PDF separado, mesmo que 2-3 funcionários tenham sido associados à mesma página do comprovante.

## Correção

### 1. Priorizar match mais específico por página (`useDocumentProcessor.ts`)

Após o loop de matching, implementar **resolução de conflitos por página**: quando múltiplos funcionários matcham a mesma página do comprovante, manter apenas o match com maior score de confiança. Isso elimina falsos positivos sem afetar matches válidos.

```
Para cada página com múltiplos matches:
  - Ordenar por score (desc)
  - Manter apenas o match com maior score
  - Remover os demais de `pairs[]`
  - Logar os matches removidos como "rejeitados por conflito de página"
```

### 2. Restringir substring fallback (`pdfUtils.ts`)

Adicionar validação de que o substring match NÃO é parte de um nome maior. Verificar que o match está delimitado por espaços ou início/fim de texto (word boundary), evitando matches parciais dentro de nomes compostos.

### 3. Adicionar contagem de validação pré-geração (`useDocumentProcessor.ts`)

Antes de iniciar `generatePdfs`, logar e validar:
- Quantidade de matches únicos por página de comprovante
- Se matches > páginas únicas do comprovante, sinalizar inconsistência
- Exibir alerta no toast com a contagem corrigida

## Resultado Esperado

73 → 70 PDFs. Os 3 falsos positivos serão eliminados pela resolução de conflitos por página, e o substring fallback será mais restritivo para evitar recorrência.

