import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { VaultConfig } from '../../types'
import type { PageProperty } from '../../builder/types'
import { buildVault } from '../../builder/pipeline'
import { COMMENTS_MARKER } from '../../builder/comments'
import { PROPERTIES_MARKER } from '../../builder/plugins/properties'
import { propertyColor } from '../../lib/property-color'

let TMP: string
let vault: VaultConfig

function write(rel: string, content: string) {
  const f = path.join(TMP, 'vault', rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, content)
}

function listFiles(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const abs = path.join(dir, e.name)
    return e.isDirectory() ? listFiles(abs, base) : [path.relative(base, abs).split(path.sep).join('/')]
  }).sort()
}

// Registra os arquivos gravados, na ordem, sem mudar o comportamento.
function spyWrites(): { file: string; content: string }[] {
  const writes: { file: string; content: string }[] = []
  const real = fs.writeFileSync
  vi.spyOn(fs, 'writeFileSync').mockImplementation(((f: fs.PathOrFileDescriptor, d: string | NodeJS.ArrayBufferView, o?: fs.WriteFileOptions) => {
    writes.push({ file: String(f).replace(/\.tmp-\d+$/, '').split(path.sep).join('/'), content: String(d) })
    return real(f, d, o)
  }) as typeof fs.writeFileSync)
  return writes
}

const ARTICLE_OPEN = '<article class="vault-content">'
const COMENTARIO = '_comments/Notes/Game/2026-11-16 120000 ana-aaaa'
const IGNORADO = '_comments/Notes/Game/broken'

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-properties-test-'))
  write('.obsidian/types.json', JSON.stringify({ types: { rating: 'number' } }))
  write('.vaultwright/properties.json', JSON.stringify({ version: 1, properties: { status: { readonly: true } } }))
  write(
    'Notes/Game.md',
    '---\nstatus: done\nrating: 4\ngenres: [RPG]\nplayed_on: 2024-01-12\nnote_type: character\n---\n# Game\n\ncorpo do jogo\n',
  )
  write('Notes/Other.md', '---\nrating: "cinco"\ngenres: [Ação, RPG]\ntags: [solo, co-op]\n---\noutro\n')
  write('Notes/Hidden Only.md', '---\ncssclasses: wide-page\ntab_label: X\nnotion-id: abc\ncover_y: 30\n---\nsó escondidas\n')
  write('Notes/Empty.md', '---\nstatus:\n---\nvazia\n')
  write('Notes/Banner.md', '---\ncover: img/c.png\nstatus: done\n---\ncom banner\n')
  write('img/c.png', 'c')
  write('Notes/Game Tab.md', '---\nnote_type: tab\nparent: "[[Notes/Game]]"\ngenres: [Tabbed]\n---\naba\n')
  write(
    `${COMENTARIO}.md`,
    '---\nnote_type: comment\nparent: "[[Notes/Game]]"\nauthor: ana\ngenres: [Secret]\ntags: [secret-tag]\n---\noi\n',
  )
  // Sem `note_type`: ignorado por estar em `_comments/`.
  write(`${IGNORADO}.md`, '---\nparent: "[[Notes/Game]]"\ngenres: [Ignored]\n---\nnada\n')
  vault = { slug: 'v', name: 'V', path: path.join(TMP, 'vault') } as VaultConfig
  vi.spyOn(process, 'cwd').mockReturnValue(TMP)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(TMP, { recursive: true, force: true })
})

const read = (out: string, rel: string) => JSON.parse(fs.readFileSync(path.join(out, 'v', rel), 'utf-8'))

async function build(opts: { first?: string[] } = {}): Promise<string> {
  const out = path.join(TMP, 'out')
  await buildVault(vault, { dataRoot: out, ...opts })
  return out
}

