import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { VaultConfig } from '../../types'
import { buildVault } from '../../builder/pipeline'
import { PROPERTIES_MARKER } from '../../builder/plugins/properties'

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

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-test-'))
  write('Inicio.md', '# Inicio\n\n[[Pasta/A]]\n\n![[a.png]]\n\n```dataview\nLIST FROM "Pasta"\n```\n')
  write('Pasta/A.md', '# A\n\ntexto A\n')
  write('Pasta/B.md', '# B\n\n![[b.png]]\n')
  write('Imagens/a.png', 'a')
  write('Imagens/b.png', 'b')
  write('Mapa.canvas', JSON.stringify({ nodes: [{ id: '1', type: 'text', text: 'oi', x: 0, y: 0, width: 100, height: 50 }], edges: [] }))
  vault = { slug: 'v', name: 'V', path: path.join(TMP, 'vault') } as VaultConfig
  vi.spyOn(process, 'cwd').mockReturnValue(TMP)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(TMP, { recursive: true, force: true })
})

describe('buildVault --first', () => {
  it('--first dá saída idêntica à do build sem ele', async () => {
    const A = path.join(TMP, 'outA')
    const B = path.join(TMP, 'outB')
    await buildVault(vault, { dataRoot: A })
    await buildVault(vault, { dataRoot: B, first: ['Pasta/B', 'Inicio'] })

    const a = listFiles(path.join(A, 'v'))
    expect(listFiles(path.join(B, 'v'))).toEqual(a)
    expect(a.length).toBeGreaterThan(5)
    for (const f of a) {
      const ca = fs.readFileSync(path.join(A, 'v', f), 'utf-8')
      const cb = fs.readFileSync(path.join(B, 'v', f), 'utf-8')
      if (f === 'index.json') {
        const strip = (raw: string) => {
          const o = JSON.parse(raw)
          delete o.builtAt
          delete o.startedAt
          return o
        }
        expect(strip(cb)).toEqual(strip(ca))
      } else {
        expect(cb, f).toBe(ca)
      }
    }
  })

  it('nada é escrito em public/', async () => {
    await buildVault(vault, { dataRoot: path.join(TMP, 'out'), first: ['Pasta/B'] })
    expect(fs.existsSync(path.join(TMP, 'public'))).toBe(false)
  })

  it('a página da frente sai antes do resto, com assets.json antes dela', async () => {
    const out = path.join(TMP, 'out')
    const writes = spyWrites()

    await buildVault(vault, { dataRoot: out, first: ['Pasta/B'] })

    const idx = (re: RegExp) => writes.findIndex(w => re.test(w.file))
    const iAssets = idx(/\/assets\.json$/)
    const iB = idx(/\/pages\/Pasta\/B\.json$/)
    const iIndex = idx(/\/pages-index\.json$/)
    const outros = writes
      .map((w, i) => (/\/pages\/.+\.json$/.test(w.file) && !/Pasta\/B\.json$/.test(w.file) ? i : -1))
      .filter(i => i >= 0)

    expect(iAssets).toBeGreaterThanOrEqual(0)
    expect(JSON.parse(writes[iAssets].content)).toContain('Imagens/b.png')
    expect(iAssets).toBeLessThan(iB)
    expect(iB).toBeLessThan(iIndex)
    for (const i of outros) expect(iIndex).toBeLessThan(i)
    const final = fs.readFileSync(path.join(out, 'v', 'pages-index.json'), 'utf-8')
    expect(writes[iIndex].content).toBe(final)
  })

  it('assets.json anterior que não é array é tratado como vazio', async () => {
    const out = path.join(TMP, 'out')
    fs.mkdirSync(path.join(out, 'v'), { recursive: true })
    for (const lixo of ['{}', 'null', '7']) {
      fs.writeFileSync(path.join(out, 'v', 'assets.json'), lixo)
      await buildVault(vault, { dataRoot: out, first: ['Pasta/B'] })
      expect(fs.existsSync(path.join(out, 'v', 'pages', 'Pasta', 'B.json'))).toBe(true)
      expect(JSON.parse(fs.readFileSync(path.join(out, 'v', 'assets.json'), 'utf-8'))).toContain('Imagens/b.png')
    }
  })

  it('assets.json da frente é a união com o anterior; o final só tem os atuais', async () => {
    const out = path.join(TMP, 'out')
    fs.mkdirSync(path.join(out, 'v'), { recursive: true })
    fs.writeFileSync(path.join(out, 'v', 'assets.json'), JSON.stringify(['Antiga/x.png']))
    const writes = spyWrites()

    await buildVault(vault, { dataRoot: out, first: ['Pasta/B'] })

    const iAssets = writes.findIndex(w => /\/assets\.json$/.test(w.file))
    const iB = writes.findIndex(w => /\/pages\/Pasta\/B\.json$/.test(w.file))
    expect(iAssets).toBeLessThan(iB)
    const da_frente = JSON.parse(writes[iAssets].content)
    expect(da_frente).toContain('Antiga/x.png')
    expect(da_frente).toContain('Imagens/b.png')
    const final = JSON.parse(fs.readFileSync(path.join(out, 'v', 'assets.json'), 'utf-8'))
    expect(final).not.toContain('Antiga/x.png')
  })

  it('nota alterada depois do startedAt anterior vai na frente sozinha', async () => {
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })

    const futuro = new Date(Date.now() + 60_000)
    fs.utimesSync(path.join(TMP, 'vault', 'Pasta', 'A.md'), futuro, futuro)

    const writes = spyWrites()
    await buildVault(vault, { dataRoot: out })

    const primeira = writes.find(w => /\/pages\/.+\.json$/.test(w.file))
    expect(primeira?.file).toMatch(/\/pages\/Pasta\/A\.json$/)
  })
})

