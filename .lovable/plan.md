

# Corrigir Versao do pdfjs-dist (Fix Pendente)

## Problema

A correcao anterior para fixar a versao do `pdfjs-dist` nao foi efetivamente aplicada. O `package.json` ainda contem o caret (`^`) na linha 57:

```
"pdfjs-dist": "^4.0.379"
```

Isso permite que o gerenciador de pacotes instale a versao `4.10.38`, que e incompativel com o worker local `public/pdf.worker.min.mjs` (versao `4.0.379`). O erro no console confirma:

```
The API version "4.10.38" does not match the Worker version "4.0.379"
```

## Solucao

### Arquivo: `package.json` (linha 57)

Remover o caret para fixar a versao exata:

```
De:  "pdfjs-dist": "^4.0.379"
Para: "pdfjs-dist": "4.0.379"
```

Esta e a unica alteracao necessaria. O lockfile sera regenerado automaticamente com a versao correta.
