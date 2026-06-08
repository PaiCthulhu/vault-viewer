import { describe, it, expect } from 'vitest'
import { buildGraph } from '../../builder/graph-builder'
import type { PageMeta } from '../../builder/types'

function makePage(path: string, title: string, tags: string[], outlinks: string[]): PageMeta {
  return { path, title, tags, outlinks, html: '', frontmatter: {}, allFields: {}, css: '' }
}

const pages: PageMeta[] = [
  makePage('Personagens/Aldor', 'Aldor', ['Personagem'], ['Magia/Magus', 'Campanhas/C1']),
  makePage('Magia/Magus', 'Magus', ['Conceito'], ['Personagens/Aldor']),
  makePage('Campanhas/C1', 'Campanha 1', [], []),
  makePage('Isolado', 'Nota Isolada', [], []),
]

describe('buildGraph', () => {
  it('cria um nó para cada página', () => {
    const { nodes } = buildGraph(pages)
    expect(nodes).toHaveLength(4)
  })

  it('nó tem id=path, label=title, tags', () => {
    const { nodes } = buildGraph(pages)
    const aldor = nodes.find(n => n.id === 'Personagens/Aldor')
    expect(aldor).toBeDefined()
    expect(aldor!.label).toBe('Aldor')
    expect(aldor!.tags).toContain('Personagem')
  })

  it('cria edges para outlinks que existem no vault', () => {
    const { edges } = buildGraph(pages)
    expect(edges.some(e => e.source === 'Personagens/Aldor' && e.target === 'Magia/Magus')).toBe(true)
    expect(edges.some(e => e.source === 'Magia/Magus' && e.target === 'Personagens/Aldor')).toBe(true)
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
