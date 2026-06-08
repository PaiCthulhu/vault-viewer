import { describe, it, expect } from 'vitest'
import { extractFrontmatter, extractTags } from '../../builder/frontmatter'

describe('extractFrontmatter', () => {
  it('extrai frontmatter YAML e body', () => {
    const md = `---
title: Aldor
Tags:
  - Personagem
cover: Imagens/Aldor.png
---

# Aldor

Conteúdo da nota.`
    const result = extractFrontmatter(md, 'Aldor')
    expect(result.frontmatter).toMatchObject({ title: 'Aldor', cover: 'Imagens/Aldor.png' })
    expect(result.frontmatter.Tags).toEqual(['Personagem'])
    expect(result.body).toContain('# Aldor')
    expect(result.body).not.toContain('---')
    expect(result.title).toBe('Aldor')
  })

  it('usa filenameTitle quando frontmatter não tem title', () => {
    const md = `---
cover: x.png
---
Corpo`
    const result = extractFrontmatter(md, 'MeuArquivo')
    expect(result.title).toBe('MeuArquivo')
  })

  it('funciona com arquivo sem frontmatter', () => {
    const md = `# Apenas markdown\n\nSem frontmatter.`
    const result = extractFrontmatter(md, 'Teste')
    expect(result.frontmatter).toEqual({})
    expect(result.body).toContain('# Apenas markdown')
    expect(result.title).toBe('Teste')
  })
})

describe('extractTags', () => {
  it('extrai array de tags', () => {
    expect(extractTags({ Tags: ['A', 'B'] })).toEqual(['A', 'B'])
    expect(extractTags({ tags: ['X'] })).toEqual(['X'])
  })

  it('converte string única em array', () => {
    expect(extractTags({ Tags: 'Personagem' })).toEqual(['Personagem'])
  })

  it('retorna [] quando sem tags', () => {
    expect(extractTags({})).toEqual([])
  })
})
