// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { galleryGroup } from '@/lib/gallery-group'

function gallery(html: string): Element {
  document.body.innerHTML = html
  return document.querySelector('.dv-gallery')!
}

describe('galleryGroup', () => {
  it('devolve o <details> cujo corpo (.callout-content) é só a galeria', () => {
    const g = gallery('<details class="callout"><summary>A</summary><div class="callout-content"><div class="dv-gallery"></div></div></details>')
    expect(galleryGroup(g)?.tagName).toBe('DETAILS')
  })

  it('vale também para o callout do builder (.vault-callout-content)', () => {
    const g = gallery('<details class="vault-callout"><summary>A</summary><div class="vault-callout-content"><div class="dv-gallery"></div></div></details>')
    expect(galleryGroup(g)?.tagName).toBe('DETAILS')
  })

  it('é null quando o corpo do callout tem mais coisa além da galeria', () => {
    const g = gallery('<details class="callout"><summary>A</summary><div class="callout-content"><p>texto</p><div class="dv-gallery"></div></div></details>')
    expect(galleryGroup(g)).toBeNull()
  })

  it('é null fora de um <details>', () => {
    const g = gallery('<div class="callout"><div class="callout-content"><div class="dv-gallery"></div></div></div>')
    expect(galleryGroup(g)).toBeNull()
  })
})
