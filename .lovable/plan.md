

# Corrigir Incompatibilidade de Versao do PDF.js

## Problema

O console mostra o erro:
```
The API version "4.10.38" does not match the Worker version "4.0.379".
```

O `package.json` declara `pdfjs-dist: "^4.0.379"`, e o caret (`^`) permitiu que o npm/bun resolvesse para `4.10.38`. Porem, o arquivo `public/pdf.worker.min.mjs` ainda e da versao `4.0.379`. Quando o PDF.js tenta inicializar o worker, detecta a incompatibilidade e lanca uma excecao, impedindo qualquer operacao com PDFs (contagem de paginas, extracao de texto, etc.). Isso faz o upload travar em "Calculando total..." / "Contando paginas..." indefinidamente.

## Solucao

Fixar a versao do `pdfjs-dist` no `package.json` para que a API sempre corresponda ao worker local.

### Alteracao

**Arquivo: `package.json`**

Trocar:
```
"pdfjs-dist": "^4.0.379"
```
Por:
```
"pdfjs-dist": "4.0.379"
```

Remover o caret (`^`) para impedir que o gerenciador de pacotes atualize automaticamente a versao minor/patch. Isso garante que a API `4.0.379` corresponda exatamente ao worker `public/pdf.worker.min.mjs` versao `4.0.379`.

Nenhum outro arquivo precisa ser alterado.
