import { describe, it, expect } from 'vitest'
import { PROPERTY_COLORS, propertyColor } from '@/lib/property-color'

describe('propertyColor', () => {
  it('sempre devolve uma cor da lista', () => {
    for (const [k, v] of [['genres', 'RPG'], ['', ''], ['x', '日本語'], ['a', '😀']]) {
      expect(PROPERTY_COLORS).toContain(propertyColor(k, v))
    }
  })

  it('é estável', () => {
    expect(propertyColor('genres', 'RPG')).toBe(propertyColor('genres', 'RPG'))
  })

  it('NFC e NFD dão a mesma cor', () => {
    expect(propertyColor('genres', '\u00e9')).toBe(propertyColor('genres', 'e\u0301'))
  })

  it('a chave muda o resultado em pelo menos um par', () => {
    const vals = ['RPG', 'Ação', 'Estratégia', 'done', 'todo', 'fantasy', 'Neo']
    expect(vals.some((v) => propertyColor('genres', v) !== propertyColor('tags', v))).toBe(true)
  })

  it('trava o mapeamento', () => {
    const table: [string, string, string][] = [
      ['genres', 'RPG', 'pink'],
      ['genres', 'Ação', 'blue'],
      ['genres', 'Estratégia', 'pink'],
      ['status', 'done', 'blue'],
      ['status', 'todo', 'brown'],
      ['tags', 'fantasy', 'orange'],
      ['aliases', 'Neo', 'blue'],
      ['', '', 'purple'],
    ]
    for (const [k, v, c] of table) expect(propertyColor(k, v)).toBe(c)
    expect(table.length).toBe(8)
  })
})
