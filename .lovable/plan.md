

# Corrigir erro de build TS2322 em DocumentRepository.tsx

## Problema

Na linha 242, um IIFE (Immediately Invoked Function Expression) e usado como filho JSX. A funcao nao retorna nada (`void`), mas React espera `ReactNode`. O TypeScript rejeita `void` como `ReactNode`.

## Correcao

Arquivo: `src/components/DocumentRepository.tsx`, linha 247

Adicionar `return null;` no final do IIFE para que ele retorne `ReactNode` valido:

```typescript
{(() => {
  if (!(doc.createdAt instanceof Date)) {
    doc.createdAt = new Date(doc.createdAt);
  }
  return null;  // <-- adicionar esta linha
})()}
```

Alternativamente (abordagem mais limpa): mover a normalizacao para fora do JSX, no inicio do `.map()` callback, antes do `return`. Isso elimina o IIFE completamente e e mais idiomatico em React:

```typescript
{docs.map((doc) => {
  // Normalize createdAt before rendering
  if (!(doc.createdAt instanceof Date)) {
    doc.createdAt = new Date(doc.createdAt as unknown as string);
  }
  return (
    <motion.div key={doc.id} ...>
      {/* resto do JSX sem o IIFE */}
    </motion.div>
  );
})}
```

Vou aplicar a segunda abordagem (mais limpa) que remove o IIFE por completo.

## Arquivo alterado

| Arquivo | Alteracao |
|---------|-----------|
| `src/components/DocumentRepository.tsx` (linhas 235-247) | Mover normalizacao de `createdAt` para fora do JSX, remover IIFE |

