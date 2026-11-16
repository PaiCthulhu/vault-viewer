import { describe, it, expect } from 'vitest'
import { renderComment } from '../../builder/comment-render'

const mapa: Record<string, string> = { 'notas/x': 'Notas/X', x: 'Notas/X' }
const opts = {
  vaultSlug: 'v',
  resolveLink: (t: string) => mapa[t.toLowerCase()],
}

describe('renderComment', () => {
  it('HTML cru inline sai escapado', () => {
    const html = renderComment('oi <b>x</b>', opts)
    expect(html).toContain('&#x3C;b>x&#x3C;/b>')
    expect(html).not.toContain('<b>')
  })

  it('HTML cru em bloco sai escapado', () => {
    const a = renderComment('<div onclick="alert(1)">bloco</div>', opts)
    expect(a).not.toMatch(/<div|<script/)
    expect(a).toContain('bloco')
    const b = renderComment('<script>alert(1)</script>', opts)
    expect(b).not.toMatch(/<div|<script/)
  })

  it('dataviewjs não executa e sai como código literal', () => {
    const html = renderComment('```dataviewjs\nglobalThis.__c2pwned = 1\ndv.paragraph("x")\n```', opts)
    expect(html).toContain('<code class="language-dataviewjs">')
    expect(html).toContain('globalThis.__c2pwned = 1')
    expect(html).toContain('dv.paragraph("x")')
    expect(html).not.toContain('<p>x</p>')
  })

  it('dataview DQL sai como código literal', () => {
    const html = renderComment('```dataview\nLIST FROM "Notas"\n```', opts)
    expect(html).toContain('language-dataview')
    expect(html).toContain('LIST FROM')
    expect(html).not.toContain('dataview-result')
  })

  it('embed ![[img]] não vira <img>', () => {
    const html = renderComment('![[foto.png]]', opts)
    expect(html).not.toContain('<img')
    expect(html).toContain('![[foto.png]]')
    expect(html).not.toContain('<a')
  })

  it('imagem markdown não vira <img>', () => {
    for (const md of ['![alt](x.png)', '![alt][r]\n\n[r]: x.png']) {
      const html = renderComment(md, opts)
      expect(html).not.toContain('<img')
      expect(html).toContain(md.startsWith('![alt](') ? '![alt](x.png)' : '![alt][r]')
    }
    expect(renderComment('![alt](x.png)', opts)).toContain('![alt](x.png)')
  })

  it('link markdown funciona', () => {
    expect(renderComment('[site](https://example.com)', opts)).toContain(
      '<a href="https://example.com">site</a>',
    )
    for (const md of ['[a](/vault/v/Notas/X)', '[a](#sec)', '[a](mailto:a@b.c)']) {
      expect(renderComment(md, opts)).toContain('<a href')
    }
  })

  it('link com esquema perigoso perde o href', () => {
    const casos = [
      '[a](javascript:alert(1))',
      '[a](JavaScript:alert(1))',
      '[a](data:text/html,x)',
      '<javascript:alert(1)>',
      '[a][r]\n\n[r]: javascript:alert(1)',
    ]
    for (const md of casos) {
      const html = renderComment(md, opts)
      expect(html, md).not.toMatch(/href="(javascript|data)/i)
    }
    expect(renderComment('[a](javascript:alert(1))', opts)).toContain('a')
    expect(renderComment('[a](javascript:alert(1))', opts)).not.toContain('<a')
    expect(renderComment('[a][r]\n\n[r]: javascript:alert(1)', opts)).toContain('[a][r]')
  })

  it('wikilink resolvido vira link', () => {
    expect(renderComment('[[Notas/X]]', opts)).toContain('<a href="/vault/v/Notas/X">Notas/X</a>')
    expect(renderComment('[[x|apelido]]', opts)).toContain('<a href="/vault/v/Notas/X">apelido</a>')
    expect(renderComment('[[X#Minha Seção]]', opts)).toMatch(/href="\/vault\/v\/Notas\/X#minha-seção"/)
    expect(renderComment('[[#Seção|ali]]', opts)).toContain('<a href="#seção">ali</a>')
    const comEspaco = renderComment('[[Qualquer]]', {
      vaultSlug: 'v',
      resolveLink: () => 'Notas/Minha Nota',
    })
    expect(comEspaco).toContain('Notas/Minha%20Nota')
  })

  it('wikilink não resolvido vira vault-dead-link', () => {
    expect(renderComment('[[Não Existe]]', opts)).toContain(
      '<span class="vault-dead-link">Não Existe</span>',
    )
  })

  it('wikilink com apelido em HTML sai escapado', () => {
    const html = renderComment('[[x|<img src=x onerror=alert(1)>]]', opts)
    expect(html).not.toContain('<img')
  })

  it('wikilink em código fica literal', () => {
    expect(renderComment('`[[Notas/X]]`', opts)).toContain('<code>[[Notas/X]]</code>')
  })

  it('callout não é processado', () => {
    const html = renderComment('> [!note] Título\n> corpo', opts)
    expect(html).toContain('<blockquote>')
    expect(html).toContain('[!note]')
    expect(html).not.toContain('callout')
  })

  it('quebra simples vira <br>', () => {
    expect(renderComment('linha 1\nlinha 2', opts)).toMatch(/linha 1<br>\s*linha 2/)
    const dois = renderComment('a\n\nb', opts)
    expect(dois).toContain('<p>a</p>')
    expect(dois).toContain('<p>b</p>')
    expect(renderComment('```\nl1\nl2\n```', opts)).not.toContain('<br>')
  })

  it('normaliza CRLF: quebra simples vira <br> sem \\r', () => {
    for (const md of ['a\r\nb', 'a\rb']) {
      const html = renderComment(md, opts)
      expect(html).not.toContain('\r')
      expect(html).toContain('<br>')
    }
  })

  it('rodapé GFM sai como texto literal, sem ids nem seção de notas', () => {
    const html = renderComment('Veja[^1].\n\n[^1]: a nota', opts)
    for (const proibido of ['user-content-fn', 'footnote-label', 'data-footnotes', '<section', '<sup', ' id=']) {
      expect(html, proibido).not.toContain(proibido)
    }
    expect(html).toContain('<p>Veja[^1].</p>')
    expect(html).toContain('<p>[^1]: a nota</p>')
  })

  it('definição de rodapé com continuação indentada sai literal, com <br>', () => {
    const html = renderComment('Veja[^n].\n\n[^n]: linha 1\n    linha 2', opts)
    // O mdast-util-to-hast apara o recuo do começo da linha, como num parágrafo comum.
    expect(html).toContain('<p>[^n]: linha 1<br>\nlinha 2</p>')
    expect(html).not.toContain('<sup')
  })

  it('conteúdo da definição de rodapé não é interpretado', () => {
    const html = renderComment('[^x]: **negrito** <b>x</b> [[Notas/X]]', opts)
    expect(html).not.toContain('<strong>')
    expect(html).not.toContain('<b>')
    expect(html).not.toContain('<a')
    // rehype-stringify escapa `<` como `&#x3C;` (mesma forma do teste de HTML cru).
    expect(html).toContain('[^x]: **negrito** &#x3C;b>x&#x3C;/b> [[Notas/X]]')
  })

  it('referência de rodapé sem definição continua texto', () => {
    const html = renderComment('Veja[^2].', opts)
    expect(html).toBe('<p>Veja[^2].</p>')
  })

  it('markdown comum funciona', () => {
    const html = renderComment('**negrito** ~~riscado~~\n\n- item', opts)
    expect(html).toContain('<strong>')
    expect(html).toContain('<del>')
    expect(html).toContain('<li>')
    const h = renderComment('# T', opts)
    expect(h).toContain('<h1>T</h1>')
    expect(h).not.toContain('id=')
  })
})