describe('buildVault — propriedades: página comum', () => {
  it('page.properties traz as chaves visíveis, na ordem, sem note_type', async () => {
    const out = await build()
    const page = read(out, 'pages/Notes/Game.json')
    expect((page.properties as PageProperty[]).map(p => p.key)).toEqual(['status', 'rating', 'genres', 'played_on'])
  })

  it('o marcador vem logo depois do título, sem o <details> antigo', async () => {
    const out = await build()
    const html: string = read(out, 'pages/Notes/Game.json').html
    expect(html).toContain(`</h1>${PROPERTIES_MARKER}`)
    expect(html.indexOf(PROPERTIES_MARKER, html.indexOf(PROPERTIES_MARKER) + 1)).toBe(-1)
    expect(html).not.toContain('vault-properties"')
  })

  it('a página com propriedades é comentável', async () => {
    const out = await build()
    expect(read(out, 'pages/Notes/Game.json').commentable).toBe(true)
  })
})

describe('buildVault — propriedades: marcador e corte', () => {
  it('numa página comentável, o marcador de comentários vem logo depois do de propriedades', async () => {
    const out = await build()
    const html: string = read(out, 'pages/Notes/Game.json').html
    expect(html.indexOf(PROPERTIES_MARKER + COMMENTS_MARKER)).not.toBe(-1)
    expect(html.indexOf('corpo do jogo')).toBeGreaterThan(html.indexOf(COMMENTS_MARKER))
  })

  it('numa aba há o marcador de propriedades, mas não o de comentários nem commentable', async () => {
    const out = await build()
    const aba = read(out, 'pages/Notes/Game Tab.json')
    expect((aba.properties as PageProperty[]).map(p => p.key)).toEqual(['genres'])
    expect(aba.html).toContain(PROPERTIES_MARKER)
    expect(aba.html).not.toContain(COMMENTS_MARKER)
    expect('commentable' in aba).toBe(false)
  })

  it('página só com chaves escondidas: sem properties, sem marcador, sem commentable', async () => {
    const out = await build()
    const page = read(out, 'pages/Notes/Hidden Only.json')
    expect('properties' in page).toBe(false)
    expect(page.html).not.toContain(PROPERTIES_MARKER)
    expect(page.html).not.toContain(COMMENTS_MARKER)
    expect('commentable' in page).toBe(false)
  })

  it('página sem frontmatter: sem properties, sem marcador', async () => {
    write('Notes/Plain.md', 'só corpo\n')
    const out = await build()
    const page = read(out, 'pages/Notes/Plain.json')
    expect('properties' in page).toBe(false)
    expect(page.html).not.toContain(PROPERTIES_MARKER)
    expect('commentable' in page).toBe(false)
  })

  it('com banner, o html começa pelo banner e o artigo começa pelo marcador', async () => {
    const out = await build()
    const page = read(out, 'pages/Notes/Banner.json')
    const html: string = page.html
    expect(html.startsWith('<div class="vault-banner"')).toBe(true)
    const article = html.slice(html.indexOf(ARTICLE_OPEN))
    expect(article.startsWith(ARTICLE_OPEN + PROPERTIES_MARKER + COMMENTS_MARKER)).toBe(true)
    expect((page.properties as PageProperty[]).map(p => p.key)).toEqual(['status'])
  })
})

describe('buildVault — propriedades: vazia comentável', () => {
  it('nota só com uma propriedade vazia tem uma linha e é comentável', async () => {
    const out = await build()
    const page = read(out, 'pages/Notes/Empty.json')
    expect(page.properties).toHaveLength(1)
    expect(page.properties[0]).toMatchObject({ key: 'status', value: null, html: '' })
    expect(page.commentable).toBe(true)
    expect(page.html).toContain(PROPERTIES_MARKER + COMMENTS_MARKER)
  })
})

