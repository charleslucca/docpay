

# Plano: Remover Alerta de Operação Lenta (10s)

## O que será removido

O alerta vermelho que aparece após 10 segundos de processamento com a mensagem:
> "Atenção: Extração lenta detectada (mais de 10s). O documento pode estar escaneado ou ser muito grande."

## Alteração

Remover o bloco de código das linhas 306-324 do arquivo `src/components/ProcessingStatus.tsx`:

```tsx
// Este bloco será removido:
{/* Slow operation warning */}
<AnimatePresence>
  {status.isSlowOperation && !isZeroMatchesState && (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="mt-4"
    >
      <Alert variant="destructive" className="border-destructive/50 bg-destructive/10">
        <AlertTriangle className="h-4 w-4 text-destructive" />
        <AlertDescription className="text-destructive">
          <strong>Atenção:</strong> Extração lenta detectada (mais de 10s). 
          O documento pode estar escaneado ou ser muito grande.
        </AlertDescription>
      </Alert>
    </motion.div>
  )}
</AnimatePresence>
```

## Arquivo a modificar

| Arquivo | Alteração |
|---------|-----------|
| `src/components/ProcessingStatus.tsx` | Remover bloco do alerta de operação lenta (linhas 306-324) |

## Resultado
O alerta de "Extração lenta detectada" não aparecerá mais durante o processamento de documentos grandes.