describe('buildVault — frontmatter só em YAML', () => {
  const read = (out: string, rel: string) => JSON.parse(fs.readFileSync(path.join(out, 'v', rel), 'utf-8'))

  it('nota com frontmatter em JavaScript: o bloco não roda e a nota sai como a de YAML quebrado', async () => {
    const g = globalThis as { __pipelineNotaJsRan?: boolean }
    delete g.__pipelineNotaJsRan
    write('Notas/Js.md', '---js\n{ title: "Rodou", tags: ["x"], status: (globalThis.__pipelineNotaJsRan = true, "ativo") }\n---\ncorpo da nota\n')
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    expect(g.__pipelineNotaJsRan).toBeUndefined()
    const page = read(out, 'pages/Notas/Js.json')
    expect(page.frontmatter).toEqual({})
    expect(page.title).toBe('Js')
    expect(page.tags).toEqual([])
    expect('commentable' in page).toBe(false)
    expect('properties' in page).toBe(false)
    expect(page.html).not.toContain(PROPERTIES_MARKER)
    expect(page.html).not.toContain('vault-prop')
    // O arquivo inteiro é o corpo: o texto do bloco aparece, sem rodar.
    expect(page.html).toContain('__pipelineNotaJsRan')
    expect(page.html).toContain('corpo da nota')
  })
})

