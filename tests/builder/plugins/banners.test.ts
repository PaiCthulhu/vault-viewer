import { describe, it, expect } from 'vitest'
import { renderBanner, escapeTitleText, bannerPosition, bannerHeight, bannerImageUrl } from '../../../builder/plugins/banners'

const resolveImage = (p: string) => `/vault-assets/myvault/${p}`

describe('renderBanner', () => {
  it('retorna string vazia quando não há cover', () => {
    expect(renderBanner({}, 'Título', resolveImage)).toBe('')
    expect(renderBanner({ cover: '' }, 'Título', resolveImage)).toBe('')
  })

  it('gera div.vault-banner com background-image', () => {
    const html = renderBanner({ cover: 'Midia/Alfa.png' }, 'Alfa', resolveImage)
    expect(html).toContain('class="vault-banner"')
    expect(html).toContain("url('/vault-assets/myvault/Midia/Alfa.png')")
  })

  it('aplica cover_y como background-position', () => {
    const html = renderBanner({ cover: 'img.png', cover_y: '30%' }, 'T', resolveImage)
    expect(html).toContain('background-position: center 30%')
  })

  it('usa posição padrão center 50% quando não especificado', () => {
    const html = renderBanner({ cover: 'img.png' }, 'T', resolveImage)
    expect(html).toContain('background-position: center 50%')
  })

  it('honra cover_x e cover_y juntos em background-position', () => {
    const html = renderBanner({ cover: 'img.png', cover_x: '20%', cover_y: '30%' }, 'T', resolveImage)
    expect(html).toContain('background-position: 20% 30%')
  })

  it('coverProperty explícito "banner" usa frontmatter.banner + banner_y/banner_x', () => {
    const html = renderBanner(
      { banner: 'b.png', banner_y: '10%', banner_x: '80%' },
      'T',
      resolveImage,
      'banner',
    )
    expect(html).toContain("url('/vault-assets/myvault/b.png')")
    expect(html).toContain('background-position: 80% 10%')
  })

  it('coverProperty explícito ignora frontmatter.cover quando ausente', () => {
    expect(renderBanner({ cover: 'img.png' }, 'T', resolveImage, 'banner')).toBe('')
  })

  it('aplica banner_height customizado', () => {
    const html = renderBanner({ cover: 'img.png', banner_height: 300 }, 'T', resolveImage)
    expect(html).toContain('height: 300px')
  })

  it('usa height padrão 500px', () => {
    const html = renderBanner({ cover: 'img.png' }, 'T', resolveImage)
    expect(html).toContain('height: 500px')
  })

  it('estilo inline contém background-size: cover e no-repeat', () => {
    const html = renderBanner({ cover: 'img.png' }, 'T', resolveImage)
    expect(html).toContain('background-size: cover')
    expect(html).toContain('background-repeat: no-repeat')
  })

  it('inclui vault-banner-gradient e vault-banner-title', () => {
    const html = renderBanner({ cover: 'img.png' }, 'Alfa', resolveImage)
    expect(html).toContain('class="vault-banner-gradient"')
    expect(html).toContain('class="vault-banner-title"')
    expect(html).toContain('>Alfa<')
  })
})

// O HTML inteiro, como o builder gravava antes do tratamento: banner legítimo não muda.
function banner(style: string, title: string): string {
  return (
    `<div class="vault-banner" style="${style} background-size: cover; background-repeat: no-repeat;">` +
    `<div class="vault-banner-gradient"></div>` +
    `<h1 class="vault-banner-title">${title}</h1>` +
    `</div>`
  )
}

