import { describe, it, expect } from 'vitest'
import { buildGraph } from '../../builder/graph-builder'
import type { PageMeta } from '../../builder/types'

function makePage(path: string, title: string, tags: string[], outlinks: string[]): PageMeta {
  return { path, title, tags, outlinks, html: '', frontmatter: {}, allFields: {}, css: '' }
}

const pages: PageMeta[] = [
  makePage('Exemplares/Alfa', 'Alfa', ['Exemplar'], ['Ensaios/Gama', 'Subpasta/C1']),
  makePage('Ensaios/Gama', 'Gama', ['Ensaio'], ['Exemplares/Alfa']),
  makePage('Subpasta/C1', 'Nota C1', [], []),
  makePage('Isolado', 'Nota Isolada', [], []),
]

describe('buildGraph', () => {
  it('cria um nó para cada página', () => {
    const { nodes } = buildGraph(pages)
    expect(nodes).toHaveLength(4)
  })

  it('nó tem id=path, label=title, tags', () => {
    const { nodes } = buildGraph(pages)
    const alfa = nodes.find(n => n.id === 'Exemplares/Alfa')
    expect(alfa).toBeDefined()
    expect(alfa!.label).toBe('Alfa')
    expect(alfa!.tags).toContain('Exemplar')
  })

  it('cria edges para outlinks que existem no vault', () => {
    const { edges } = buildGraph(pages)
    expect(edges.some(e => e.source === 'Exemplares/Alfa' && e.target === 'Ensaios/Gama')).toBe(true)
    expect(edges.some(e => e.source === 'Ensaios/Gama' && e.target === 'Exemplares/Alfa')).toBe(true)
  })

  it('não cria edges para outlinks não-existentes', () => {
    const pagesWithDeadLink: PageMeta[] = [
      makePage('A', 'A', [], ['PAGINA_INEXISTENTE']),
    ]
    const { edges } = buildGraph(pagesWithDeadLink)
    expect(edges).toHaveLength(0)
  })

  it('nó sem outlinks não gera edges', () => {
    const { edges } = buildGraph(pages)
    expect(edges.every(e => e.source !== 'Isolado')).toBe(true)
  })
})
