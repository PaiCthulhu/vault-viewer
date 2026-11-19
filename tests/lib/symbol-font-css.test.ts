import { describe, it, expect } from 'vitest'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const FONT = join(process.cwd(), 'app/fonts/vault-symbols.woff2')

// As fontes de sistema do Android não têm a meia estrela (U+2BE8) que uma nota usa numa
// avaliação: ela saía como um quadrado. O viewer embute um recorte da Noto Sans Symbols 2 só
// com as estrelas, e o `unicode-range` faz o navegador baixá-lo só em página que use uma delas.
describe('fonte das estrelas', () => {
  const face = css.match(/@font-face \{([^}]*)\}/)?.[1] ?? ''

  it('declara a fonte com as estrelas cheia, vazia e as quatro meias', () => {
    expect(face).toContain("font-family: 'Vault Symbols'")
    expect(face).toContain("src: url('./fonts/vault-symbols.woff2') format('woff2')")
    expect(face).toMatch(/unicode-range: U\+2605-2606, U\+2BE8-2BEB;/)
    expect(face).toContain('font-display: swap')
  })

  it('vem primeiro na pilha do body, então as estrelas saem da mesma fonte em todo aparelho', () => {
    const body = css.match(/(?:^|\n)body \{([^}]*)\}/)?.[1] ?? ''
    expect(body).toMatch(/font-family: 'Vault Symbols', -apple-system, /)
  })

  it('o arquivo é um WOFF2 pequeno, com a licença ao lado', () => {
    const bytes = readFileSync(FONT)
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('wOF2')
    expect(statSync(FONT).size).toBeLessThan(8 * 1024)
    expect(readFileSync(join(process.cwd(), 'app/fonts/OFL.txt'), 'utf8')).toContain('SIL Open Font License')
  })
})