describe('renderBanner: banner legítimo sai byte a byte igual', () => {
  it('padrões: altura 500, center 50%', () => {
    expect(renderBanner({ cover: 'img.png' }, 'T', resolveImage)).toBe(
      banner("height: 500px; background-image: url('/vault-assets/myvault/img.png'); background-position: center 50%;", 'T'),
    )
  })

  it('caminho com espaço e acento, título com travessão e >', () => {
    const fm = { cover: 'teste/Minha Capa Ção.png', cover_x: '20%', cover_y: '30.5%', cover_height: 320 }
    expect(renderBanner(fm, 'Minha Nota — Parte 2 > fim', resolveImage)).toBe(
      banner(
        "height: 320px; background-image: url('/vault-assets/myvault/teste/Minha%20Capa%20%C3%87%C3%A3o.png'); background-position: 20% 30.5%;",
        'Minha Nota — Parte 2 > fim',
      ),
    )
  })

  it('palavras-chave de posição', () => {
    expect(renderBanner({ cover: 'a.png', cover_x: 'left', cover_y: 'top' }, 'T', resolveImage)).toBe(
      banner("height: 500px; background-image: url('/vault-assets/myvault/a.png'); background-position: left top;", 'T'),
    )
    expect(renderBanner({ cover: 'a.png', cover_x: 'right', cover_y: 'bottom' }, 'T', resolveImage)).toBe(
      banner("height: 500px; background-image: url('/vault-assets/myvault/a.png'); background-position: right bottom;", 'T'),
    )
    expect(renderBanner({ cover: 'a.png', cover_x: 'center', cover_y: 'center' }, 'T', resolveImage)).toBe(
      banner("height: 500px; background-image: url('/vault-assets/myvault/a.png'); background-position: center center;", 'T'),
    )
  })

  it('comprimentos com unidade e números', () => {
    expect(renderBanner({ cover: 'a.png', cover_x: '10px', cover_y: '-2.5em' }, 'T', resolveImage)).toBe(
      banner("height: 500px; background-image: url('/vault-assets/myvault/a.png'); background-position: 10px -2.5em;", 'T'),
    )
    expect(renderBanner({ cover: 'a.png', cover_x: 0, cover_y: 30 }, 'T', resolveImage)).toBe(
      banner("height: 500px; background-image: url('/vault-assets/myvault/a.png'); background-position: 0 30;", 'T'),
    )
  })

  it('altura como string numérica e o legado banner_height', () => {
    expect(renderBanner({ cover: 'a.png', cover_height: '300' }, 'T', resolveImage)).toBe(
      banner("height: 300px; background-image: url('/vault-assets/myvault/a.png'); background-position: center 50%;", 'T'),
    )
    expect(renderBanner({ cover: 'a.png', banner_height: 250.5 }, 'T', resolveImage)).toBe(
      banner("height: 250.5px; background-image: url('/vault-assets/myvault/a.png'); background-position: center 50%;", 'T'),
    )
  })

  it('coverProperty próprio usa <base>_x, <base>_y e <base>_height', () => {
    const fm = { image: 'capa.jpg', image_x: '40%', image_y: '60%', image_height: 420 }
    expect(renderBanner(fm, 'Minha Nota', resolveImage, 'image')).toBe(
      banner("height: 420px; background-image: url('/vault-assets/myvault/capa.jpg'); background-position: 40% 60%;", 'Minha Nota'),
    )
  })

  it('banner do plugin Banners (chave banner)', () => {
    const fm = { banner: 'b.png', banner_x: '80%', banner_y: '10%', banner_height: 300 }
    expect(renderBanner(fm, 'T', resolveImage)).toBe(
      banner("height: 300px; background-image: url('/vault-assets/myvault/b.png'); background-position: 80% 10%;", 'T'),
    )
  })
})

describe('escapeTitleText', () => {
  it('escapa & e <, como o vault-page-title', () => {
    expect(escapeTitleText('Tom & Jerry <b>')).toBe('Tom &amp; Jerry &lt;b>')
    expect(escapeTitleText('&amp;')).toBe('&amp;amp;')
  })

  it('título sem & e sem < sai igual', () => {
    expect(escapeTitleText('Minha Nota — Parte 2 > "fim"')).toBe('Minha Nota — Parte 2 > "fim"')
  })
})

