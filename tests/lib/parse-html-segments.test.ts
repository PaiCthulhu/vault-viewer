import { describe, it, expect } from 'vitest'
import { parseHtmlSegments } from '../../lib/parse-html-segments'

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
