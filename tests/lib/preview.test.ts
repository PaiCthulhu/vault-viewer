import { describe, it, expect } from 'vitest'
import { buildPreview, buildSectionPreview, decodeEntities } from '../../lib/preview'

describe('decodeEntities', () => {
  it('decodes the basic entity set', () => {
    expect(decodeEntities('a &amp; b &lt;x&gt; &quot;q&quot; &#39;s&#39;')).toBe(
      `a & b <x> "q" 's'`,
    )
  })

  it('decodes hex entities for angle brackets', () => {
    expect(decodeEntities('&#x3C;tag&#x3E;')).toBe('<tag>')
  })

  it('decodes numeric decimal entities', () => {
    expect(decodeEntities('foo &#8211; bar')).toBe('foo – bar')
  })

  it('decodes numeric hex entities (code points)', () => {
    expect(decodeEntities('foo &#x2014; bar')).toBe('foo — bar')
  })

  it('decodes named typographic entities', () => {
    expect(
      decodeEntities('a&ndash;b&mdash;c&hellip;d&rsquo;e&ldquo;f&rdquo;'),
    ).toBe('a–b—c…d’e“f”')
  })

  it('decodes a mix of named, decimal and hex entities', () => {
    expect(
      decodeEntities('A&nbsp;&amp;&nbsp;B &#8211; C &#x2014; D'),
    ).toBe('A & B – C — D')
  })

  it('decodes &amp; last so &amp;#8211; stays literal-safe', () => {
    // &amp;#8211; should become &#8211; (NOT an en-dash).
    expect(decodeEntities('x &amp;#8211; y')).toBe('x &#8211; y')
  })

  it('keeps invalid numeric code points as the original text', () => {
    const input = '&#1114112;' // > max code point (0x10FFFF)
    expect(decodeEntities(input)).toBe(input)
  })
})

describe('buildPreview', () => {
  it('extracts banner background-image and skips banner from snippet', () => {
    const html =
      `<div class="vault-banner" style="background-image: url('/vault-assets/b.jpg')">` +
      '<div class="vault-banner-gradient"></div>' +
      '<h1 class="vault-banner-title">Title</h1></div>' +
      '<div class="vault-article"><p>Body text here.</p></div>'
    const { image, snippet } = buildPreview(html)
    expect(image).toBe('/vault-assets/b.jpg')
    expect(snippet).toBe('Body text here.')
  })

  it('parses the banner background-position as imagePosition', () => {
    const html =
      `<div class="vault-banner" style="background-image: url('/vault-assets/b.jpg'); background-position: center 51.4%;">` +
      '<div class="vault-banner-gradient"></div>' +
      '<h1 class="vault-banner-title">Title</h1></div>' +
      '<div class="vault-article"><p>Body text here.</p></div>'
    const { imagePosition } = buildPreview(html)
    expect(imagePosition).toBe('center 51.4%')
  })

  it('falls back to the first vault-asset image when no banner', () => {
    const html = '<p>Intro</p><img src="/vault-assets/pic.png" alt="x"><p>More</p>'
    const { image, imagePosition } = buildPreview(html)
    expect(image).toBe('/vault-assets/pic.png')
    expect(imagePosition).toBeNull()
  })

  it('returns null image when none present', () => {
    const { image } = buildPreview('<p>just text</p>')
    expect(image).toBeNull()
  })

  it('strips the vault-page-title heading from the snippet', () => {
    const html = '<h1 class="vault-page-title">My Page</h1><p>Real content.</p>'
    const { snippet } = buildPreview(html)
    expect(snippet).toBe('Real content.')
  })

  it('strips tags, collapses whitespace and decodes entities', () => {
    const html = '<p>Hello   &amp;    <b>world</b></p>'
    const { snippet } = buildPreview(html)
    expect(snippet).toBe('Hello & world')
  })

  it('trims long text at a word boundary with an ellipsis', () => {
    const word = 'lorem '
    const html = '<p>' + word.repeat(100) + '</p>'
    const { snippet } = buildPreview(html)
    expect(snippet.length).toBeLessThanOrEqual(321)
    expect(snippet.endsWith('…')).toBe(true)
    expect(snippet).not.toContain('lore…') // cut at a space, not mid-word
  })
})

