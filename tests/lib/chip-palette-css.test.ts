import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROPERTY_COLORS } from '@/lib/property-color'

const css = readFileSync(join(process.cwd(), 'app/vault-content.css'), 'utf8')

const SPECIAL = new Set('.[]()*+?^$|{}\\'.split(''))

// Corpo do primeiro bloco cujo seletor é exatamente `selector`.
function block(selector: string): string {
  const esc = [...selector].map((c) => (SPECIAL.has(c) ? '\\' + c : c)).join('')
  const m = new RegExp('(?:^|\\n)' + esc + '\\s*\\{([^}]*)\\}').exec(css)
  return m ? m[1] : ''
}

describe('paleta dos chips por tema', () => {
  const light = block('.vault-properties')
  const dark = block('.dark .vault-properties')

  it('os dois temas definem o texto do chip', () => {
    expect(light).toContain('--vault-chip-text:')
    expect(dark).toContain('--vault-chip-text:')
  })

  for (const color of PROPERTY_COLORS) {
    it(`a cor ${color} tem fundo nos dois temas e um seletor que o usa`, () => {
      expect(light).toContain(`--vault-chip-${color}:`)
      expect(dark).toContain(`--vault-chip-${color}:`)
      const use = `var(--vault-chip-${color})`
      if (color === 'gray') {
        expect(block('.vault-prop-chip')).toContain(use)
      } else {
        expect(block(`.vault-prop-chip[data-color="${color}"]`)).toContain(use)
      }
    })
  }

  it('o link dentro do chip herda a cor', () => {
    expect(block('.vault-prop-val .vault-prop-chip a')).toContain('color: inherit')
  })

  it('a cor default existe nos dois temas, usa a variável e difere do gray', () => {
    expect(block('.vault-prop-chip[data-color="default"]')).toContain('var(--vault-chip-default)')
    const val = (b: string, name: string) => new RegExp(`--vault-chip-${name}:\\s*([^;]+);`).exec(b)?.[1]
    for (const b of [light, dark]) {
      expect(val(b, 'default')).toBeTruthy()
      expect(val(b, 'default')).not.toBe(val(b, 'gray'))
    }
  })
})
