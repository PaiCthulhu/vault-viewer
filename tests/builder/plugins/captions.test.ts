import { describe, it, expect } from 'vitest'
import { renderCaptions } from '../../../builder/plugins/captions'

const resolveImage = (p: string) => `/vault-assets/myvault/${p}`

describe('renderCaptions', () => {
  it('converte ![[img.png|Legenda]] em <figure>', () => {
    const result = renderCaptions('![[foto.png|Uma foto bonita]]', resolveImage)
    expect(result).toContain('<figure class="vault-figure">')
    expect(result).toContain('<img src="/vault-assets/myvault/foto.png" alt="Uma foto bonita"')
    expect(result).toContain('<figcaption>Uma foto bonita</figcaption>')
    expect(result).toContain('</figure>')
  })

  it('converte ![[img.png]] sem legenda em <img> simples', () => {
    const result = renderCaptions('![[foto.png]]', resolveImage)
    expect(result).toContain('<img src="/vault-assets/myvault/foto.png"')
    expect(result).not.toContain('<figure')
  })

  it('não processa ![[nota.md]] (não é imagem)', () => {
    const result = renderCaptions('![[AlgumaNote.md]]', resolveImage)
    expect(result).toBe('![[AlgumaNote.md]]')
  })

  it('não processa ![[nota]] sem extensão como imagem', () => {
    const result = renderCaptions('![[SemExtensao]]', resolveImage)
    expect(result).toBe('![[SemExtensao]]')
  })

  it('processa múltiplas imagens no mesmo texto', () => {
    const md = '![[a.jpg|Caption A]] e ![[b.png]]'
    const result = renderCaptions(md, resolveImage)
    expect(result).toContain('<figure')
    expect(result).toContain('<img src="/vault-assets/myvault/b.png"')
  })

  it('suporta paths com pastas', () => {
    const result = renderCaptions('![[Imagens/Capas/Aldor.png|O Guerreiro]]', resolveImage)
    expect(result).toContain('src="/vault-assets/myvault/Imagens/Capas/Aldor.png"')
    expect(result).toContain('O Guerreiro')
  })

  it('trata valor numérico no pipe como width, sem figcaption', () => {
    const result = renderCaptions('![[Imagens/Geral/Aldor_3.png|120]]', resolveImage)
    expect(result).toContain('width="120"')
    expect(result).not.toContain('<figcaption>120<')
    expect(result).not.toContain('<figure')
  })

  it('trata WxH no pipe como width e height', () => {
    const result = renderCaptions('![[foto.png|120x80]]', resolveImage)
    expect(result).toContain('width="120"')
    expect(result).toContain('height="80"')
    expect(result).not.toContain('<figure')
  })

  it('combina legenda + tamanho', () => {
    const result = renderCaptions('![[foto.png|Minha Legenda|120]]', resolveImage)
    expect(result).toContain('<figure')
    expect(result).toContain('width="120"')
    expect(result).toContain('<figcaption>Minha Legenda</figcaption>')
    expect(result).not.toContain('<figcaption>120<')
  })

  it('embed isolado seguido de lista ganha linha em branco para fechar o bloco HTML', () => {
    const md = `![[Imagens/Geral/Ato.png]]
- [[Capítulo 1]]
- [[Capítulo 2]]`
    const result = renderCaptions(md, resolveImage)
    // O <img> deve ser seguido por uma linha em branco antes da lista.
    expect(result).toMatch(/<img[^>]*\/>\n\n- /)
  })

  it('embed inline no meio de frase não ganha linha em branco extra', () => {
    const result = renderCaptions('texto ![[foto.png]] mais texto', resolveImage)
    expect(result).not.toMatch(/<img[^>]*\/>\n/)
  })
})
