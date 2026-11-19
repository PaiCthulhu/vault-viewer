import { describe, it, expect } from 'vitest'
import { pageCssClasses } from '@/lib/css-classes'

describe('pageCssClasses', () => {
  it('lê a lista do frontmatter', () => {
    expect(pageCssClasses({ cssclasses: ['exemplo-largo', 'wide-page'] })).toEqual(['exemplo-largo', 'wide-page'])
  })

  it('aceita string, separada por espaço ou vírgula, como o Obsidian', () => {
    expect(pageCssClasses({ cssclasses: 'wide-page' })).toEqual(['wide-page'])
    expect(pageCssClasses({ cssclasses: 'a b, c' })).toEqual(['a', 'b', 'c'])
  })

  it('sem cssclasses devolve lista vazia', () => {
    expect(pageCssClasses({})).toEqual([])
    expect(pageCssClasses(undefined)).toEqual([])
    expect(pageCssClasses({ cssclasses: '' })).toEqual([])
  })

  it('descarta o que não é nome de classe e repetidos', () => {
    expect(pageCssClasses({ cssclasses: ['ok', 'x"y', '<b>', 'ok', 42] })).toEqual(['ok'])
  })
})
