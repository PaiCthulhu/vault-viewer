import type { PageMeta, BuildGraph } from './types'

export function buildGraph(pages: PageMeta[]): BuildGraph {
  const pathSet = new Set(pages.map(p => p.path))

  const nodes = pages.map(p => ({ id: p.path, label: p.title, tags: p.tags }))

  const edges = pages.flatMap(p =>
    p.outlinks
      // Keep only links to existing pages, and drop self-references (a page
      // linking to itself needs no arrow pointing back at its own node).
      .filter(target => pathSet.has(target) && target !== p.path)
      .map(target => ({ source: p.path, target })),
  )

  return { nodes, edges }
}