describe('buildPreview: imagem das Propriedades', () => {
  const thumb = (src: string) => `<img class="vault-prop-thumb" src="${src}" alt="" />`
  const page = '<article class="vault-content"><p>x</p><img src="/vault-assets/s/b.png"></article>'

  it('a primeira miniatura das propriedades, em ordem, vem antes da imagem do corpo, decodificada', () => {
    const { image } = buildPreview(page, { propertiesHtml: ['', thumb('/vault-assets/s/a%20b&amp;c.png')] })
    expect(image).toBe('/vault-assets/s/a%20b&c.png')
  })

  it('entre várias propriedades com imagem vale a primeira', () => {
    const { image } = buildPreview(page, {
      propertiesHtml: ['texto', thumb('/vault-assets/s/1.png') + thumb('/vault-assets/s/2.png'), thumb('/vault-assets/s/3.png')],
    })
    expect(image).toBe('/vault-assets/s/1.png')
  })

  it('sem propertiesHtml, ou sem imagem nelas, a imagem é a do html, como antes', () => {
    expect(buildPreview(page).image).toBe('/vault-assets/s/b.png')
    expect(buildPreview(page, { propertiesHtml: ['', '<span class="vault-prop-chip" data-color="blue">RPG</span>'] }).image)
      .toBe('/vault-assets/s/b.png')
  })

  it('a imagem do html também sai decodificada', () => {
    const { image } = buildPreview('<p><img src="/vault-assets/s/it&#39;s &amp; me.png" alt=""></p>')
    expect(image).toBe("/vault-assets/s/it's & me.png")
  })

  it('o banner continua valendo antes das propriedades', () => {
    const html =
      `<div class="vault-banner" style="background-image: url('/vault-assets/s/banner.jpg')">` +
      '<div class="vault-banner-gradient"></div><h1 class="vault-banner-title">T</h1></div>' + page
    const { image } = buildPreview(html, { propertiesHtml: [thumb('/vault-assets/s/a.png')] })
    expect(image).toBe('/vault-assets/s/banner.jpg')
  })

  it('o valor das propriedades não entra no trecho; o <details> antigo continua fora dele', () => {
    const newFormat = buildPreview(
      '<article class="vault-content"><div class="vault-properties-slot"></div><p>corpo</p></article>',
      { propertiesHtml: ['meta'] },
    )
    expect(newFormat.snippet).toBe('corpo')
    const old = buildPreview(
      '<article class="vault-content"><details class="vault-properties"><summary>Properties</summary>' +
        `<div class="vault-prop"><span class="vault-prop-val">meta${thumb('/vault-assets/s/old.png')}</span></div>` +
        '</details><p>corpo</p></article>',
    )
    expect(old.snippet).toBe('corpo')
    expect(old.image).toBe('/vault-assets/s/old.png')
  })
})

describe('buildSectionPreview', () => {
  const html =
    '<h1 class="vault-page-title" id="page">Page</h1>' +
    '<p>Intro before any section.</p>' +
    '<h2 id="alfa">Alfa</h2>' +
    '<p>Conteúdo do alfa.</p>' +
    '<h3 id="alfa-um">Alfa Um</h3>' +
    '<p>Sub do alfa.</p>' +
    '<h2 id="beta">Beta</h2>' +
    '<p>Conteúdo do beta.</p>'

  it('extrai o heading e o corpo da seção alvo até o próximo heading de mesmo nível', () => {
    const res = buildSectionPreview(html, 'alfa')
    expect(res).not.toBeNull()
    expect(res!.heading).toBe('Alfa')
    // Inclui o conteúdo e a subseção (h3 é mais profundo), mas NÃO o beta (h2).
    expect(res!.snippet).toContain('Conteúdo do alfa.')
    expect(res!.snippet).toContain('Sub do alfa.')
    expect(res!.snippet).not.toContain('Conteúdo do beta.')
    expect(res!.snippet).not.toContain('Intro before any section.')
  })

  it('para uma subseção, vai só até o próximo heading de nível <= o dela', () => {
    const res = buildSectionPreview(html, 'alfa-um')
    expect(res!.heading).toBe('Alfa Um')
    expect(res!.snippet).toContain('Sub do alfa.')
    expect(res!.snippet).not.toContain('Conteúdo do beta.')
    expect(res!.snippet).not.toContain('Conteúdo do alfa.')
  })

  it('captura imagem dentro da seção', () => {
    const withImg =
      '<h2 id="s">S</h2><p>x</p><img src="/vault-assets/in-section.png" alt=""><h2 id="t">T</h2>'
    const res = buildSectionPreview(withImg, 's')
    expect(res!.image).toBe('/vault-assets/in-section.png')
  })

  it('retorna null quando a seção não existe', () => {
    expect(buildSectionPreview(html, 'inexistente')).toBeNull()
  })

  it('acha a seção pelo atributo id, não por um data-id com o mesmo valor', () => {
    const h =
      '<h2 data-id="alvo" id="outro">Errada</h2><p>não é esta</p>' +
      '<h2 id="alvo">Certa</h2><p>é esta</p>'
    const res = buildSectionPreview(h, 'alvo')
    expect(res!.heading).toBe('Certa')
    expect(res!.snippet).toBe('é esta')
  })

  it('decodifica entidades no texto do heading', () => {
    const h = '<h2 id="x">Caf&eacute; &amp; Bar</h2><p>corpo</p>'
    const res = buildSectionPreview(h, 'x')
    expect(res!.heading).toBe('Café & Bar')
  })
})
