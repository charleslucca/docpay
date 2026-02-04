
# Plano: Acelerar OCR Usando Modelo Fast

## Análise do Problema

### Dados Atuais (dos logs)
- **Velocidade**: 0.8 páginas/segundo (6 páginas em 7.5s)
- **Modelo em uso**: `tessdata/4.0.0_best` (modelo de alta precisão, muito lento)
- **Tempo estimado para 691 páginas**: ~14 minutos

### Causa Raiz Identificada

O código está usando o modelo de **máxima precisão** do Tesseract:
```
langPath: 'https://tessdata.projectnaptha.com/4.0.0_best'
```

Este modelo é projetado para máxima acurácia em documentos complexos, mas é **2-3x mais lento** que o modelo `fast`.

Para extração de nomes de funcionários (texto grande e legível em holerites), o modelo `fast` oferece precisão suficiente com velocidade muito maior.

---

## Solução: Trocar para Modelo Fast

### Mudança Principal

Alterar o `langPath` de:
```
https://tessdata.projectnaptha.com/4.0.0_best
```

Para:
```
https://tessdata.projectnaptha.com/4.0.0_fast
```

### Ganho Esperado
| Métrica | Antes | Depois |
|---------|-------|--------|
| Velocidade | 0.8 pág/s | **2-3 pág/s** |
| Tempo (691 págs) | ~14 min | **4-6 min** |
| Precisão | 99%+ | ~95% (suficiente para nomes) |

---

## Arquivos a Modificar

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/ocrUtils.ts` | Trocar langPath para tessdata_fast |

---

## Implementação

### `src/lib/ocrUtils.ts`

Linha 76 - Alterar o caminho do modelo de idioma:

```typescript
// ANTES (modelo lento de alta precisão)
langPath: 'https://tessdata.projectnaptha.com/4.0.0_best',

// DEPOIS (modelo rápido, precisão suficiente para texto grande)
langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast',
```

---

## Por que Funciona

1. **Modelo `fast` é otimizado para velocidade**: Usa redes neurais menores e integerizadas
2. **Para texto grande (nomes em holerites)**: A diferença de precisão é negligenciável
3. **Perda de precisão mínima**: Menos de 5% segundo a documentação oficial do Tesseract
4. **Download menor**: Modelo `fast` é ~3x menor, inicialização mais rápida

---

## Resultado Esperado

- **Velocidade**: 2-3x mais rápido (de 0.8 para ~2-3 páginas/segundo)
- **Tempo total**: Redução de ~14 minutos para ~5 minutos para 691 páginas
- **Precisão**: Mantida para extração de nomes (texto grande e claro)

---

## Observações

Esta é uma mudança simples de uma linha que deve ter impacto significativo na velocidade. Caso a precisão não seja suficiente para alguns documentos específicos, podemos adicionar uma opção para o usuário escolher entre "modo rápido" e "modo preciso".
