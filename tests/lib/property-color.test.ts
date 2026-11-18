import { describe, it, expect } from 'vitest'
import { CHIP_COLORS, PROPERTY_COLORS, chipColor, isChipColor, propertyColor } from '@/lib/property-color'

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

describe('chipColor', () => {
  it('usa a cor escolhida para o valor', () => {
    expect(chipColor('status', 'done', { done: 'green' })).toBe('green')
    expect(chipColor('status', 'done', { done: 'default' })).toBe('default')
  })
  it('sem colors ou com o valor ausente cai no hash', () => {
    expect(chipColor('status', 'done')).toBe(propertyColor('status', 'done'))
    expect(chipColor('status', 'done', { todo: 'red' })).toBe(propertyColor('status', 'done'))
  })
  it('__proto__ e constructor não são lidos do protótipo', () => {
    expect(chipColor('k', '__proto__', {})).toBe(propertyColor('k', '__proto__'))
    expect(chipColor('k', 'constructor', {})).toBe(propertyColor('k', 'constructor'))
  })
  it('__proto__ como chave própria de colors vale', () => {
    const colors = JSON.parse('{"__proto__":"red"}')
    expect(chipColor('k', '__proto__', colors)).toBe('red')
  })
  it('cor inválida no objeto cai no hash', () => {
    const colors = { done: 'teal' } as unknown as Record<string, 'red'>
    expect(chipColor('status', 'done', colors)).toBe(propertyColor('status', 'done'))
  })
  it('CHIP_COLORS termina em default e PROPERTY_COLORS segue com 9 sem default', () => {
    expect(CHIP_COLORS[CHIP_COLORS.length - 1]).toBe('default')
    expect(PROPERTY_COLORS).toHaveLength(9)
    expect(PROPERTY_COLORS as readonly string[]).not.toContain('default')
    expect(isChipColor('default')).toBe(true)
    expect(isChipColor('teal')).toBe(false)
    expect(isChipColor(3)).toBe(false)
  })
})
