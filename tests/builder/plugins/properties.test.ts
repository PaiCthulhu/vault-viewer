import { describe, it, expect } from 'vitest'
import {
  buildPageProperties,
  collectPropertyValues,
  isHiddenProperty,
  PROPERTIES_MARKER,
  renderPropertyValue,
  toPageProperty,
  type PropertyRenderContext,
} from '../../../builder/plugins/properties'
import { LinkResolver } from '../../../builder/link-resolver'
import { EMPTY_PROPERTY_CONFIG, type PropertyConfig } from '../../../builder/property-types'
import type { ScannedFile } from '../../../builder/scanner'
import type { PageProperty, PropertyType } from '../../../builder/types'
import { propertyColor } from '../../../lib/property-color'

const files: ScannedFile[] = [
  { absolutePath: '/v/Notes/X.md', relativePath: 'Notes/X', title: 'X' },
]
const resolver = new LinkResolver(files)

function makeConfig(types: Record<string, PropertyType> = {}, readonly: string[] = []): PropertyConfig {
  return { types: new Map(Object.entries(types)), readonly: new Set(readonly) }
}

function makeCtx(config: PropertyConfig = EMPTY_PROPERTY_CONFIG) {
  const images: string[] = []
  const ctx: PropertyRenderContext = {
    renderWikilinks: s => resolver.replaceWikilinksEscaped(s, 'my-vault'),
    resolveImage: p => {
      images.push(p)
      return '/vault-assets/my-vault/' + p
    },
    config,
  }
  return { ctx, images }
}

const one = (key: string, raw: unknown, config?: PropertyConfig) =>
  toPageProperty(key, raw, makeCtx(config).ctx)

const props = (fm: Record<string, unknown>, familyNote = false, config?: PropertyConfig) =>
  buildPageProperties(fm, makeCtx(config).ctx, { familyNote })

const chip = (key: string, item: string, inner: string) =>
  `<span class="vault-prop-chip" data-color="${propertyColor(key, item)}">${inner}</span>`

const CHECKED = '<input type="checkbox" class="vault-prop-checkbox" checked disabled>'
const UNCHECKED = '<input type="checkbox" class="vault-prop-checkbox" disabled>'

describe('PROPERTIES_MARKER', () => {
  it('é o div vazio do slot', () => {
    expect(PROPERTIES_MARKER).toBe('<div class="vault-properties-slot"></div>')
  })
})

describe('isHiddenProperty', () => {
  it('esconde sempre as chaves de apresentação, em qualquer caixa', () => {
    for (const key of ['cover', 'cover_y', 'banner', 'banner_height', 'cssclasses', 'notion-id', 'tab_label', 'note_type', 'Cover', 'NOTE_TYPE']) {
      expect(isHiddenProperty(key, false)).toBe(true)
    }
  })

  it('parent e order só somem na nota-filha, e só em minúsculas', () => {
    expect(isHiddenProperty('parent', false)).toBe(false)
    expect(isHiddenProperty('order', false)).toBe(false)
    expect(isHiddenProperty('parent', true)).toBe(true)
    expect(isHiddenProperty('order', true)).toBe(true)
    expect(isHiddenProperty('Parent', true)).toBe(false)
    expect(isHiddenProperty('ORDER', true)).toBe(false)
  })

  it('não esconde chaves parecidas', () => {
    expect(isHiddenProperty('cover_art', false)).toBe(false)
    expect(isHiddenProperty('status', true)).toBe(false)
  })
})

describe('buildPageProperties: chaves escondidas', () => {
  const keys = (rows: PageProperty[]) => rows.map(r => r.key)

  it('nota comum esconde as chaves de apresentação e note_type, e mostra parent e order', () => {
    const rows = props({
      cover: 'img/c.png',
      banner: 'img/b.png',
      cssclasses: ['wide-page'],
      tab_label: 'Playing',
      note_type: 'character',
      parent: '[[Notes/X]]',
      order: 3,
      author: 'Ana',
    })
    expect(keys(rows)).toEqual(['parent', 'order', 'author'])
  })

  it('nota-filha (aba ou comentário) também esconde parent e order', () => {
    const rows = props({ note_type: 'tab', parent: '[[Notes/X]]', order: 1, tab_label: 'X', author: 'Ana' }, true)
    expect(keys(rows)).toEqual(['author'])
  })

  it('aba só com os campos do formato não tem linha nenhuma', () => {
    expect(props({ note_type: 'tab', parent: '[[Notes/X]]', order: 1 }, true)).toEqual([])
  })
})