describe('buildVault — propriedades: types.json e readonly', () => {
  const prop = (page: { properties: PageProperty[] }, key: string) => page.properties.find(p => p.key === key)!

  it('rating "cinco" com rating: number no types.json é mismatch', async () => {
    const out = await build()
    // Sem o types.json, "cinco" seria texto comum, sem mismatch: a config foi lida.
    const rating = prop(read(out, 'pages/Notes/Other.json'), 'rating')
    expect(rating).toMatchObject({ type: 'number', value: 'cinco', mismatch: true })
    expect(prop(read(out, 'pages/Notes/Game.json'), 'rating')).toMatchObject({ type: 'number', value: 4 })
    expect('mismatch' in prop(read(out, 'pages/Notes/Game.json'), 'rating')).toBe(false)
  })

  it('status readonly no .vaultwright fica travado', async () => {
    const out = await build()
    expect(prop(read(out, 'pages/Notes/Game.json'), 'status').locked).toBe('readonly')
    expect('locked' in prop(read(out, 'pages/Notes/Game.json'), 'genres')).toBe(false)
  })

  it('types.json ilegível não derruba o build: avisa e segue sem os tipos', async () => {
    write('.obsidian/types.json', '{ isto não é json')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = await build()
    const rating = prop(read(out, 'pages/Notes/Other.json'), 'rating')
    expect(rating.type).toBe('text')
    expect('mismatch' in rating).toBe(false)
    expect(warn.mock.calls.map(c => c.join(' ')).some(m => m.includes('types.json'))).toBe(true)
  })

  it('a configuração é lida uma vez por build', async () => {
    const realRead = fs.readFileSync
    const lidos: string[] = []
    vi.spyOn(fs, 'readFileSync').mockImplementation(((f: fs.PathOrFileDescriptor, o?: unknown) => {
      lidos.push(String(f).split(path.sep).join('/'))
      return (realRead as (...a: unknown[]) => unknown)(f, o)
    }) as typeof fs.readFileSync)
    await build()
    expect(lidos.filter(f => f.endsWith('/.obsidian/types.json'))).toHaveLength(1)
    expect(lidos.filter(f => f.endsWith('/.vaultwright/properties.json'))).toHaveLength(1)
  })
})

describe('buildVault — propriedades: índice de valores', () => {
  it('property-values.json tem os valores de lista das notas, abas incluídas', async () => {
    const out = await build()
    expect(read(out, 'property-values.json')).toStrictEqual({
      genres: ['Ação', 'RPG', 'Tabbed'],
      tags: ['co-op', 'solo'],
    })
  })

  it('é JSON compacto', async () => {
    const out = await build()
    const raw = fs.readFileSync(path.join(out, 'v', 'property-values.json'), 'utf-8')
    expect(raw).toBe(JSON.stringify(JSON.parse(raw)))
  })

  it('comentário e .md ignorado de _comments/ não entram', async () => {
    const out = await build()
    const raw = fs.readFileSync(path.join(out, 'v', 'property-values.json'), 'utf-8')
    for (const v of ['Secret', 'secret-tag', 'Ignored']) expect(raw).not.toContain(v)
  })

  it('vault sem propriedades de lista grava um objeto vazio', async () => {
    for (const f of ['Notes/Game.md', 'Notes/Other.md', 'Notes/Game Tab.md', `${COMENTARIO}.md`, `${IGNORADO}.md`]) {
      fs.rmSync(path.join(TMP, 'vault', f))
    }
    const out = await build()
    expect(read(out, 'property-values.json')).toStrictEqual({})
  })

  it('é gravado depois do assets.json e antes do index.json', async () => {
    const writes = spyWrites()
    await build()
    const idx = (re: RegExp) => writes.findIndex(w => re.test(w.file))
    const iValues = idx(/\/v\/property-values\.json$/)
    const iAssets = idx(/\/v\/assets\.json$/)
    const iIndex = idx(/\/v\/index\.json$/)
    expect(iValues).toBeGreaterThan(-1)
    expect(iAssets).toBeGreaterThan(-1)
    expect(iAssets).toBeLessThan(iValues)
    expect(iValues).toBeLessThan(iIndex)
    for (const [i, w] of writes.entries()) {
      if (/\/pages\/.+\.json$/.test(w.file)) expect(i).toBeLessThan(iValues)
    }
  })
})

