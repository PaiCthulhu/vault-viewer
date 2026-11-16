// Versão de um comentário, para o editar detectar que o arquivo mudou no meio (409).
//
// É uma função pura do que o cliente já tem em mãos (o `PageComment` do `PageMeta` ou o da
// resposta da API), então o build não precisa gravar versão nenhuma. O servidor recalcula
// a partir do disco, pelo mesmo caminho que o build usa para montar o `PageComment`. Roda
// igual no navegador e no Node, e por isso não usa `crypto`: o hash (cyrb53, 53 bits) só
// serve para detectar mudança, não protege nada.
import type { PageComment } from '@/builder/types'

function cyrb53(s: string): number {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

export function commentVersion(c: Pick<PageComment, 'body' | 'createdAt' | 'updatedAt'>): string {
  return cyrb53(JSON.stringify([c.body, c.createdAt, c.updatedAt])).toString(36)
}
