
# Corrigir Incompatibilidade de Versao do PDF.js (Abordagem Dupla)

## Problema

A correcao anterior no `package.json` nao persistiu -- a linha 57 ainda contem `"pdfjs-dist": "^4.0.379"`, permitindo que a versao `4.10.38` seja instalada. O worker local (`public/pdf.worker.min.mjs`) permanece na versao `4.0.379`, causando o erro e travando o upload.

## Solucao (duas camadas para garantir)

### Camada 1: Fixar versao no package.json (linha 57)

```
De:  "pdfjs-dist": "^4.0.379"
Para: "pdfjs-dist": "4.0.379"
```

### Camada 2: Fallback dinamico no codigo (src/lib/pdfCache.ts)

Mesmo que o package.json nao resolva (por cache do bundler), alterar a funcao `getPdfJs()` para usar o worker do CDN correspondente a versao instalada como fallback. Isso garante que a versao da API e do worker sempre coincidam:

```typescript
async function getPdfJs() {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist');
    // Usar worker do CDN que corresponde exatamente a versao instalada
    const version = pdfjsLib.version;
    pdfjsLib.GlobalWorkerOptions.workerSrc = 
      `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${version}/pdf.worker.min.mjs`;
  }
  return pdfjsLib;
}
```

Com esta abordagem, mesmo que a versao do pacote mude no futuro, o worker sempre sera da mesma versao. O worker local nao sera mais usado, mas a carga do CDN e rapida e cached pelo navegador.

### Arquivos alterados

| Arquivo | Alteracao |
|---------|-----------|
| `package.json` (linha 57) | Remover `^` para fixar versao em `4.0.379` |
| `src/lib/pdfCache.ts` (linhas 6-13) | Usar CDN dinamico com a versao do pacote instalado |
