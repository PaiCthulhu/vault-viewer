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

  describe('valor booleano (tipo Checkbox do Obsidian)', () => {
    it('false vira checkbox desmarcado, não o texto "false"', () => {
      const html = renderProperties({ 'Atualização Pendente': false }, replaceWikilinks, resolveImage)
      expect(html).toContain('<span class="vault-prop-val"><input type="checkbox" class="vault-prop-checkbox" disabled></span>')
    })

    it('true vira checkbox marcado', () => {
      const html = renderProperties({ Zerado: true }, replaceWikilinks, resolveImage)
      expect(html).toContain('<span class="vault-prop-val"><input type="checkbox" class="vault-prop-checkbox" checked disabled></span>')
    })

    it('texto "false" entre aspas continua texto', () => {
      const html = renderProperties({ Nota: 'false' }, replaceWikilinks, resolveImage)
      expect(html).toContain('<span class="vault-prop-val">false</span>')
    })
  })

  describe('valor que é uma URL', () => {
    it('vira link clicável, como no Obsidian', () => {
      const url = 'https://example.com/threads/some-game.12345/'
      const html = renderProperties({ url }, replaceWikilinks, resolveImage)
      expect(html).toContain(`<a href="${url}">${url}</a>`)
    })

    it('aceita http e ignora espaço em volta', () => {
      const html = renderProperties({ url: '  http://example.com/a  ' }, replaceWikilinks, resolveImage)
      expect(html).toContain('<a href="http://example.com/a">http://example.com/a</a>')
    })

    it('cada item de uma lista de URLs vira link', () => {
      const html = renderProperties(
        { links: ['https://a.example/', 'https://b.example/'] },
        replaceWikilinks,
        resolveImage,
      )
      expect(html).toContain('<a href="https://a.example/">https://a.example/</a>, <a href="https://b.example/">https://b.example/</a>')
    })

    it('URL de imagem vira link, não miniatura do vault', () => {
      const html = renderProperties({ url: 'https://cdn.example/capa.png' }, replaceWikilinks, resolveImage)
      expect(html).toContain('<a href="https://cdn.example/capa.png">https://cdn.example/capa.png</a>')
      expect(html).not.toContain('vault-prop-thumb')
    })

    it('escapa aspas e & no href e no texto', () => {
      const html = renderProperties({ url: 'https://x.example/?a=1&b="2"' }, replaceWikilinks, resolveImage)
      expect(html).toContain('<a href="https://x.example/?a=1&amp;b=&quot;2&quot;">https://x.example/?a=1&amp;b=&quot;2&quot;</a>')
    })

    it('não linka outros esquemas', () => {
      const html = renderProperties({ url: 'javascript:alert(1)' }, replaceWikilinks, resolveImage)
      expect(html).not.toContain('<a ')
      expect(html).toContain('javascript:alert(1)')
    })

    it('não linka valor com espaço no meio (texto que só contém uma URL)', () => {
      const html = renderProperties({ Nota: 'ver https://a.example/ depois' }, replaceWikilinks, resolveImage)
      expect(html).not.toContain('<a ')
    })
  })
})

describe('renderProperties — campos da nota-filha', () => {
  const keys = (html: string) =>
    [...html.matchAll(/<span class="vault-prop-key">([^<]*)<\/span>/g)].map(m => m[1])

  it('nota comum mostra parent, order e note_type desconhecido, e esconde tab_label', () => {
    const html = renderProperties(
      { parent: '[[Pai]]', order: 3, note_type: 'character', tab_label: 'Jogando', autor: 'Ana' },
      replaceWikilinks,
      resolveImage,
    )
    expect(keys(html)).toEqual(['parent', 'order', 'note_type', 'autor'])
  })

  it('nota da família (aba ou comentário) esconde os quatro campos do formato', () => {
    const html = renderProperties(
      { note_type: 'tab', parent: '[[Mãe]]', order: 1, tab_label: 'X', autor: 'Ana' },
      replaceWikilinks,
      resolveImage,
      { familyNote: true },
    )
    expect(keys(html)).toEqual(['autor'])
  })

  it('aba só com os campos do formato não tem bloco de Propriedades', () => {
    const html = renderProperties(
      { note_type: 'tab', parent: '[[Mãe]]', order: 1 },
      replaceWikilinks,
      resolveImage,
      { familyNote: true },
    )
    expect(html).toBe('')
  })
})
