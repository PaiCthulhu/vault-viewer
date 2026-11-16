import { describe, it, expect, vi } from 'vitest'
import {
  MAX_COMMENT_NESTING,
  commentTooDeep,
  renderComment,
  renderCommentFallback,
} from '../../builder/comment-render'

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

  it('link relativo ao protocolo (//host e variantes com contrabarra) perde o href', () => {
    // URLs como o navegador as veria depois de tirar tab/LF/CR e as pontas. No markdown, a
    // contrabarra antes de pontuação é escape: `\\` vira uma contrabarra só.
    const destinos = [
      '//evil.example/x',
      String.raw`/\evil.example`,
      String.raw`\\/evil.example`,
      String.raw`\\\\evil.example`,
      '</\t/evil.example>',
      '<\t//evil.example>',
      '< //evil.example>',
    ]
    for (const d of destinos) {
      for (const md of [`[x](${d})`, `[x][r]\n\n[r]: ${d}`]) {
        const html = renderComment(md, opts)
        expect(html, md).not.toContain('<a')
        expect(html, md).not.toMatch(/href="[^"]*evil\.example/)
        expect(html, md).toContain('x')
      }
    }
  })

  it('link relativo comum continua virando <a>', () => {
    for (const md of ['[x](/vault/x)', '[x](x/y)', '[x][r]\n\n[r]: /vault/x', '[x][r]\n\n[r]: x/y']) {
      expect(renderComment(md, opts), md).toContain('<a href')
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

describe('limite de aninhamento', () => {
  const N = MAX_COMMENT_NESTING
  // Os três casos confirmados de estouro de pilha (todos dentro do teto de 10.000 caracteres).
  const confirmados: [string, string][] = [
    ['3.000 ">"', '>'.repeat(3000)],
    ['"- " × 4.990', '- '.repeat(4990)],
    ['"1. " × 3.300', '1. '.repeat(3300)],
  ]

  it('o limite é 32', () => {
    expect(N).toBe(32)
  })

  for (const [nome, corpo] of confirmados) {
    it(`${nome}: passa do limite, não lança e devolve o fallback`, () => {
      expect(commentTooDeep(corpo)).toBe(true)
      const onFallback = vi.fn()
      const html = renderComment(corpo, { ...opts, onFallback })
      expect(html).toBe(renderCommentFallback(corpo))
      expect(onFallback).toHaveBeenCalledTimes(1)
    })
  }

  it('fallback: texto escapado, CRLF normalizado, <br> em cada quebra, dentro de <p>', () => {
    expect(renderCommentFallback('a<b\r\nc & "d" >e\rf')).toBe('<p>a&lt;b<br>\nc &amp; &quot;d&quot; &gt;e<br>\nf</p>')
  })

  it('aninhamento inline profundo passa do limite', () => {
    const corpo = '*a '.repeat(40) + 'b' + ' a*'.repeat(40)
    expect(commentTooDeep(corpo)).toBe(true)
    expect(renderComment(corpo, opts)).toBe(renderCommentFallback(corpo))
  })

  it('citação: 32 níveis passam, 33 não', () => {
    expect(commentTooDeep('>'.repeat(N) + ' a')).toBe(false)
    expect(commentTooDeep('>'.repeat(N + 1) + ' a')).toBe(true)
    expect(renderComment('>'.repeat(N) + ' a', opts).match(/<blockquote>/g)).toHaveLength(N)
  })

  it('lista: 32 níveis passam, 33 não', () => {
    expect(commentTooDeep('- '.repeat(N) + 'a')).toBe(false)
    expect(commentTooDeep('- '.repeat(N + 1) + 'a')).toBe(true)
    expect(commentTooDeep('1. '.repeat(N) + 'a')).toBe(false)
    expect(commentTooDeep('1. '.repeat(N + 1) + 'a')).toBe(true)
    expect(renderComment('- '.repeat(N) + 'a', opts).match(/<ul>/g)).toHaveLength(N)
  })

  it('lista aninhada por recuo: 32 níveis passam, 33 não', () => {
    const recuo = (n: number) => Array.from({ length: n }, (_, i) => `${'  '.repeat(i)}- item ${i}`).join('\n')
    expect(commentTooDeep(recuo(N))).toBe(false)
    expect(commentTooDeep(recuo(N + 1))).toBe(true)
  })

  it('níveis de bloco e inline somam no mesmo caminho', () => {
    const corpo = '>'.repeat(20) + ' ' + '*a '.repeat(13) + 'b' + ' a*'.repeat(13)
    expect(commentTooDeep(corpo)).toBe(true)
    const no = '>'.repeat(20) + ' ' + '*a '.repeat(12) + 'b' + ' a*'.repeat(12)
    expect(commentTooDeep(no)).toBe(false)
  })

  it('recuo que continua as listas das linhas de cima também conta', () => {
    // Cada linha continua pelo recuo (com tabs) os itens das anteriores e abre mais 32.
    let corpo = ''
    for (let depth = 0; corpo.length < 9000; depth += 32) {
      corpo += `${'\t'.repeat(Math.floor((depth * 2) / 4))}${'  '.repeat(depth % 2)}${'- '.repeat(32)}a\n`
    }
    expect(commentTooDeep(corpo)).toBe(true)
    expect(() => renderComment(corpo, opts)).not.toThrow()
  })

  it('delimitadores inline demais num parágrafo passam do limite', () => {
    expect(commentTooDeep(']'.repeat(10000))).toBe(true)
    expect(commentTooDeep('*'.repeat(5000) + 'a' + '*'.repeat(5000))).toBe(true)
    // Separados por linha em branco, a conta recomeça em cada parágrafo.
    expect(commentTooDeep(Array(40).fill('**a** _b_ ~~c~~ [[x]]').join('\n\n'))).toBe(false)
  })

  it('células de tabela demais no corpo passam do limite (o parse cresce com o quadrado delas)', () => {
    expect(commentTooDeep('|a|\n|-|\n' + 'a\n'.repeat(4995))).toBe(true)
    expect(commentTooDeep('|a|b|\n|-|-|\n' + '|1|2|\n'.repeat(1600))).toBe(true)
    expect(commentTooDeep(`${'|a'.repeat(2400)}|\n${'|-'.repeat(2400)}|`)).toBe(true)
    // O custo é do total do corpo: muitas tabelas pequenas também contam.
    expect(commentTooDeep('|a|b|\n|-|-|\n|1|2|\n\n'.repeat(300))).toBe(true)
    // Tabela de tamanho comum, e a mesma quantidade de linhas sem tabela nenhuma.
    const tabela = '|a|b|\n|-|-|\n' + '|1|2|\n'.repeat(50)
    expect(commentTooDeep(tabela)).toBe(false)
    expect(renderComment(tabela, opts)).toContain('<table>')
    expect(commentTooDeep('a\n'.repeat(4995))).toBe(false)
  })

  it('corpo comum continua com o render normal', () => {
    const corpo = '> citação **forte**\n\n- item\n  - sub [[x]]\n\n1. um'
    expect(commentTooDeep(corpo)).toBe(false)
    const onFallback = vi.fn()
    const html = renderComment(corpo, { ...opts, onFallback })
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<strong>forte</strong>')
    expect(html).toContain('<a href="/vault/v/Notas/X">x</a>')
    expect(html).toContain('<ol>')
    expect(onFallback).not.toHaveBeenCalled()
  })

  it('pior caso em bem menos de 1 s (os números precisos vão para o relatório)', () => {
    const piores = [
      ...confirmados.map(([, c]) => c),
      '>'.repeat(10000),
      '*'.repeat(5000) + 'a' + '*'.repeat(5000),
      '['.repeat(5000) + ']'.repeat(5000),
      ']'.repeat(10000),
      '*a '.repeat(1666),
      '|a|\n|-|\n' + 'a\n'.repeat(4995),
      // O pior medido com render normal: lista plana, custo linear do remark.
      '- a\n'.repeat(2500),
    ]
    for (const corpo of piores) {
      const t = performance.now()
      renderComment(corpo, opts)
      expect(performance.now() - t).toBeLessThan(1000)
    }
  })
})