describe('buildVault — nota-filha e abas', () => {
  const COMENTARIO = '_comments/Pasta/A/2026-11-16 153012 ana-k3f9'
  const FILHAS = ['Ômega/Lista', 'Ômega/Sumário', 'Ômega/Arquivo', 'Só Filhas/Aba X', COMENTARIO]

  beforeEach(() => {
    // A mãe cita uma aba e o comentário: nem isso vira aresta.
    write('Ômega/Ômega.md', `---\ntab_label: Panorama\n---\n# Ômega\n\n[[Pasta/B]] [[Ômega/Lista]] [[${COMENTARIO}]]\n`)
    write('Ômega/Lista.md', '---\nnote_type: tab\nparent: "[[Ômega/Ômega]]"\norder: 1\n---\n[[Pasta/A]]\n')
    write('Ômega/Sumário.md', '---\nnote_type: tab\nparent: "[[ômega/ÔMEGA]]"\norder: 2\n---\nz\n')
    write('Ômega/Arquivo.md', '---\nnote_type: tab\nparent: "[[Ômega/Ômega]]"\n---\nx\n')
    write('Só Filhas/Aba X.md', '---\nnote_type: tab\nparent: "[[Pasta/A]]"\n---\n[[Pasta/B]]\n')
    write(`${COMENTARIO}.md`, '---\nnote_type: comment\nparent: "[[Pasta/A]]"\nauthor: ana\n---\n[[Pasta/B]]\n')
    write('Órfã.md', '---\nnote_type: tab\nparent: "[[Não Existe]]"\n---\nórfã\n')
  })

  const read = (out: string, rel: string) => JSON.parse(fs.readFileSync(path.join(out, 'v', rel), 'utf-8'))

  it('comentário não gera página; abas e aba órfã geram', async () => {
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    const files = listFiles(path.join(out, 'v', 'pages'))
    expect(files.some(f => f.startsWith('_comments/'))).toBe(false)
    for (const f of ['Ômega/Lista.json', 'Ômega/Sumário.json', 'Ômega/Arquivo.json', 'Só Filhas/Aba X.json', 'Órfã.json']) {
      expect(files).toContain(f)
    }
    expect(read(out, 'index.json').pageCount).toBe(files.length)
  })

  it('filhas ficam fora do pages-index; a aba órfã e a mãe ficam', async () => {
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    const paths = (read(out, 'pages-index.json') as { path: string }[]).map(p => p.path)
    for (const p of FILHAS) expect(paths).not.toContain(p)
    expect(paths).toContain('Ômega/Ômega')
    expect(paths).toContain('Órfã')
  })

  it('árvore: some a pasta só de filhas e _comments; a mãe nota de pasta segue absorvida, sem as abas', async () => {
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    type N = { name: string; path: string | null; isFolder: boolean; children: N[] }
    const tree = read(out, 'tree.json') as N[]
    const names = tree.map(n => n.name)
    expect(names).not.toContain('Só Filhas')
    expect(names).not.toContain('_comments')
    const omega = tree.find(n => n.isFolder && n.name === 'Ômega')!
    expect(omega.path).toBe('Ômega/Ômega')
    expect(omega.children).toEqual([])
    expect(tree.find(n => n.path === 'Órfã')).toBeDefined()
  })

  it('grafo sem nós de filha e sem arestas de/para filha', async () => {
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    const g = read(out, 'graph.json') as { nodes: { id: string }[]; edges: { source: string; target: string }[] }
    const ids = g.nodes.map(n => n.id)
    for (const f of FILHAS) expect(ids).not.toContain(f)
    for (const e of g.edges) {
      expect(FILHAS).not.toContain(e.source)
      expect(FILHAS).not.toContain(e.target)
    }
    // A aba Lista cita Pasta/A, mas não vira backlink dela.
    expect(g.edges.filter(e => e.target === 'Pasta/A').map(e => e.source)).toEqual(['Inicio'])
    expect(g.edges.filter(e => e.source === 'Ômega/Ômega').map(e => e.target)).toEqual(['Pasta/B'])
  })

  it('canvas com o mesmo caminho de uma filha continua listado, e a frente bate com o final', async () => {
    write('Só Filhas/Aba X.canvas', JSON.stringify({ nodes: [], edges: [] }))
    const out = path.join(TMP, 'out')
    const writes = spyWrites()
    await buildVault(vault, { dataRoot: out, first: ['Ômega/Lista'] })
    const finalIndex = fs.readFileSync(path.join(out, 'v', 'pages-index.json'), 'utf-8')
    expect((JSON.parse(finalIndex) as { path: string }[]).map(p => p.path)).toContain('Só Filhas/Aba X')
    const frente = writes.filter(w => w.file.endsWith('/pages-index.json'))
    expect(frente.length).toBeGreaterThan(1)
    for (const w of frente) expect(w.content).toBe(finalIndex)
  })

  it('mãe e abas levam a mesma barra; nota comum não ganha a chave tabs', async () => {
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    const esperado = [
      { path: 'Ômega/Ômega', label: 'Panorama' },
      { path: 'Ômega/Lista', label: 'Lista' },
      { path: 'Ômega/Sumário', label: 'Sumário' },
      { path: 'Ômega/Arquivo', label: 'Arquivo' },
    ]
    for (const p of ['Ômega/Ômega', 'Ômega/Lista', 'Ômega/Sumário', 'Ômega/Arquivo']) {
      expect(read(out, `pages/${p}.json`).tabs).toEqual(esperado)
    }
    // Pasta/A é a mãe da aba que mora em "Só Filhas".
    expect(read(out, 'pages/Pasta/A.json').tabs).toEqual([
      { path: 'Pasta/A', label: 'A' },
      { path: 'Só Filhas/Aba X', label: 'Aba X' },
    ])
    expect('tabs' in read(out, 'pages/Pasta/B.json')).toBe(false)
    expect('tabs' in read(out, 'pages/Órfã.json')).toBe(false)
  })

  it('Propriedades: aba sem os campos do formato; a mãe sem tab_label', async () => {
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    // Lista só tem campos do formato (note_type, parent, order): nenhuma linha, nenhum marcador.
    const lista = read(out, 'pages/Ômega/Lista.json')
    expect('properties' in lista).toBe(false)
    expect(lista.html).not.toContain(PROPERTIES_MARKER)
    // A aba órfã continua nota-filha para as Propriedades: o parent fica escondido. Ela só
    // tem note_type e parent, então um parent visível daria uma linha.
    const orfa = read(out, 'pages/Órfã.json')
    expect('properties' in orfa).toBe(false)
    expect(orfa.html).not.toContain(PROPERTIES_MARKER)
    // A mãe só tem tab_label, que é sempre escondido.
    const mae = read(out, 'pages/Ômega/Ômega.json')
    expect('properties' in mae).toBe(false)
    expect(mae.html).not.toContain('tab_label')
  })

  it('o Dataview continua vendo as filhas', async () => {
    write('Consulta.md', '```dataview\nLIST FROM "_comments"\n```\n')
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    const html: string = read(out, 'pages/Consulta.json').html
    const m = /data-result="([^"]*)"/.exec(html)!
    expect(Buffer.from(m[1], 'base64').toString('utf-8')).toContain('ana-k3f9')
  })

  it('--first: comentário pedido ou alterado não vai para a frente nem grava JSON; saída idêntica', async () => {
    const ref = path.join(TMP, 'ref')
    await buildVault(vault, { dataRoot: ref })

    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    const futuro = new Date(Date.now() + 60_000)
    fs.utimesSync(path.join(TMP, 'vault', `${COMENTARIO}.md`), futuro, futuro)

    const writes = spyWrites()
    await buildVault(vault, { dataRoot: out, first: [COMENTARIO, 'Ômega/Lista'] })

    expect(writes.some(w => w.file.includes('/pages/_comments/'))).toBe(false)
    const primeira = writes.find(w => /\/pages\/.+\.json$/.test(w.file))
    expect(primeira?.file).toMatch(/\/pages\/Ômega\/Lista\.json$/)
    // Todo pages-index/tree gravado na frente é igual ao do fim.
    const finalIndex = fs.readFileSync(path.join(out, 'v', 'pages-index.json'), 'utf-8')
    const finalTree = fs.readFileSync(path.join(out, 'v', 'tree.json'), 'utf-8')
    for (const w of writes) {
      if (w.file.endsWith('/pages-index.json')) expect(w.content).toBe(finalIndex)
      if (w.file.endsWith('/tree.json')) expect(w.content).toBe(finalTree)
    }

    const a = listFiles(path.join(ref, 'v'))
    expect(listFiles(path.join(out, 'v'))).toEqual(a)
    for (const f of a) {
      if (f === 'index.json') continue
      expect(fs.readFileSync(path.join(out, 'v', f), 'utf-8'), f).toBe(fs.readFileSync(path.join(ref, 'v', f), 'utf-8'))
    }
  })
})

