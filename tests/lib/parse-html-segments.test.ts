import { describe, it, expect } from 'vitest'
import { parseHtmlSegments, sameSegments, COMMENTS_SLOT, PROPERTIES_SLOT } from '../../lib/parse-html-segments'
import { COMMENTS_MARKER } from '../../builder/comments'
import { PROPERTIES_MARKER } from '../../builder/plugins/properties'

const COLS_ENC = encodeURIComponent(JSON.stringify(['Arquivo', 'Status']))
const ROWS_B64 = Buffer.from(JSON.stringify([['Alpha', 'done'], ['Beta', 'wip']])).toString('base64')
const ITEMS_B64 = Buffer.from(JSON.stringify(['item one', 'item two'])).toString('base64')

describe('parseHtmlSegments', () => {
  it('returns single html segment when no dataview divs', () => {
    const segs = parseHtmlSegments('<p>hello</p>')
    expect(segs).toHaveLength(1)
    expect(segs[0]).toEqual({ type: 'html', html: '<p>hello</p>' })
  })

  it('extracts dataview-table segment', () => {
    const html = `<p>before</p><div class="dataview-result" data-type="table" data-columns="${COLS_ENC}" data-result="${ROWS_B64}" data-vault="myv"></div><p>after</p>`
    const segs = parseHtmlSegments(html)
    expect(segs).toHaveLength(3)
    expect(segs[0]).toEqual({ type: 'html', html: '<p>before</p>' })
    expect(segs[1]).toMatchObject({ type: 'dataview-table', columns: ['Arquivo', 'Status'], rows: [['Alpha', 'done'], ['Beta', 'wip']], vault: 'myv' })
    expect(segs[2]).toEqual({ type: 'html', html: '<p>after</p>' })
  })

  it('extracts dataview-list segment', () => {
    const html = `<div class="dataview-result" data-type="list" data-result="${ITEMS_B64}" data-vault="myv"></div>`
    const segs = parseHtmlSegments(html)
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ type: 'dataview-list', items: ['item one', 'item two'], vault: 'myv' })
  })

  it('handles multiple dataview blocks', () => {
    const html = `<h1>Title</h1><div class="dataview-result" data-type="table" data-columns="${COLS_ENC}" data-result="${ROWS_B64}" data-vault="v"></div><hr/><div class="dataview-result" data-type="list" data-result="${ITEMS_B64}" data-vault="v"></div>`
    const segs = parseHtmlSegments(html)
    expect(segs).toHaveLength(4)
    expect(segs[0].type).toBe('html')
    expect(segs[1].type).toBe('dataview-table')
    expect(segs[2].type).toBe('html')
    expect(segs[3].type).toBe('dataview-list')
  })

  it('handles html with no content before first dataview', () => {
    const html = `<div class="dataview-result" data-type="list" data-result="${ITEMS_B64}" data-vault="v"></div><p>end</p>`
    const segs = parseHtmlSegments(html)
    expect(segs).toHaveLength(2)
    expect(segs[0].type).toBe('dataview-list')
    expect(segs[1]).toEqual({ type: 'html', html: '<p>end</p>' })
  })

  const BANNER = `<div class="vault-banner" style="height: 500px; background-image: url('/x.png');"><div class="vault-banner-gradient"></div><h1 class="vault-banner-title">Ntoto Ileri</h1></div>`

  it('extracts a leading banner as its own segment followed by html', () => {
    const html = `${BANNER}<article class="vault-content"><p>body</p></article>`
    const segs = parseHtmlSegments(html)
    expect(segs).toHaveLength(2)
    expect(segs[0]).toEqual({ type: 'banner', html: BANNER })
    expect(segs[1]).toEqual({ type: 'html', html: '<article class="vault-content"><p>body</p></article>' })
  })

  it('leaves html without a banner unchanged', () => {
    const html = '<article class="vault-content"><p>no banner here</p></article>'
    const segs = parseHtmlSegments(html)
    expect(segs).toHaveLength(1)
    expect(segs[0]).toEqual({ type: 'html', html })
  })

  it('splits banner + dataview blocks correctly', () => {
    const html = `${BANNER}<p>before</p><div class="dataview-result" data-type="table" data-columns="${COLS_ENC}" data-result="${ROWS_B64}" data-vault="myv"></div><p>after</p>`
    const segs = parseHtmlSegments(html)
    expect(segs).toHaveLength(4)
    expect(segs[0]).toEqual({ type: 'banner', html: BANNER })
    expect(segs[1]).toEqual({ type: 'html', html: '<p>before</p>' })
    expect(segs[2].type).toBe('dataview-table')
    expect(segs[3]).toEqual({ type: 'html', html: '<p>after</p>' })
  })
})