describe('buildPageProperties: vazias e ordem', () => {
  const rows = () => props({ status: null, rating: 5, genres: [], title: '' })

  it('mantém as vazias, na ordem do frontmatter', () => {
    expect(rows().map(r => r.key)).toEqual(['status', 'rating', 'genres', 'title'])
  })

  it('valor nulo é text vazio', () => {
    expect(rows()[0]).toStrictEqual({ key: 'status', type: 'text', value: null, html: '' })
  })

  it('número vira number', () => {
    expect(rows()[1]).toStrictEqual({ key: 'rating', type: 'number', value: 5, html: '5' })
  })

  it('lista vazia é multitext vazio', () => {
    expect(rows()[2]).toStrictEqual({ key: 'genres', type: 'multitext', value: [], html: '' })
  })

  it('texto vazio é text nulo', () => {
    expect(rows()[3]).toStrictEqual({ key: 'title', type: 'text', value: null, html: '' })
  })

  it('chaves com nome de membro do protótipo viram linhas comuns', () => {
    const fm = JSON.parse('{"constructor":"x","toString":"y"}') as Record<string, unknown>
    expect(props(fm)).toStrictEqual([
      { key: 'constructor', type: 'text', value: 'x', html: 'x' },
      { key: 'toString', type: 'text', value: 'y', html: 'y' },
    ])
  })
})