describe('buildVault — folderCount', () => {
  type N = { folderPath: string | null; isFolder: boolean; children: N[] }
  // Caminhos dos nós de pasta da árvore, em qualquer nível, contados aqui sem a função do builder.
  const folderPaths = (nodes: N[]): string[] =>
    nodes.flatMap(n => (n.isFolder ? [n.folderPath!, ...folderPaths(n.children)] : []))
  const read = (out: string, rel: string) => JSON.parse(fs.readFileSync(path.join(out, 'v', rel), 'utf-8'))

  beforeEach(() => {
    // Base do arquivo: Pasta/A, Pasta/B (contam), Imagens/ só com imagens (não conta), Mapa.canvas na raiz.
    write('Notas/Sub/C.md', '# C\n')
    write('Ômega/Ômega.md', '# Ômega\n')
    write('Épsilon.md', '# Épsilon\n')
    write('Épsilon/Upsilon.md', '# Upsilon\n')
    write('Só Filhas/Aba X.md', '---\nnote_type: tab\nparent: "[[Pasta/A]]"\n---\naba\n')
    write('_comments/Pasta/A/2026-11-16 153012 ana-k3f9.md', '---\nnote_type: comment\nparent: "[[Pasta/A]]"\nauthor: ana\n---\noi\n')
    write('_comments/Lixo/quebrado.md', 'sem frontmatter\n')
    fs.mkdirSync(path.join(TMP, 'vault', 'Vazia'))
    fs.mkdirSync(path.join(TMP, 'vault', 'Pasta', 'Vazia'))
    write('Anexos/doc.pdf', 'pdf')
    write('Mapas/Mundo.canvas', JSON.stringify({ nodes: [], edges: [] }))
    write('Rascunhos/R.md', '# R\n')
    write('.viewerignore', 'Rascunhos/\n')
  })

  it('conta só as pastas da árvore da barra lateral', async () => {
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    const pastas = folderPaths(read(out, 'tree.json') as N[]).sort()
    expect(pastas).toEqual(['Mapas', 'Notas', 'Notas/Sub', 'Pasta', 'Épsilon', 'Ômega'])
    expect(read(out, 'index.json').folderCount).toBe(pastas.length)
  })

  it('--first não muda o folderCount', async () => {
    const A = path.join(TMP, 'outA')
    const B = path.join(TMP, 'outB')
    await buildVault(vault, { dataRoot: A })
    await buildVault(vault, { dataRoot: B, first: ['Notas/Sub/C', 'Pasta/A'] })
    expect(read(B, 'index.json').folderCount).toBe(read(A, 'index.json').folderCount)
  })
})