// ─── Faixa de comentários ───────────────────────────────────────────────────
describe('parseHtmlSegments: segmento de comentários', () => {
  const PROPS = '<details class="vault-properties"><summary>p</summary><div class="vault-properties-body"><div class="vault-prop">x</div></div></details>'
  const BANNER = `<div class="vault-banner" style="height: 500px; background-image: url('/x.png');"><div class="vault-banner-gradient"></div><h1 class="vault-banner-title">Minha Nota</h1></div>`
  const page = (body: string) =>
    `<article class="vault-content"><h1 class="vault-page-title">T</h1>${PROPS}${COMMENTS_MARKER}${body}</article>`

  it('o marcador é o mesmo que o builder escreve', () => {
    expect(COMMENTS_SLOT).toBe(COMMENTS_MARKER)
  })

  it('corta no marcador: Propriedades antes, corpo depois', () => {
    const segs = parseHtmlSegments(page('<p>corpo</p>'), { comments: true })
    expect(segs).toEqual([
      { type: 'html', html: `<article class="vault-content"><h1 class="vault-page-title">T</h1>${PROPS}` },
      { type: 'comments' },
      { type: 'html', html: '<p>corpo</p></article>' },
    ])
  })

  it('sem a opção, o HTML fica inteiro (flag desligada)', () => {
    const html = page('<p>corpo</p>')
    expect(parseHtmlSegments(html)).toEqual([{ type: 'html', html }])
    expect(parseHtmlSegments(html, { comments: false })).toEqual([{ type: 'html', html }])
  })

  it('a mesma string no corpo da nota não vira âncora: só a primeira, depois das Propriedades', () => {
    const body = `<p>antes</p><details><summary>x</summary></details>${COMMENTS_MARKER}<p>depois</p>`
    const segs = parseHtmlSegments(page(body), { comments: true })
    expect(segs.filter(s => s.type === 'comments')).toHaveLength(1)
    expect(segs[1]).toEqual({ type: 'comments' })
    expect(segs[2]).toEqual({ type: 'html', html: `${body}</article>` })
  })

  it('sem o marcador depois das Propriedades, não há faixa', () => {
    const html = `<article class="vault-content"><h1>T</h1><p>a</p>${COMMENTS_MARKER}<p>b</p></article>`
    expect(parseHtmlSegments(html, { comments: true })).toEqual([{ type: 'html', html }])
  })

  it('convive com o banner e com blocos dataview no corpo', () => {
    const body = `<p>a</p><div class="dataview-result" data-type="list" data-result="${ITEMS_B64}" data-vault="v"></div><p>b</p>`
    const html = `${BANNER}<article class="vault-content">${PROPS}${COMMENTS_MARKER}${body}</article>`
    const segs = parseHtmlSegments(html, { comments: true })
    expect(segs.map(s => s.type)).toEqual(['banner', 'html', 'comments', 'html', 'dataview-list', 'html'])
  })

  it('nota comentável sem corpo: sobra só o fecho do artigo depois da faixa', () => {
    const segs = parseHtmlSegments(page(''), { comments: true })
    expect(segs.map(s => s.type)).toEqual(['html', 'comments', 'html'])
    expect(segs[2]).toEqual({ type: 'html', html: '</article>' })
  })
})