describe('toPageProperty: escape', () => {
  it('tag no texto sai escapada', () => {
    const p = one('note', '<script>alert(1)</script>')
    expect(p.html).not.toContain('<script')
    expect(p.html).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('alias de wikilink com HTML sai escapado', () => {
    const p = one('link', '[[Notes/X|<img src=x onerror=alert(1)>]]')
    expect(p.html).toContain('&lt;img')
    expect(p.html).not.toContain('<img')
  })

  it('texto em volta do wikilink sai escapado', () => {
    const p = one('link', '<b>see</b> [[X]]')
    expect(p.html).toBe('&lt;b&gt;see&lt;/b&gt; <a href="/vault/my-vault/Notes/X">X</a>')
  })

  it('item de lista com HTML sai escapado dentro do chip', () => {
    const p = one('genres', ['<b>x</b>'])
    expect(p.html).toBe(chip('genres', '<b>x</b>', '&lt;b&gt;x&lt;/b&gt;'))
  })

  it('& e aspas no texto e no chip saem escapados', () => {
    expect(one('note', 'a & b').html).toBe('a &amp; b')
    expect(one('note', `"x" it's`).html).toBe('&quot;x&quot; it&#39;s')
    expect(one('genres', [`it's "x"`]).html).toBe(chip('genres', `it's "x"`, 'it&#39;s &quot;x&quot;'))
  })
})

describe('toPageProperty: chips', () => {
  it('cada item de lista vira um chip com a cor da etiqueta, sem separador', () => {
    const p = one('genres', ['RPG', 'Ação'])
    expect(p.html).toBe(chip('genres', 'RPG', 'RPG') + chip('genres', 'Ação', 'Ação'))
  })

  it('wikilink num item vira link dentro do chip', () => {
    const p = one('genres', ['[[Notes/X|Alias]]'])
    expect(p.html).toBe(chip('genres', '[[Notes/X|Alias]]', '<a href="/vault/my-vault/Notes/X">Alias</a>'))
  })

  it('URL de imagem num item vira link, não miniatura, e não trava', () => {
    const { ctx, images } = makeCtx()
    const p = toPageProperty('links', ['https://example.com/a.png'], ctx)
    expect(p.html).toContain('<a href="https://example.com/a.png">https://example.com/a.png</a>')
    expect(p.html).not.toContain('<img')
    expect('locked' in p).toBe(false)
    expect(images).toEqual([])
  })

  it('cada item de uma lista de URLs vira link no seu chip', () => {
    const p = one('links', ['https://a.example/', 'https://b.example/'])
    expect(p.html).toBe(
      chip('links', 'https://a.example/', '<a href="https://a.example/">https://a.example/</a>') +
        chip('links', 'https://b.example/', '<a href="https://b.example/">https://b.example/</a>'),
    )
  })

  it('item de imagem vira miniatura solta, sem chip, e trava como imagem', () => {
    const { ctx, images } = makeCtx()
    const p = toPageProperty('gallery', ['[[img/one.png]]', 'img/two.jpeg'], ctx)
    expect(p.html).toBe(
      '<img class="vault-prop-thumb" src="/vault-assets/my-vault/img/one.png" alt="" />' +
        '<img class="vault-prop-thumb" src="/vault-assets/my-vault/img/two.jpeg" alt="" />',
    )
    expect(p.html).not.toContain('<a ')
    expect(p.locked).toBe('image')
    expect(images).toEqual(['img/one.png', 'img/two.jpeg'])
  })

  it('lista mista: a imagem fica solta e o texto vira chip', () => {
    const p = one('gallery', ['RPG', '[[img/one.png]]'])
    expect(p.html).toBe(
      chip('gallery', 'RPG', 'RPG') + '<img class="vault-prop-thumb" src="/vault-assets/my-vault/img/one.png" alt="" />',
    )
    expect(p.locked).toBe('image')
  })

  it('tags vira chips com o tipo tags', () => {
    const p = one('tags', ['b', 'a'])
    expect(p.type).toBe('tags')
    expect(p.value).toEqual(['b', 'a'])
    expect(p.html).toBe(chip('tags', 'b', 'b') + chip('tags', 'a', 'a'))
  })
})

describe('toPageProperty: datas e checkbox', () => {
  it('Date à meia-noite UTC é date, dd/MM/yyyy', () => {
    const p = one('played_on', new Date(Date.UTC(2024, 0, 12)))
    expect(p).toStrictEqual({ key: 'played_on', type: 'date', value: '2024-01-12', html: '12/01/2024' })
  })

  it('Date com hora é datetime, dd/MM/yyyy HH:mm', () => {
    const p = one('played_on', new Date(Date.UTC(2024, 0, 12, 23, 27)))
    expect(p).toStrictEqual({ key: 'played_on', type: 'datetime', value: '2024-01-12T23:27', html: '12/01/2024 23:27' })
  })

  it('data-hora em string com espaço também vira datetime', () => {
    const p = one('played_on', '2024-01-12 10:00')
    expect(p).toStrictEqual({ key: 'played_on', type: 'datetime', value: '2024-01-12T10:00', html: '12/01/2024 10:00' })
  })

  it('true vira checkbox marcado', () => {
    expect(one('done', true)).toStrictEqual({ key: 'done', type: 'checkbox', value: true, html: CHECKED })
  })

  it('false vira checkbox desmarcado, não o texto "false"', () => {
    expect(one('done', false)).toStrictEqual({ key: 'done', type: 'checkbox', value: false, html: UNCHECKED })
  })

  it('texto "false" entre aspas continua texto', () => {
    expect(one('done', 'false')).toStrictEqual({ key: 'done', type: 'text', value: 'false', html: 'false' })
  })
})

describe('toPageProperty: mismatch', () => {
  it('texto numa propriedade number mostra o texto e marca mismatch', () => {
    const p = one('rating', 'cinco', makeConfig({ rating: 'number' }))
    expect(p).toStrictEqual({ key: 'rating', type: 'number', value: 'cinco', html: 'cinco', mismatch: true })
  })

  it('string solta numa propriedade multitext marca mismatch e fica texto', () => {
    const p = one('genres', 'RPG', makeConfig({ genres: 'multitext' }))
    expect(p).toStrictEqual({ key: 'genres', type: 'multitext', value: 'RPG', html: 'RPG', mismatch: true })
  })

  it('string solta em tags marca mismatch sem config', () => {
    const p = one('tags', 'foo')
    expect(p).toStrictEqual({ key: 'tags', type: 'tags', value: 'foo', html: 'foo', mismatch: true })
  })

  it('o html segue o tipo inferido do valor', () => {
    const p = one('rating', new Date(Date.UTC(2024, 0, 12)), makeConfig({ rating: 'number' }))
    expect(p).toStrictEqual({ key: 'rating', type: 'number', value: '2024-01-12', html: '12/01/2024', mismatch: true })
  })

  it('valor que cabe no tipo não tem a chave mismatch', () => {
    const p = one('rating', 5, makeConfig({ rating: 'number' }))
    expect('mismatch' in p).toBe(false)
    expect('locked' in p).toBe(false)
  })
})

describe('toPageProperty: travas', () => {
  it('wikilink de imagem trava como imagem e escapa o src', () => {
    const { ctx, images } = makeCtx()
    const p = toPageProperty('cover_art', '[[img/a b&c.png]]', ctx)
    expect(p.locked).toBe('image')
    expect(p.html).toContain('src="/vault-assets/my-vault/img/a%20b&amp;c.png"')
    expect(images).toEqual(['img/a b&c.png'])
  })

  it('objeto aninhado trava como objeto, com o JSON escapado e sem mismatch', () => {
    const p = one('meta', { a: 1 })
    expect(p).toStrictEqual({ key: 'meta', type: 'text', value: { a: 1 }, html: '{&quot;a&quot;:1}', locked: 'object' })
  })

  it('o JSON de um objeto escapa HTML dentro dele e não resolve imagem', () => {
    const { ctx, images } = makeCtx()
    const p = toPageProperty('meta', { a: '<b>[[img/x.png]]</b>' }, ctx)
    expect(p.html).toBe('{&quot;a&quot;:&quot;&lt;b&gt;[[img/x.png]]&lt;/b&gt;&quot;}')
    expect(images).toEqual([])
  })

  it('lista com objeto trava como objeto', () => {
    const p = one('list', [1, { a: 1 }])
    expect(p.locked).toBe('object')
    expect(p.type).toBe('multitext')
    expect(p.value).toEqual([1, { a: 1 }])
    expect('mismatch' in p).toBe(false)
  })

  it('chave readonly trava como readonly', () => {
    const p = one('status', 'x', makeConfig({}, ['status']))
    expect(p).toStrictEqual({ key: 'status', type: 'text', value: 'x', html: 'x', locked: 'readonly' })
  })

  it('readonly vence imagem', () => {
    const p = one('cover_art', '[[img/a.png]]', makeConfig({}, ['cover_art']))
    expect(p.locked).toBe('readonly')
    expect(p.html).toContain('vault-prop-thumb')
  })

  it('readonly vence objeto', () => {
    const p = one('meta', { a: 1 }, makeConfig({}, ['meta']))
    expect(p.locked).toBe('readonly')
    expect(p.html).toBe('{&quot;a&quot;:1}')
  })

  it('readonly convive com mismatch', () => {
    const p = one('rating', 'cinco', makeConfig({ rating: 'number' }, ['rating']))
    expect(p).toStrictEqual({ key: 'rating', type: 'number', value: 'cinco', html: 'cinco', locked: 'readonly', mismatch: true })
  })
})

describe('toPageProperty: imagens, links e URLs (casos antigos)', () => {
  it('caminho de imagem sem colchetes vira miniatura', () => {
    const p = one('photo', 'assets/cover.webp')
    expect(p.html).toBe('<img class="vault-prop-thumb" src="/vault-assets/my-vault/assets/cover.webp" alt="" />')
    expect(p.locked).toBe('image')
  })

  it('wikilink de imagem usa o caminho antes do alias', () => {
    const { ctx, images } = makeCtx()
    const p = toPageProperty('photo', '[[img/x.png|caption]]', ctx)
    expect(p.html).toContain('src="/vault-assets/my-vault/img/x.png"')
    expect(p.html).not.toContain('caption')
    expect(images).toEqual(['img/x.png'])
  })

  it('wikilink que não é imagem vira link, e link morto vira span', () => {
    expect(one('place', '[[X]]').html).toBe('<a href="/vault/my-vault/Notes/X">X</a>')
    expect(one('place', '[[Nowhere]]').html).toBe('<span class="vault-dead-link">Nowhere</span>')
    expect(one('place', '[[X]]').html).not.toContain('vault-prop-thumb')
  })

  it('URL inteira vira link clicável', () => {
    const url = 'https://example.com/threads/some-game.12345/'
    expect(one('url', url).html).toBe(`<a href="${url}">${url}</a>`)
  })

  it('aceita http e ignora espaço em volta', () => {
    expect(one('url', '  http://example.com/a  ').html).toBe('<a href="http://example.com/a">http://example.com/a</a>')
  })

  it('URL de imagem vira link, não miniatura do vault', () => {
    const p = one('url', 'https://cdn.example/capa.png')
    expect(p.html).toBe('<a href="https://cdn.example/capa.png">https://cdn.example/capa.png</a>')
    expect('locked' in p).toBe(false)
  })

  it('escapa aspas e & no href e no texto', () => {
    expect(one('url', 'https://x.example/?a=1&b="2"').html).toBe(
      '<a href="https://x.example/?a=1&amp;b=&quot;2&quot;">https://x.example/?a=1&amp;b=&quot;2&quot;</a>',
    )
  })

  it('não linka outros esquemas', () => {
    const p = one('url', 'javascript:alert(1)')
    expect(p.html).not.toContain('<a')
    expect(p.html).toBe('javascript:alert(1)')
  })

  it('não linka valor com espaço no meio (texto que só contém uma URL)', () => {
    expect(one('note', 'ver https://a.example/ depois').html).toBe('ver https://a.example/ depois')
  })
})

describe('renderPropertyValue', () => {
  const { ctx } = makeCtx()

  it('vazio dá string vazia', () => {
    expect(renderPropertyValue('status', 'text', null, ctx)).toBe('')
    expect(renderPropertyValue('genres', 'multitext', [], ctx)).toBe('')
    expect(renderPropertyValue('done', 'checkbox', null, ctx)).toBe('')
  })

  it('número sai como texto', () => {
    expect(renderPropertyValue('rating', 'number', 4.5, ctx)).toBe('4.5')
  })

  it('data e data-hora a partir da string normalizada', () => {
    expect(renderPropertyValue('played_on', 'date', '2024-01-12', ctx)).toBe('12/01/2024')
    expect(renderPropertyValue('played_on', 'datetime', '2024-01-12T23:27', ctx)).toBe('12/01/2024 23:27')
  })

  it('valor fora da forma do tipo sai como texto escapado, sem resolver imagem', () => {
    const { ctx: c, images } = makeCtx()
    expect(renderPropertyValue('played_on', 'date', '<b>x.png', c)).toBe('&lt;b&gt;x.png')
    expect(renderPropertyValue('done', 'checkbox', 'yes', c)).toBe('yes')
    expect(images).toEqual([])
  })
})

describe('toPageProperty: caminho de imagem que o encodeURI recusa', () => {
  it('um surrogate solto vira texto escapado, sem derrubar o build', () => {
    const row = one('screenshots', 'img/\uD800<b>.png')
    expect(row.html).toBe('img/\uD800&lt;b&gt;.png')
    expect(row.locked).toBe('image')
    const list = one('screenshots', ['img/\uD800.png', 'img/ok.png'])
    expect(list.html).toBe('img/\uD800.png<img class="vault-prop-thumb" src="/vault-assets/my-vault/img/ok.png" alt="" />')
  })
})

describe('collectPropertyValues', () => {
  it('uma chave __proto__ vira chave própria do índice, sem mexer no protótipo', () => {
    const fm = JSON.parse('{"__proto__":["b","a"]}') as Record<string, unknown>
    const out = collectPropertyValues([{ properties: props(fm) }])
    expect(Object.hasOwn(out, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(Object.getOwnPropertyDescriptor(out, '__proto__')?.value).toEqual(['a', 'b'])
    const back = JSON.parse(JSON.stringify(out)) as Record<string, string[]>
    expect(Object.hasOwn(back, '__proto__')).toBe(true)
  })

  const row = (key: string, type: PropertyType, value: PageProperty['value'], extra: Partial<PageProperty> = {}): PageProperty => ({
    key,
    type,
    value,
    html: '',
    ...extra,
  })

  it('junta os itens de lista por chave, distintos e em ordem pt-BR', () => {
    const out = collectPropertyValues([
      { properties: [row('genres', 'multitext', ['RPG', 'Ação'])] },
      { properties: [row('genres', 'multitext', ['ação', 'RPG']), row('tags', 'tags', ['b', 'a'])] },
      {},
    ])
    expect(out).toStrictEqual({ genres: ['ação', 'Ação', 'RPG'], tags: ['a', 'b'] })
    expect(Object.keys(out)).toEqual(['genres', 'tags'])
  })

  it('ordena as chaves em pt-BR', () => {
    const out = collectPropertyValues([
      { properties: [row('tags', 'tags', ['a']), row('Ação', 'multitext', ['x']), row('genres', 'multitext', ['y'])] },
    ])
    expect(Object.keys(out)).toEqual(['Ação', 'genres', 'tags'])
  })

  it('desempata por unidade de código quando o localeCompare empata', () => {
    const nfc = 'é'
    const nfd = 'é'
    const out = collectPropertyValues([{ properties: [row('genres', 'multitext', [nfc, nfd])] }])
    expect(out.genres).toEqual([nfd, nfc])
  })

  it('linha travada não entra', () => {
    const out = collectPropertyValues([
      { properties: [row('genres', 'multitext', ['Secret'], { locked: 'readonly' })] },
      { properties: [row('list', 'multitext', ['1'], { locked: 'object' })] },
    ])
    expect(out).toStrictEqual({})
  })

  it('string solta com mismatch numa lista entra', () => {
    const out = collectPropertyValues([{ properties: [row('genres', 'multitext', 'Solo', { mismatch: true })] }])
    expect(out).toStrictEqual({ genres: ['Solo'] })
  })

  it('string solta com mismatch numa lista entra aparada; só espaços não entra', () => {
    const out = collectPropertyValues([
      { properties: [row('genres', 'multitext', ' RPG ', { mismatch: true })] },
      { properties: [row('genres', 'multitext', ['RPG'])] },
      { properties: [row('tags', 'tags', '  \t ', { mismatch: true })] },
    ])
    expect(out).toStrictEqual({ genres: ['RPG'] })
  })

  it('aparada também nas linhas de buildPageProperties', () => {
    const config = makeConfig({ genres: 'multitext' })
    const pages = [
      { properties: props({ genres: ' RPG ', tags: ' solo ' }, false, config) },
      { properties: props({ genres: ['RPG'] }, false, config) },
    ]
    expect(collectPropertyValues(pages)).toStrictEqual({ genres: ['RPG'], tags: ['solo'] })
  })

  it('string vazia, linha text e lista vazia não entram', () => {
    const out = collectPropertyValues([
      {
        properties: [
          row('genres', 'multitext', '', { mismatch: true }),
          row('status', 'text', 'done'),
          row('rating', 'number', 'cinco', { mismatch: true }),
          row('aliases', 'aliases', []),
        ],
      },
    ])
    expect(out).toStrictEqual({})
  })

  it('agrupa pela chave exata', () => {
    const out = collectPropertyValues([
      { properties: [row('genres', 'multitext', ['a']), row('Genres', 'multitext', ['b'])] },
    ])
    expect(out).toStrictEqual({ genres: ['a'], Genres: ['b'] })
  })

  it('funciona sobre as linhas de buildPageProperties', () => {
    const pages = [
      { properties: props({ genres: ['RPG'], tags: 'solo', status: 'done', cover_art: ['[[img/a.png]]'] }) },
      { properties: props({ genres: ['Ação'], tags: ['co-op'] }) },
    ]
    expect(collectPropertyValues(pages)).toStrictEqual({ genres: ['Ação', 'RPG'], tags: ['co-op', 'solo'] })
  })
})
