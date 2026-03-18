

# Correção: 67 → 66 — Match perdido após mudanças de threshold relaxado

## Diagnóstico

O loop de matching (useDocumentProcessor.ts, linha 1220-1228) pega a **primeira** página que retorna `found: true` e para (`break`). Com o threshold relaxado de 0.78 no FAVORECIDO, um funcionário pode agora fazer match com uma página **errada** (score baixo, 0.78) antes de chegar à sua página correta (score 1.0). Essa página errada pode já ter outro funcionário com score melhor, e a resolução de conflitos remove o match do funcionário — que agora perdeu sua chance de fazer match com a página certa.

Exemplo: Funcionário A fazia match com página 5 (substring, 0.8). Agora, com threshold 0.78, ele faz match com página 2 (FAVORECIDO relaxado, 0.78) — mas página 2 já tem Funcionário B (score 1.0). Conflito: B vence, A é removido. Resultado: -1 match.

## Correção

### 1. Selecionar a MELHOR página, não a primeira (`useDocumentProcessor.ts`)

No loop de matching (linhas 1220-1228), em vez de `break` no primeiro match, continuar buscando e guardar o match com **maior score**:

```
Lógica atual:
  para cada página → se match → break (pega primeira)

Lógica corrigida:
  para cada página → se match → guardar se score > melhor anterior
  no final → usar o melhor match
```

Isso garante que um match FAVORECIDO exato (score 1.0) ou substring (0.8) será preferido sobre um match FAVORECIDO relaxado (0.78), mesmo que o relaxado apareça primeiro na ordem de páginas.

### 2. Log de diagnóstico para matches múltiplos

Quando um funcionário faz match com mais de uma página, logar todas as opções e qual foi escolhida, para auditoria futura.

## Arquivo Alterado

- `src/hooks/useDocumentProcessor.ts` — loop de matching (linhas 1216-1228)

## Resultado Esperado

O match perdido será recuperado (66 → 67+), pois o sistema agora escolhe a página com maior confiança em vez da primeira encontrada.