describe('sameSegments', () => {
  const html = `<article class="vault-content"><details class="vault-properties"></details>${COMMENTS_SLOT}<p>corpo</p><div class="dataview-result" data-type="list" data-result="${Buffer.from('["a"]').toString('base64')}" data-vault="v"></div></article>`

  it('dois parses do mesmo HTML são iguais', () => {
    const a = parseHtmlSegments(html, { comments: true })
    const b = parseHtmlSegments(html, { comments: true })
    expect(a).not.toBe(b)
    expect(a.some(s => s.type === 'comments')).toBe(true)
    expect(a.some(s => s.type === 'dataview-list')).toBe(true)
    expect(sameSegments(a, b)).toBe(true)
    expect(sameSegments(a, a)).toBe(true)
  })

  it('HTML, dados de dataview, tipo ou tamanho diferentes não são iguais', () => {
    const a = parseHtmlSegments(html, { comments: true })
    expect(sameSegments(a, parseHtmlSegments(html.replace('corpo', 'outro'), { comments: true }))).toBe(false)
    const other = html.replace(Buffer.from('["a"]').toString('base64'), Buffer.from('["b"]').toString('base64'))
    expect(sameSegments(a, parseHtmlSegments(other, { comments: true }))).toBe(false)
    expect(sameSegments(a, parseHtmlSegments(html))).toBe(false)
    expect(sameSegments(a, a.slice(1))).toBe(false)
    expect(sameSegments([{ type: 'html', html: 'x' }], [{ type: 'banner', html: 'x' }])).toBe(false)
  })
})

// ─── Slot de propriedades (formato novo) ────────────────────────────────────
describe('parseHtmlSegments: slot de propriedades', () => {
  const OPEN = '<article class="vault-content">'
  const TITLE = '<h1 class="vault-page-title">T</h1>'
  const BANNER = `<div class="vault-banner" style="height: 500px;"><div class="vault-banner-gradient"></div><h1 class="vault-banner-title">T</h1></div>`
  const novo = `${OPEN}${TITLE}${PROPERTIES_SLOT}${COMMENTS_SLOT}<p>b</p></article>`
  const both = { properties: true, comments: true }

  it('o marcador é o mesmo que o builder escreve', () => {
    expect(PROPERTIES_SLOT).toBe(PROPERTIES_MARKER)
  })

  it('sem banner: html, properties, comments, html', () => {
    const segs = parseHtmlSegments(novo, both)
    expect(segs.map(s => s.type)).toEqual(['html', 'properties', 'comments', 'html'])
    expect((segs[0] as { html: string }).html.endsWith('</h1>')).toBe(true)
    expect((segs[3] as { html: string }).html.startsWith('<p>b</p>')).toBe(true)
  })

  it('com banner: o pedaço só com a abertura do artigo some', () => {
    const html = `${BANNER}${OPEN}${PROPERTIES_SLOT}<p>b</p></article>`
    expect(parseHtmlSegments(html, { properties: true }).map(s => s.type)).toEqual(['banner', 'properties', 'html'])
  })

  it('properties false e comments true: o slot de propriedades fica no html', () => {
    const segs = parseHtmlSegments(novo, { properties: false, comments: true })
    expect(segs.map(s => s.type)).toEqual(['html', 'comments', 'html'])
    expect((segs[0] as { html: string }).html).toContain(PROPERTIES_SLOT)
  })

  it('properties true sem comments: o slot de comentários fica no último html', () => {
    const segs = parseHtmlSegments(novo, { properties: true })
    expect(segs.map(s => s.type)).toEqual(['html', 'properties', 'html'])
    expect((segs[2] as { html: string }).html.startsWith(COMMENTS_SLOT)).toBe(true)
  })

  it('o slot escrito no corpo não é cortado', () => {
    const html = `${OPEN}${TITLE}<p>x</p>${PROPERTIES_SLOT}<p>b</p></article>`
    expect(parseHtmlSegments(html, both)).toEqual([{ type: 'html', html }])
  })

  it('o slot depois de um título que não é o da página não é cortado', () => {
    const html = `${OPEN}<h1>T</h1>${PROPERTIES_SLOT}<p>b</p></article>`
    expect(parseHtmlSegments(html, both)).toEqual([{ type: 'html', html }])
  })

  it('formato antigo corta como antes, sem segmento properties', () => {
    const html = `${OPEN}${TITLE}<details class="vault-properties"></details>${COMMENTS_SLOT}<p>b</p></article>`
    expect(parseHtmlSegments(html, both).map(s => s.type)).toEqual(['html', 'comments', 'html'])
  })

  it('sameSegments trata properties como igual', () => {
    expect(sameSegments([{ type: 'properties' }], [{ type: 'properties' }])).toBe(true)
  })
})
