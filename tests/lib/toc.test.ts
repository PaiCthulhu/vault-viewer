import { describe, it, expect } from 'vitest'
import { extractToc } from '../../lib/toc'

describe('extractToc', () => {
  it('extracts anchorable headings in order, skipping titles and id-less ones', () => {
    const html = `
      <div class="vault-banner-wrap">
        <div class="vault-banner-title">Banner Title</div>
      </div>
      <article class="vault-article">
        <h1 class="vault-page-title">Page Title</h1>
        <h2 id="intro">Introdução</h2>
        <h3 id="details">Detalhes &amp; <strong>mais</strong></h3>
        <h3>Sem âncora</h3>
        <h2 id="conclusao">  Conclusão  </h2>
      </article>`

    const toc = extractToc(html)

    expect(toc).toEqual([
      { level: 2, id: 'intro', text: 'Introdução' },
      { level: 3, id: 'details', text: 'Detalhes & mais' },
      { level: 2, id: 'conclusao', text: 'Conclusão' },
    ])
  })

  it('skips headings whose text is empty after stripping tags', () => {
    const html = '<h2 id="empty"><span></span></h2><h2 id="ok">Real</h2>'
    const toc = extractToc(html)
    expect(toc).toEqual([{ level: 2, id: 'ok', text: 'Real' }])
  })

  it('returns [] when there are no qualifying headings', () => {
    expect(extractToc('<p>no headings here</p>')).toEqual([])
    expect(extractToc('')).toEqual([])
  })

  it('decodes common entities and collapses whitespace', () => {
    const html = `<h2 id="x">A   &lt;b&gt; &quot;c&quot; &#39;d&#39;\n  e</h2>`
    const toc = extractToc(html)
    expect(toc).toEqual([{ level: 2, id: 'x', text: 'A <b> "c" \'d\' e' }])
  })
})
