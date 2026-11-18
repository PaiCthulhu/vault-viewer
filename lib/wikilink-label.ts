// Nome que a leitura mostra para um item que é, inteiro, um wikilink.
// É uma cópia só da parte de exibição de `LinkResolver.wikilink` (builder/link-resolver.ts),
// sem importar o builder, que é código do servidor; tests/lib/wikilink-label.test.ts
// mantém as duas regras iguais.

const WIKILINK = /^\[\[([^\]|#]*)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]$/
// Barra invertida final (pipe escapado em tabelas), com espaços depois dela.
const TRAILING_BACKSLASH = /\\\s*$/

/** O texto do link, ou null quando o item não é, inteiro, um wikilink válido. */
export function wikilinkLabel(item: string): string | null {
  const m = WIKILINK.exec(item.trim())
  if (!m) return null
  const title = (m[1] ?? '').replace(TRAILING_BACKSLASH, '').trim()
  const heading = (m[2] ?? '').replace(TRAILING_BACKSLASH, '').trim()
  const alias = m[3]?.trim()
  if (!title && !heading) return null
  if (!title) return alias || heading
  return alias || title
}

/** O que a leitura mostra para o item: o nome do link, ou o próprio texto. */
export function itemLabel(item: string): string {
  return wikilinkLabel(item) ?? item
}