describe('buildVault — banner tratado', () => {
  const STYLE_END = ' background-size: cover; background-repeat: no-repeat;"><div class="vault-banner-gradient"></div>'
  const html = (out: string, page: string): string =>
    JSON.parse(fs.readFileSync(path.join(out, 'v', 'pages', page + '.json'), 'utf-8')).html

  let custom: VaultConfig
  beforeEach(() => {
    // titleProperty e coverProperty próprios: chaves que não são ocultas, então um editor as grava.
    custom = { ...vault, titleProperty: 'name', coverProperty: 'image' }
    write('Notas/Hostil.md', [
      '---',
      'name: "<img src=x onerror=alert(1)> & co"',
      `image: "x'), url(evil.png"`,
      'image_x: "expression(alert(1))"',
      'image_y: "10%; color: red"',
      'image_height: "300px"',
      '---',
      'texto',
      '',
    ].join('\n'))
    write('Notas/Legit.md', '---\nname: Minha Nota\nimage: Imagens/a.png\nimage_x: 20%\nimage_y: 30%\nimage_height: 320\n---\n# Minha Nota\n\ntexto\n')
    write('Notas/Merge.md', `---\nname: Merge\nimage: Imagens/a.png\n---\n<h1 id="a$'b">Merge</h1>\n\ntexto\n`)
    write('Notas/Tag.md', '---\nname: "<b>X</b> Y"\nimage: Imagens/a.png\n---\n# <b>X</b> Y\n\ntexto\n')
  })

  it('título, posição, altura e URL hostis saem tratados', async () => {
    const out = path.join(TMP, 'out')
    await buildVault(custom, { dataRoot: out })
    const h = html(out, 'Notas/Hostil')
    expect(h.startsWith(
      `<div class="vault-banner" style="height: 500px; background-image: url('/vault-assets/v/x%27%29,%20url%28evil.png'); background-position: center 50%;` +
        STYLE_END +
        '<h1 class="vault-banner-title">&lt;img src=x onerror=alert(1)> &amp; co</h1></div><article class="vault-content">',
    ), h).toBe(true)
  })

  it('banner legítimo sai igual, com o id do <h1> do corpo e sem o <h1> duplicado', async () => {
    const out = path.join(TMP, 'out')
    await buildVault(custom, { dataRoot: out })
    const h = html(out, 'Notas/Legit')
    expect(h.startsWith(
      `<div class="vault-banner" style="height: 320px; background-image: url('/vault-assets/v/Imagens/a.png'); background-position: 20% 30%;` +
        STYLE_END +
        '<h1 class="vault-banner-title" id="minha-nota">Minha Nota</h1></div><article class="vault-content">',
    )).toBe(true)
    expect(h).not.toContain('<h1 id="minha-nota">')
  })

  it('o id herdado do <h1> do corpo é copiado literalmente', async () => {
    const out = path.join(TMP, 'out')
    await buildVault(custom, { dataRoot: out })
    const h = html(out, 'Notas/Merge')
    // O rehype grava `'` como `&#x27;`: o id fica `a$&#x27;b`, e `$&` é padrão do String.replace.
    expect(h).toContain('<h1 class="vault-banner-title" id="a$&#x27;b">Merge</h1></div><article class="vault-content">')
    expect(h.match(/<h1/g)).toHaveLength(1)
  })

  it('título com tag que bate com o <h1> do corpo: herda o id e sai escapado', async () => {
    const out = path.join(TMP, 'out')
    await buildVault(custom, { dataRoot: out })
    const h = html(out, 'Notas/Tag')
    expect(h).toMatch(/<h1 class="vault-banner-title" id="[^"]+">&lt;b>X&lt;\/b> Y<\/h1><\/div><article class="vault-content">/)
    expect(h).not.toContain('<b>')
  })

  it('título com & ou < se junta ao <h1> do corpo (o rehype grava &#x26; e &#x3C;)', async () => {
    write('Notas/Amp.md', '---\nname: "A & B"\nimage: Imagens/a.png\n---\n# A & B\n\ntexto\n')
    write('Notas/Menor.md', '---\nname: "A < B"\n---\n# A < B\n\ntexto\n')
    const out = path.join(TMP, 'out')
    await buildVault(custom, { dataRoot: out })
    const amp = html(out, 'Notas/Amp')
    expect(amp).toContain('<h1 class="vault-banner-title" id="a--b">A &amp; B</h1></div><article class="vault-content">')
    expect(amp.match(/<h1/g)).toHaveLength(1)
    const menor = html(out, 'Notas/Menor')
    expect(menor.startsWith('<article class="vault-content"><h1 class="vault-page-title" id="a--b">A &lt; B</h1>')).toBe(true)
    expect(menor.match(/<h1/g)).toHaveLength(1)
  })

  it('o id herdado é o do atributo id, não o de um data-id antes dele', async () => {
    write('Notas/DataId.md', '---\nname: Dado\nimage: Imagens/a.png\n---\n<h1 data-id="errado" id="certo">Dado</h1>\n\ntexto\n')
    const out = path.join(TMP, 'out')
    await buildVault(custom, { dataRoot: out })
    expect(html(out, 'Notas/DataId')).toContain('<h1 class="vault-banner-title" id="certo">Dado</h1>')
  })

  it('sem banner, o vault-page-title escapa o título como antes', async () => {
    write('Notas/Sem Capa.md', '---\nname: "<img src=x onerror=alert(1)> & co"\n---\ntexto\n')
    const out = path.join(TMP, 'out')
    await buildVault(custom, { dataRoot: out })
    expect(html(out, 'Notas/Sem Capa').startsWith(
      '<article class="vault-content"><h1 class="vault-page-title">&lt;img src=x onerror=alert(1)> &amp; co</h1>',
    )).toBe(true)
  })

  it('capa com surrogate solto não derruba o build do vault', async () => {
    write('Notas/Surrogate.md', '---\ncover: "x\\ud800.png"\n---\ntexto\n')
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    expect(html(out, 'Notas/Surrogate')).toContain("url('/vault-assets/v/x%EF%BF%BD.png')")
    expect(fs.existsSync(path.join(out, 'v', 'index.json'))).toBe(true)
  })

  it('capa que não é referência de imagem (número, checkbox, lista, texto, NUL) não derruba o build e não gera banner', async () => {
    write('Notas/Num.md', '---\nname: Num\nimage: 5\n---\ntexto\n')
    write('Notas/Bool.md', '---\nname: Bool\nimage: true\n---\ntexto\n')
    write('Notas/Lista.md', '---\nname: Lista\nimage:\n  - Imagens/a.png\n---\ntexto\n')
    write('Notas/Texto.md', '---\nname: Texto\nimage: texto comum\n---\ntexto\n')
    write('Notas/Nul.md', '---\nname: Nul\nimage: "x\\u0000.png"\n---\ntexto\n')
    const out = path.join(TMP, 'out')
    await buildVault(custom, { dataRoot: out })
    for (const p of ['Notas/Num', 'Notas/Bool', 'Notas/Lista', 'Notas/Texto', 'Notas/Nul']) {
      expect(html(out, p).startsWith('<article class="vault-content">'), p).toBe(true)
      expect(html(out, p), p).not.toContain('vault-banner')
    }
    const assets: string[] = JSON.parse(fs.readFileSync(path.join(out, 'v', 'assets.json'), 'utf-8'))
    expect(assets.some(a => a.includes('\u0000'))).toBe(false)
    expect(fs.existsSync(path.join(out, 'v', 'index.json'))).toBe(true)
  })

  it('sem coverProperty, cover que não cita imagem cai para o banner, com as chaves do banner', async () => {
    write('Notas/CoverNum.md', '---\ncover: 5\ncover_y: 90%\nbanner: Imagens/a.png\nbanner_y: 10%\n---\ntexto\n')
    write('Notas/CoverVazia.md', '---\ncover: ""\nbanner: Imagens/a.png\n---\ntexto\n')
    write('Notas/CoverTexto.md', '---\ncover: texto\nbanner: Imagens/a.png\nbanner_height: 300\n---\ntexto\n')
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    const url = "background-image: url('/vault-assets/v/Imagens/a.png');"
    expect(html(out, 'Notas/CoverNum')).toContain(`style="height: 500px; ${url} background-position: center 10%;`)
    expect(html(out, 'Notas/CoverVazia')).toContain(`style="height: 500px; ${url} background-position: center 50%;`)
    expect(html(out, 'Notas/CoverTexto')).toContain(`style="height: 300px; ${url} background-position: center 50%;`)
  })

  it('capa em wikilink sai igual à do caminho', async () => {
    write('Notas/Wiki.md', '---\nname: Wiki\nimage: "[[Imagens/a.png]]"\n---\ntexto\n')
    const out = path.join(TMP, 'out')
    await buildVault(custom, { dataRoot: out })
    expect(html(out, 'Notas/Wiki').startsWith(
      `<div class="vault-banner" style="height: 500px; background-image: url('/vault-assets/v/Imagens/a.png'); background-position: center 50%;`,
    )).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(out, 'v', 'assets.json'), 'utf-8'))).toContain('Imagens/a.png')
  })

  it('propriedade com NUL terminada em .png não derruba o build e fica fora do assets.json', async () => {
    write('Notas/NulProp.md', '---\npic: "x\\u0000.png"\n---\ntexto\n')
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    const page = JSON.parse(fs.readFileSync(path.join(out, 'v', 'pages', 'Notas/NulProp.json'), 'utf-8'))
    const row = page.properties.find((r: { key: string }) => r.key === 'pic')
    expect(row.locked).toBe('image')
    expect(row.html).toBe('<img class="vault-prop-thumb" src="/vault-assets/v/x%00.png" alt="" />')
    const assets: string[] = JSON.parse(fs.readFileSync(path.join(out, 'v', 'assets.json'), 'utf-8'))
    expect(assets.some(a => a.includes('\u0000'))).toBe(false)
  })

  it('--first dá saída idêntica à do build sem ele, com banners hostis e legítimos', async () => {
    const A = path.join(TMP, 'outA')
    const B = path.join(TMP, 'outB')
    await buildVault(custom, { dataRoot: A })
    await buildVault(custom, { dataRoot: B, first: ['Notas/Hostil', 'Notas/Merge', 'Notas/Tag'] })
    const a = listFiles(path.join(A, 'v'))
    expect(listFiles(path.join(B, 'v'))).toEqual(a)
    expect(a).toContain('pages/Notas/Hostil.json')
    const read = (root: string, f: string) => fs.readFileSync(path.join(root, 'v', f), 'utf-8')
    for (const f of a) {
      if (f === 'index.json') {
        const strip = (raw: string) => ({ ...JSON.parse(raw), builtAt: null, startedAt: null })
        expect(strip(read(B, f))).toEqual(strip(read(A, f)))
      } else {
        expect(read(B, f), f).toBe(read(A, f))
      }
    }
  })
})
