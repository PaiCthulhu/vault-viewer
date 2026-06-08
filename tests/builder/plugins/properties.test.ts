import { describe, it, expect } from 'vitest'
import { renderProperties } from '../../../builder/plugins/properties'

const replaceWikilinks = (s: string) =>
  s.replace(/\[\[([^\]]+)\]\]/g, (_, inner) => `<a href="/x">${inner}</a>`)
const resolveImage = (p: string) => `/vault-assets/myvault/${p}`

describe('renderProperties', () => {
  it('renderiza wikilinks de imagem (Galeria) como thumbs, não como links', () => {
    const html = renderProperties(
      { Galeria: ['[[Imagens/Galerias/Aldor_5.png]]', '[[Imagens/Galerias/Aldor_1.jpeg]]'] },
      replaceWikilinks,
      resolveImage,
    )
    expect(html).toContain('<img class="vault-prop-thumb" src="/vault-assets/myvault/Imagens/Galerias/Aldor_5.png"')
    expect(html).toContain('<img class="vault-prop-thumb" src="/vault-assets/myvault/Imagens/Galerias/Aldor_1.jpeg"')
    // NÃO deve virar link <a>
    expect(html).not.toContain('<a ')
  })

  it('extrai o caminho antes do alias |', () => {
    const html = renderProperties(
      { Foto: '[[Imagens/x.png|legenda]]' },
      replaceWikilinks,
      resolveImage,
    )
    expect(html).toContain('src="/vault-assets/myvault/Imagens/x.png"')
    expect(html).not.toContain('legenda')
  })

  it('detecta caminho de imagem sem colchetes', () => {
    const html = renderProperties({ Foto: 'assets/cover.webp' }, replaceWikilinks, resolveImage)
    expect(html).toContain('<img class="vault-prop-thumb" src="/vault-assets/myvault/assets/cover.webp"')
  })

  it('mantém wikilinks não-imagem como links', () => {
    const html = renderProperties({ Local: '[[Aldoria]]' }, replaceWikilinks, resolveImage)
    expect(html).toContain('<a href="/x">Aldoria</a>')
    expect(html).not.toContain('vault-prop-thumb')
  })

  it('escapa texto simples', () => {
    const html = renderProperties({ Nota: 'a & b' }, replaceWikilinks, resolveImage)
    expect(html).toContain('a &amp; b')
  })
})