describe('bannerPosition', () => {
  it('aceita palavra-chave, porcentagem, comprimento e número', () => {
    for (const v of ['left', 'center', 'right', 'top', 'bottom', 'Center', '30%', '30.5%', '-10%', '10px', '-2.5em', '1.5rem', '3vh', '2Q', '0', '30', '.5']) {
      expect(bannerPosition(v, 'center'), v).toBe(v)
    }
    expect(bannerPosition(30, '50%')).toBe('30')
    expect(bannerPosition(-12.5, '50%')).toBe('-12.5')
    expect(bannerPosition(0, '50%')).toBe('0')
  })

  it('aceita cada unidade de comprimento simples, em qualquer caixa', () => {
    const units = ['px', 'em', 'rem', 'ex', 'ch', 'cm', 'mm', 'in', 'pt', 'pc', 'q', 'vw', 'vh', 'vmin', 'vmax',
      'vi', 'vb', 'svw', 'svh', 'lvw', 'lvh', 'dvw', 'dvh', 'lh', 'rlh']
    for (const u of units) {
      expect(bannerPosition('10' + u, 'center'), u).toBe('10' + u)
      expect(bannerPosition('-1.5' + u.toUpperCase(), 'center'), u).toBe('-1.5' + u.toUpperCase())
    }
  })

  it('NUL, U+0085 e U+2028 no valor caem no padrão ou somem no trim', () => {
    expect(bannerPosition('30%\u0000', 'center')).toBe('center')
    expect(bannerPosition('30%\u0085x', 'center')).toBe('center')
    expect(bannerPosition(' 30% ', 'center')).toBe('30%')
  })

  it('apara espaço nas pontas', () => {
    expect(bannerPosition(' 30% ', '50%')).toBe('30%')
    expect(bannerPosition('30%\n', '50%')).toBe('30%')
  })

  it('qualquer outro valor cai no padrão', () => {
    const hostile = [
      '30%"><script>alert(1)</script>',
      '30%; background-image: url(https://evil.example/x.png)',
      'url(https://evil.example/x.png)',
      'expression(alert(1))',
      '50% 50%',
      '10 px',
      '10furlongs',
      '',
      'calc(50% + 10px)',
      'var(--x)',
    ]
    for (const v of hostile) expect(bannerPosition(v, 'center'), v).toBe('center')
    for (const v of [NaN, Infinity, -Infinity, true, null, [], {}, ['30%'], new Date(0)]) {
      expect(bannerPosition(v, '50%')).toBe('50%')
    }
  })
})

describe('bannerHeight', () => {
  it('aceita número finito positivo, como número ou string numérica', () => {
    expect(bannerHeight(300)).toBe('300')
    expect(bannerHeight(250.5)).toBe('250.5')
    expect(bannerHeight('300')).toBe('300')
    expect(bannerHeight('300.50')).toBe('300.50')
    expect(bannerHeight(' 300 ')).toBe('300')
  })

  it('qualquer outro valor cai em 500', () => {
    for (const v of [0, -10, NaN, Infinity, '0', '-10', '+5', '5.', '300px', 'abc', '', '1e3', '300\u0000', '300; color: red', '300"><x>', true, null, [300], {}]) {
      expect(bannerHeight(v), String(v)).toBe('500')
    }
  })
})

describe('bannerImageUrl', () => {
  it('URL sem caractere especial sai igual ao encodeURI', () => {
    const u = '/vault-assets/myvault/teste/Minha Capa Ção.png'
    expect(bannerImageUrl(u)).toBe(encodeURI(u))
  })

  it("escapa ' ( ) & e o que o encodeURI já escapava", () => {
    expect(bannerImageUrl("/v/a'b.png")).toBe('/v/a%27b.png')
    expect(bannerImageUrl('/v/Image (1).png')).toBe('/v/Image%20%281%29.png')
    expect(bannerImageUrl('/v/a&#39;b.png')).toBe('/v/a%26%2339;b.png')
    expect(bannerImageUrl('/v/a"b\\c\nd\re<f.png')).toBe('/v/a%22b%5Cc%0Ad%0De%3Cf.png')
  })

  it('# e ? no nome da capa saem codificados (senão viram fragmento e query da URL)', () => {
    expect(bannerImageUrl('/v/Capa #1?.png')).toBe('/v/Capa%20%231%3F.png')
  })

  it('surrogate solto vira U+FFFD em vez de lançar', () => {
    expect(bannerImageUrl('/v/x\uD800.png')).toBe('/v/x%EF%BF%BD.png')
    expect(bannerImageUrl('/v/x\uDC00y')).toBe('/v/x%EF%BF%BDy')
    expect(bannerImageUrl('/v/😀.png')).toBe('/v/%F0%9F%98%80.png')
  })
})

// A abertura do banner: `style` entre aspas sem nenhuma aspa dentro, depois o gradiente e o <h1>.
const BANNER_OPEN = /^<div class="vault-banner" style="([^"]*)"><div class="vault-banner-gradient"><\/div><h1 class="vault-banner-title">/

