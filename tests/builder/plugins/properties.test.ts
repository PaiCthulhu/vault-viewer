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
import { propertyColor, type ChipColor } from '../../../lib/property-color'

const files: ScannedFile[] = [
  { absolutePath: '/v/Notes/X.md', relativePath: 'Notes/X', title: 'X' },
]
const resolver = new LinkResolver(files)

function makeConfig(types: Record<string, PropertyType> = {}, readonly: string[] = []): PropertyConfig {
  return { ...EMPTY_PROPERTY_CONFIG, types: new Map(Object.entries(types)), readonly: new Set(readonly) }
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

// ── seleção única e cores escolhidas (.vaultwright) ──────────────────────────
function selectConfig(
  select: Record<string, string[]> = {},
  colors: Record<string, Record<string, ChipColor>> = {},
  extra: Partial<PropertyConfig> = {},
): PropertyConfig {
  return {
    ...EMPTY_PROPERTY_CONFIG,
    select: new Map(Object.entries(select)),
    colors: new Map(Object.entries(colors).map(([k, v]) => [k, new Map(Object.entries(v))])),
    ...extra,
  }
}
const STATUS_CFG = selectConfig(
  { status: ['todo', 'doing', 'done', 'dropped'] },
  { status: { done: 'green', dropped: 'red' } },
)
const rawChip = (color: string, inner: string) => `<span class="vault-prop-chip" data-color="${color}">${inner}</span>`

describe('toPageProperty — select', () => {
  it('valor com cor escolhida: chip, select e colors na ordem das chaves', () => {
    const row = one('status', 'done', STATUS_CFG)
    expect(row).toStrictEqual({
      key: 'status', type: 'text', value: 'done', html: rawChip('green', 'done'),
      select: true, colors: { done: 'green', dropped: 'red' },
    })
    expect(Object.keys(row)).toEqual(['key', 'type', 'value', 'html', 'select', 'colors'])
  })

  it('sem cor escolhida cai em propertyColor; valor aparado; default', () => {
    expect(one('status', 'todo', STATUS_CFG).html).toBe(rawChip(propertyColor('status', 'todo'), 'todo'))
    const row = one('status', ' done ', STATUS_CFG)
    expect(row.html).toBe(rawChip('green', 'done'))
    const def = one('status', 'x', selectConfig({ status: ['x'] }, { status: { x: 'default' } }))
    expect(def.html).toBe(rawChip('default', 'x'))
    expect('colors' in one('status', 'todo', selectConfig({ status: ['todo'] }))).toBe(false)
  })

  it('vazio: html vazio e select; chave do arquivo em outra caixa vale', () => {
    expect(one('status', null, STATUS_CFG)).toMatchObject({ html: '', select: true, value: null })
    const cfg = selectConfig({ Status: ['a'] }, { Status: { a: 'blue' } })
    expect(one('status', 'a', cfg)).toMatchObject({ select: true, colors: { a: 'blue' }, html: rawChip('blue', 'a') })
  })

  it('fora do select: número, lista, data, quebra de linha, mismatch', () => {
    const cases: [unknown, PropertyConfig | undefined][] = [
      [3, undefined],
      [['a'], undefined],
      [new Date('2024-01-02T00:00:00Z'), undefined],
      ['a\nb', undefined],
      ['x', makeConfig({ status: 'number' })],
    ]
    for (const [raw, types] of cases) {
      const withSel = types ? { ...types, select: STATUS_CFG.select, colors: STATUS_CFG.colors } : STATUS_CFG
      const got = one('status', raw, withSel)
      const base = one('status', raw, types)
      expect('select' in got).toBe(false)
      // `colors` só aparece no caso lista (o `colors` de `status` vale para qualquer linha de lista).
      const { colors, ...rest } = got
      expect(colors !== undefined).toBe(Array.isArray(raw))
      expect(rest).toStrictEqual(base)
    }
  })

  it('lista com colors: cor escolhida no chip e colors na linha', () => {
    const cfg = selectConfig({}, { genres: { RPG: 'purple' } })
    const row = one('genres', ['RPG', 'Indie'], cfg)
    expect(row.html).toBe(rawChip('purple', 'RPG') + rawChip(propertyColor('genres', 'Indie'), 'Indie'))
    expect(row.colors).toStrictEqual({ RPG: 'purple' })
    expect('select' in row).toBe(false)
  })

  it('readonly + select: trava, select e chip', () => {
    const cfg = selectConfig({ status: ['done'] }, {}, { readonly: new Set(['status']) })
    expect(one('status', 'done', cfg)).toMatchObject({ locked: 'readonly', select: true, html: rawChip(propertyColor('status', 'done'), 'done') })
  })

  it('__proto__ como valor de colors e da nota', () => {
    const cfg = selectConfig({ status: ['__proto__'] }, { status: Object.fromEntries([['__proto__', 'red']]) as Record<string, ChipColor> })
    const row = one('status', '__proto__', cfg)
    expect(row.html).toBe(rawChip('red', '__proto__'))
    expect(Object.hasOwn(row.colors!, '__proto__')).toBe(true)
  })

  it('__proto__ e constructor como CHAVE da propriedade', () => {
    for (const key of ['__proto__', 'constructor']) {
      const cfg = selectConfig(
        Object.fromEntries([[key, ['todo', 'done']]]),
        Object.fromEntries([[key, { done: 'green' as ChipColor }]]),
      )
      const fm = JSON.parse(`{"${key}": "done"}`) as Record<string, unknown>
      const rows = props(fm, false, cfg)
      expect(rows).toHaveLength(1)
      const row = rows[0]
      expect(row.key).toBe(key)
      expect(row.select).toBe(true)
      expect(Object.hasOwn(row, 'colors')).toBe(true)
      expect(row.colors).toStrictEqual({ done: 'green' })
      expect(row.html).toBe(rawChip('green', 'done'))
    }
  })

  it('valor com quebra de linha no fim: a checagem roda no valor sem aparar', () => {
    const withSel = one('status', 'done\n', STATUS_CFG)
    expect('select' in withSel).toBe(false)
    const { colors, ...rest } = withSel
    expect(colors).toBeUndefined()
    expect(rest).toStrictEqual(one('status', 'done\n'))
  })

  it('sem .vaultwright: só key, type, value, html', () => {
    for (const [k, raw] of [['a', 'texto'], ['genres', ['x']], ['n', 3]] as [string, unknown][]) {
      expect(Object.keys(one(k, raw))).toEqual(['key', 'type', 'value', 'html'])
    }
  })
})

describe('collectPropertyValues — select', () => {
  const pagesOf = (...vals: unknown[]) => vals.map(v => ({ properties: props({ status: v }, false, STATUS_CFG) }))

  it('opções na ordem do arquivo, depois os usados fora delas em pt-BR', () => {
    const pages = pagesOf('done', 'zeta', 'alpha', '')
    expect(collectPropertyValues(pages, STATUS_CFG)).toStrictEqual({
      status: ['todo', 'doing', 'done', 'dropped', 'alpha', 'zeta'],
    })
  })

  it('só valores vazios: a chave sai com as opções', () => {
    expect(collectPropertyValues(pagesOf(null, ''), STATUS_CFG)).toStrictEqual({
      status: ['todo', 'doing', 'done', 'dropped'],
    })
  })

  it('linha travada não entra: nem valor nem chave', () => {
    const cfg = { ...STATUS_CFG, readonly: new Set(['status']) }
    const pages = [{ properties: props({ status: 'zeta' }, false, cfg) }]
    // Travada, a linha não entra no índice (como hoje): nem valor, nem chave.
    expect(collectPropertyValues(pages, cfg)).toStrictEqual({})
  })

  it('__proto__ como OPÇÃO: entra como valor, sem poluir o protótipo', () => {
    const cfg = selectConfig({ status: ['__proto__', 'todo'] })
    const pages = [{ properties: props({ status: 'zeta' }, false, cfg) }]
    const protoBefore = Object.getPrototypeOf({})
    const out = collectPropertyValues(pages, cfg)
    expect(out.status).toStrictEqual(['__proto__', 'todo', 'zeta'])
    expect(Object.getPrototypeOf(out)).toBe(protoBefore)
    expect(({} as Record<string, unknown>).todo).toBeUndefined()
    expect(({} as Record<string, unknown>).zeta).toBeUndefined()
  })

  it('sem config, a saída de hoje', () => {
    const pages = [{ properties: props({ status: 'zeta', genres: ['b', 'a'] }) }]
    expect(collectPropertyValues(pages)).toStrictEqual({ genres: ['a', 'b'] })
  })
})

describe('toPageProperty — relation', () => {
  const rel = (extra: Partial<PropertyConfig> = {}): PropertyConfig => ({
    ...EMPTY_PROPERTY_CONFIG,
    relation: new Map([['related', 'Games'], ['tags', 'Games']]),
    ...extra,
  })

  it('lista com relation ganha relation: true', () => {
    const plain = one('related', ['[[A]]', 'solto'])
    expect(one('related', ['[[A]]', 'solto'], rel())).toStrictEqual({
      key: 'related', type: 'multitext', value: ['[[A]]', 'solto'], html: plain.html, relation: true,
    })
  })

  it.each([['texto', '[[A]]'], ['nulo', null], ['número', 5]])('%s: sem relation', (_n, raw) => {
    expect(one('related', raw, rel())).toStrictEqual(one('related', raw))
  })

  it('mismatch: sem relation', () => {
    const cfg = rel({ types: new Map([['related', 'multitext' as PropertyType]]) })
    expect(one('related', '[[A]]', cfg).relation).toBeUndefined()
  })

  it('tags: sem relation', () => {
    expect(one('tags', ['a'], rel()).relation).toBeUndefined()
  })

  it('relation + colors: chaves terminam em colors, relation', () => {
    const cfg = rel({ colors: new Map([['related', new Map([['a', 'red' as const]])]]) })
    expect(Object.keys(one('related', ['a'], cfg)).slice(-2)).toStrictEqual(['colors', 'relation'])
  })

  it('relation + readonly', () => {
    const r = one('related', ['a'], rel({ readonly: new Set(['related']) }))
    expect(r.locked).toBe('readonly')
    expect(r.relation).toBe(true)
  })

  it('lista sem relation no config: sem a chave', () => {
    expect(Object.keys(one('related', ['a']))).not.toContain('relation')
  })
})