describe('buildVault — propriedades: --first', () => {
  it('a frente não grava property-values.json: ele sai uma vez, depois das páginas', async () => {
    const writes = spyWrites()
    await build({ first: ['Notes/Game'] })
    const iValues = writes.map((w, i) => (/\/property-values\.json$/.test(w.file) ? i : -1)).filter(i => i >= 0)
    expect(iValues).toHaveLength(1)
    const iGame = writes.findIndex(w => /\/pages\/Notes\/Game\.json$/.test(w.file))
    const iPagesIndex = writes.findIndex(w => /\/pages-index\.json$/.test(w.file))
    expect(iGame).toBeLessThan(iValues[0])
    expect(iPagesIndex).toBeLessThan(iValues[0])
  })

  it('com e sem --first a saída é igual byte a byte, exceto o index.json', async () => {
    const A = path.join(TMP, 'outA')
    const B = path.join(TMP, 'outB')
    await buildVault(vault, { dataRoot: A })
    await buildVault(vault, { dataRoot: B, first: ['Notes/Game'] })

    const a = listFiles(path.join(A, 'v'))
    expect(listFiles(path.join(B, 'v'))).toEqual(a)
    expect(a).toContain('property-values.json')
    const strip = (raw: string) => {
      const o = JSON.parse(raw)
      delete o.builtAt
      delete o.startedAt
      return o
    }
    for (const f of a) {
      const ca = fs.readFileSync(path.join(A, 'v', f), 'utf-8')
      const cb = fs.readFileSync(path.join(B, 'v', f), 'utf-8')
      if (f === 'index.json') expect(strip(cb)).toEqual(strip(ca))
      else expect(cb, f).toBe(ca)
    }
  })
})

describe('buildVault — seleção única e cores escolhidas', () => {
  const chip = (color: string, text: string) => `<span class="vault-prop-chip" data-color="${color}">${text}</span>`

  it('a linha de select, o chip na cor escolhida e o índice na ordem da lista', async () => {
    write('.vaultwright/properties.json', JSON.stringify({
      version: 1,
      properties: {
        status: { select: ['todo', 'doing', 'done'], colors: { done: 'green' } },
        genres: { colors: { RPG: 'purple' } },
      },
    }))
    const out = await build()
    const game = read(out, 'pages/Notes/Game.json').properties as PageProperty[]
    expect(game.find(r => r.key === 'status')).toStrictEqual({
      key: 'status', type: 'text', value: 'done', html: chip('green', 'done'),
      select: true, colors: { done: 'green' },
    })
    expect(game.find(r => r.key === 'genres')).toStrictEqual({
      key: 'genres', type: 'multitext', value: ['RPG'], html: chip('purple', 'RPG'), colors: { RPG: 'purple' },
    })
    const rating = game.find(r => r.key === 'rating')!
    expect('select' in rating || 'colors' in rating).toBe(false)

    write('Notes/Other.md', '---\nstatus: other\n---\noutro\n')
    const out2 = await build()
    expect(read(out2, 'property-values.json').status).toStrictEqual(['todo', 'doing', 'done', 'other'])
  })

  it('sem .vaultwright a saída é a de sempre', async () => {
    fs.rmSync(path.join(TMP, 'vault', '.vaultwright'), { recursive: true })
    const out = await build()
    const game = read(out, 'pages/Notes/Game.json').properties
    expect(game).toStrictEqual([
      { key: 'status', type: 'text', value: 'done', html: 'done' },
      { key: 'rating', type: 'number', value: 4, html: '4' },
      { key: 'genres', type: 'multitext', value: ['RPG'], html: chip(propertyColor('genres', 'RPG'), 'RPG') },
      { key: 'played_on', type: 'date', value: '2024-01-12', html: '12/01/2024' },
    ])
    expect(fs.readFileSync(path.join(out, 'v', 'property-values.json'), 'utf-8')).toBe(
      '{"genres":["Ação","RPG","Tabbed"],"tags":["co-op","solo"]}',
    )
  })
})