describe('renderBanner: valor hostil do frontmatter', () => {
  it('título com <img onerror>, <script> e & sai como texto', () => {
    const t1 = renderBanner({ cover: 'a.png' }, '<img src=x onerror=alert(1)>', resolveImage)
    expect(t1).toContain('<h1 class="vault-banner-title">&lt;img src=x onerror=alert(1)></h1>')
    expect(t1).not.toContain('<img')
    const t2 = renderBanner({ cover: 'a.png' }, '<script>alert(1)</script>', resolveImage)
    expect(t2).toContain('<h1 class="vault-banner-title">&lt;script>alert(1)&lt;/script></h1>')
    expect(t2).not.toContain('<script')
    const t3 = renderBanner({ cover: 'a.png' }, 'Tom & Jerry &amp; co', resolveImage)
    expect(t3).toContain('<h1 class="vault-banner-title">Tom &amp; Jerry &amp;amp; co</h1>')
    // O fim do banner (`</h1></div>`, que o viewer procura) não aparece no título.
    const t4 = renderBanner({ cover: 'a.png' }, 'x</h1></div><script>alert(1)</script>', resolveImage)
    expect(t4.indexOf('</h1></div>')).toBe(t4.length - '</h1></div>'.length)
  })

  it('posição com ", ;, url( e expression( cai no padrão', () => {
    for (const bad of ['30%" onmouseover="alert(1)', '30%; background-image: url(https://evil.example/x.png)', 'url(https://evil.example/x.png)', 'expression(alert(1))']) {
      const html = renderBanner({ cover: 'a.png', cover_x: bad, cover_y: bad }, 'T', resolveImage)
      expect(html, bad).toMatch(BANNER_OPEN)
      expect(html, bad).toContain('background-position: center 50%;')
      expect(html, bad).not.toContain('evil')
      expect(html, bad).not.toContain('expression')
    }
  })

  it('altura não numérica cai em 500', () => {
    for (const bad of ['300px', 'abc', '300; background: red', '1" onmouseover="x', -5, 0, true]) {
      const html = renderBanner({ cover: 'a.png', cover_height: bad }, 'T', resolveImage)
      expect(html, String(bad)).toMatch(BANNER_OPEN)
      expect(html, String(bad)).toContain('style="height: 500px;')
    }
    const legacy = renderBanner({ cover: 'a.png', banner_height: 'abc' }, 'T', resolveImage)
    expect(legacy).toContain('style="height: 500px;')
  })

  it('a chave de altura escolhida é a de hoje; inválida cai em 500, não no banner_height', () => {
    const html = renderBanner({ cover: 'a.png', cover_height: 'abc', banner_height: 300 }, 'T', resolveImage)
    expect(html).toContain('style="height: 500px;')
    // `??`, não `||`: um 0 ainda é a chave escolhida (e vira 500); só null/ausente passa adiante.
    expect(renderBanner({ cover: 'a.png', cover_height: 0, banner_height: 300 }, 'T', resolveImage)).toContain('style="height: 500px;')
    expect(renderBanner({ cover: 'a.png', cover_height: null, banner_height: 300 }, 'T', resolveImage)).toContain('style="height: 300px;')
  })

  it("URL com ', ( e ) não sai da string CSS nem do atributo", () => {
    const html = renderBanner({ cover: "x'), url(evil.png" }, 'T', resolveImage)
    expect(html).toContain("url('/vault-assets/myvault/x%27%29,%20url%28evil.png')")
    for (const cover of ["x'), url(evil.png", "x\\'); y.png", 'x&#39;); y.png', 'x&quot; y.png', "x'}{ ;.png"]) {
      const out = renderBanner({ cover }, 'T', resolveImage)
      const style = BANNER_OPEN.exec(out)?.[1]
      expect(style, cover).toBeDefined()
      expect(style!.match(/url\(/g), cover).toHaveLength(1)
      const url = /url\('([^']*)'\)/.exec(style!)?.[1]
      expect(url, cover).toMatch(/^[^'"()\\<&\s]*$/)
    }
  })

  it('caminho inválido (", <, :, quebra de linha, NUL...) não é capa, mesmo terminado em .png', () => {
    const boom = () => {
      throw new Error('não devia resolver')
    }
    const covers = ['x" onmouseover="alert(1).png', 'x<b>.png', 'x>.png', 'C:/a.png', 'a|b.png', 'a?.png', 'a*.png',
      'x\n}.png', 'x\u0000.png', 'x\u001f.png', '[[x\u0000.png]]', 'a.png::$DATA.png', 'a'.repeat(300) + '.png']
    for (const cover of covers) expect(renderBanner({ cover }, 'T', boom), cover).toBe('')
  })

  it('surrogate solto na capa não lança', () => {
    const html = renderBanner({ cover: 'x\uD800.png' }, 'T', resolveImage)
    expect(html).toContain("url('/vault-assets/myvault/x%EF%BF%BD.png')")
  })
})

describe('renderBanner: só referência de imagem do vault conta como capa', () => {
  // Um editor chega a esses valores pela API de propriedades (number 0 → 5, checkbox
  // false → true); o resolveImage do build lançaria com os que não são texto e derrubaria
  // o vault inteiro. Valor que não cita imagem do vault conta como campo vazio.
  const valores: unknown[] = [5, 0, true, false, ['Imagens/a.png'], new Date(0), { a: 1 },
    'texto comum', 'Imagens/capa', 'a.pdf', 'https://example.com/a.png', '![[a.png]]', '[[a.png', ' ']
  const boom = () => {
    throw new Error('não devia resolver')
  }

  it('na chave cover', () => {
    for (const v of valores) expect(renderBanner({ cover: v }, 'T', resolveImage), String(v)).toBe('')
  })

  it('na chave banner', () => {
    for (const v of valores) expect(renderBanner({ banner: v }, 'T', resolveImage), String(v)).toBe('')
  })

  it('na coverProperty do vault', () => {
    for (const v of valores) expect(renderBanner({ image: v }, 'T', resolveImage, 'image'), String(v)).toBe('')
  })

  it('o resolveImage nem é chamado', () => {
    for (const v of valores) expect(renderBanner({ cover: v }, 'T', boom)).toBe('')
  })

  it('wikilink, caminho e nome de arquivo com extensão de imagem contam, exista a imagem ou não', () => {
    const url = (cover: string) => /url\('([^']*)'\)/.exec(renderBanner({ cover }, 'T', resolveImage))?.[1]
    expect(url('Imagens/a.png')).toBe('/vault-assets/myvault/Imagens/a.png')
    expect(url('nao-existe.png')).toBe('/vault-assets/myvault/nao-existe.png')
    for (const cover of ['A.PNG', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp', 'a.svg', 'a.avif', '[[Imagens/a.png]]', '[[a.png|apelido]]', ' a.png ']) {
      expect(renderBanner({ cover }, 'T', resolveImage), cover).toMatch(BANNER_OPEN)
    }
  })

  it('sem coverProperty, cover que não cita imagem conta como ausente e cai para o banner', () => {
    for (const cover of [5, 'texto', '', true, ['a.png'], 'x\u0000.png']) {
      const html = renderBanner({ cover, cover_y: '90%', banner: 'b.png', banner_y: '10%', banner_height: 300 }, 'T', resolveImage)
      expect(html, String(cover)).toBe(
        banner("height: 300px; background-image: url('/vault-assets/myvault/b.png'); background-position: center 10%;", 'T'),
      )
    }
    // Sem banner também: nada.
    expect(renderBanner({ cover: 'texto' }, 'T', resolveImage)).toBe('')
    // cover que cita imagem continua vencendo o banner.
    expect(renderBanner({ cover: 'a.png', banner: 'b.png' }, 'T', resolveImage)).toContain("url('/vault-assets/myvault/a.png')")
  })

  it('com coverProperty configurada, não há fallback', () => {
    expect(renderBanner({ cover: 5, banner: 'b.png' }, 'T', resolveImage, 'cover')).toBe('')
    expect(renderBanner({ image: 'texto', banner: 'b.png', cover: 'c.png' }, 'T', resolveImage, 'image')).toBe('')
  })

  it('o resolveImage recebe o valor da capa cru, como antes', () => {
    for (const cover of ['[[Imagens/a.png]]', '[[a.png|apelido]]', ' Imagens/a.png ', 'Imagens\\a.png']) {
      const seen: string[] = []
      renderBanner({ cover }, 'T', p => (seen.push(p), '/x'))
      expect(seen, cover).toEqual([cover])
    }
  })
})
