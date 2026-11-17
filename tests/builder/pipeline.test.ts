import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { VaultConfig } from '../../types'
import { buildVault } from '../../builder/pipeline'

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
  write('Inicio.md', '# Inicio\n\n[[Jogos/A]]\n\n![[a.png]]\n\n```dataview\nLIST FROM "Jogos"\n```\n')
  write('Jogos/A.md', '# A\n\ntexto A\n')
  write('Jogos/B.md', '# B\n\n![[b.png]]\n')
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
    await buildVault(vault, { dataRoot: B, first: ['Jogos/B', 'Inicio'] })

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
    await buildVault(vault, { dataRoot: path.join(TMP, 'out'), first: ['Jogos/B'] })
    expect(fs.existsSync(path.join(TMP, 'public'))).toBe(false)
  })

  it('a página da frente sai antes do resto, com assets.json antes dela', async () => {
    const out = path.join(TMP, 'out')
    const writes = spyWrites()

    await buildVault(vault, { dataRoot: out, first: ['Jogos/B'] })

    const idx = (re: RegExp) => writes.findIndex(w => re.test(w.file))
    const iAssets = idx(/\/assets\.json$/)
    const iB = idx(/\/pages\/Jogos\/B\.json$/)
    const iIndex = idx(/\/pages-index\.json$/)
    const outros = writes
      .map((w, i) => (/\/pages\/.+\.json$/.test(w.file) && !/Jogos\/B\.json$/.test(w.file) ? i : -1))
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
      await buildVault(vault, { dataRoot: out, first: ['Jogos/B'] })
      expect(fs.existsSync(path.join(out, 'v', 'pages', 'Jogos', 'B.json'))).toBe(true)
      expect(JSON.parse(fs.readFileSync(path.join(out, 'v', 'assets.json'), 'utf-8'))).toContain('Imagens/b.png')
    }
  })

  it('assets.json da frente é a união com o anterior; o final só tem os atuais', async () => {
    const out = path.join(TMP, 'out')
    fs.mkdirSync(path.join(out, 'v'), { recursive: true })
    fs.writeFileSync(path.join(out, 'v', 'assets.json'), JSON.stringify(['Antiga/x.png']))
    const writes = spyWrites()

    await buildVault(vault, { dataRoot: out, first: ['Jogos/B'] })

    const iAssets = writes.findIndex(w => /\/assets\.json$/.test(w.file))
    const iB = writes.findIndex(w => /\/pages\/Jogos\/B\.json$/.test(w.file))
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
    fs.utimesSync(path.join(TMP, 'vault', 'Jogos', 'A.md'), futuro, futuro)

    const writes = spyWrites()
    await buildVault(vault, { dataRoot: out })

    const primeira = writes.find(w => /\/pages\/.+\.json$/.test(w.file))
    expect(primeira?.file).toMatch(/\/pages\/Jogos\/A\.json$/)
  })
})

describe('buildVault — nota-filha e abas', () => {
  const COMENTARIO = '_comments/Jogos/A/2026-11-16 153012 ana-k3f9'
  const FILHAS = ['Visões/Lista', 'Visões/Zerados', 'Visões/Arquivo', 'Só Filhas/Aba X', COMENTARIO]

  beforeEach(() => {
    // A mãe cita uma aba e o comentário: nem isso vira aresta.
    write('Visões/Visões.md', `---\ntab_label: Jogando\n---\n# Visões\n\n[[Jogos/B]] [[Visões/Lista]] [[${COMENTARIO}]]\n`)
    write('Visões/Lista.md', '---\nnote_type: tab\nparent: "[[Visões/Visões]]"\norder: 1\n---\n[[Jogos/A]]\n')
    write('Visões/Zerados.md', '---\nnote_type: tab\nparent: "[[visões/VISÕES]]"\norder: 2\n---\nz\n')
    write('Visões/Arquivo.md', '---\nnote_type: tab\nparent: "[[Visões/Visões]]"\n---\nx\n')
    write('Só Filhas/Aba X.md', '---\nnote_type: tab\nparent: "[[Jogos/A]]"\n---\n[[Jogos/B]]\n')
    write(`${COMENTARIO}.md`, '---\nnote_type: comment\nparent: "[[Jogos/A]]"\nauthor: ana\n---\n[[Jogos/B]]\n')
    write('Órfã.md', '---\nnote_type: tab\nparent: "[[Não Existe]]"\n---\nórfã\n')
  })

  const read = (out: string, rel: string) => JSON.parse(fs.readFileSync(path.join(out, 'v', rel), 'utf-8'))

  it('comentário não gera página; abas e aba órfã geram', async () => {
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    const files = listFiles(path.join(out, 'v', 'pages'))
    expect(files.some(f => f.startsWith('_comments/'))).toBe(false)
    for (const f of ['Visões/Lista.json', 'Visões/Zerados.json', 'Visões/Arquivo.json', 'Só Filhas/Aba X.json', 'Órfã.json']) {
      expect(files).toContain(f)
    }
    expect(read(out, 'index.json').pageCount).toBe(files.length)
  })

  it('filhas ficam fora do pages-index; a aba órfã e a mãe ficam', async () => {
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    const paths = (read(out, 'pages-index.json') as { path: string }[]).map(p => p.path)
    for (const p of FILHAS) expect(paths).not.toContain(p)
    expect(paths).toContain('Visões/Visões')
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
    const visoes = tree.find(n => n.isFolder && n.name === 'Visões')!
    expect(visoes.path).toBe('Visões/Visões')
    expect(visoes.children).toEqual([])
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
    // A aba Lista cita Jogos/A, mas não vira backlink dela.
    expect(g.edges.filter(e => e.target === 'Jogos/A').map(e => e.source)).toEqual(['Inicio'])
    expect(g.edges.filter(e => e.source === 'Visões/Visões').map(e => e.target)).toEqual(['Jogos/B'])
  })

  it('canvas com o mesmo caminho de uma filha continua listado, e a frente bate com o final', async () => {
    write('Só Filhas/Aba X.canvas', JSON.stringify({ nodes: [], edges: [] }))
    const out = path.join(TMP, 'out')
    const writes = spyWrites()
    await buildVault(vault, { dataRoot: out, first: ['Visões/Lista'] })
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
      { path: 'Visões/Visões', label: 'Jogando' },
      { path: 'Visões/Lista', label: 'Lista' },
      { path: 'Visões/Zerados', label: 'Zerados' },
      { path: 'Visões/Arquivo', label: 'Arquivo' },
    ]
    for (const p of ['Visões/Visões', 'Visões/Lista', 'Visões/Zerados', 'Visões/Arquivo']) {
      expect(read(out, `pages/${p}.json`).tabs).toEqual(esperado)
    }
    // Jogos/A é a mãe da aba que mora em "Só Filhas".
    expect(read(out, 'pages/Jogos/A.json').tabs).toEqual([
      { path: 'Jogos/A', label: 'A' },
      { path: 'Só Filhas/Aba X', label: 'Aba X' },
    ])
    expect('tabs' in read(out, 'pages/Jogos/B.json')).toBe(false)
    expect('tabs' in read(out, 'pages/Órfã.json')).toBe(false)
  })

  it('Propriedades: aba sem os campos do formato; a mãe sem tab_label', async () => {
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    expect(read(out, 'pages/Visões/Lista.json').html).not.toContain('vault-properties')
    expect(read(out, 'pages/Órfã.json').html).not.toContain('vault-prop-key">parent')
    expect(read(out, 'pages/Visões/Visões.json').html).not.toContain('tab_label')
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
    await buildVault(vault, { dataRoot: out, first: [COMENTARIO, 'Visões/Lista'] })

    expect(writes.some(w => w.file.includes('/pages/_comments/'))).toBe(false)
    const primeira = writes.find(w => /\/pages\/.+\.json$/.test(w.file))
    expect(primeira?.file).toMatch(/\/pages\/Visões\/Lista\.json$/)
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
    // Base do arquivo: Jogos/A, Jogos/B (contam), Imagens/ só com imagens (não conta), Mapa.canvas na raiz.
    write('Notas/Sub/C.md', '# C\n')
    write('Visões/Visões.md', '# Visões\n')
    write('Nações.md', '# Nações\n')
    write('Nações/Brasil.md', '# Brasil\n')
    write('Só Filhas/Aba X.md', '---\nnote_type: tab\nparent: "[[Jogos/A]]"\n---\naba\n')
    write('_comments/Jogos/A/2026-11-16 153012 ana-k3f9.md', '---\nnote_type: comment\nparent: "[[Jogos/A]]"\nauthor: ana\n---\noi\n')
    write('_comments/Lixo/quebrado.md', 'sem frontmatter\n')
    fs.mkdirSync(path.join(TMP, 'vault', 'Vazia'))
    fs.mkdirSync(path.join(TMP, 'vault', 'Jogos', 'Vazia'))
    write('Anexos/doc.pdf', 'pdf')
    write('Mapas/Mundo.canvas', JSON.stringify({ nodes: [], edges: [] }))
    write('Rascunhos/R.md', '# R\n')
    write('.viewerignore', 'Rascunhos/\n')
  })

  it('conta só as pastas da árvore da barra lateral', async () => {
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    const pastas = folderPaths(read(out, 'tree.json') as N[]).sort()
    expect(pastas).toEqual(['Jogos', 'Mapas', 'Nações', 'Notas', 'Notas/Sub', 'Visões'])
    expect(read(out, 'index.json').folderCount).toBe(pastas.length)
  })

  it('--first não muda o folderCount', async () => {
    const A = path.join(TMP, 'outA')
    const B = path.join(TMP, 'outB')
    await buildVault(vault, { dataRoot: A })
    await buildVault(vault, { dataRoot: B, first: ['Notas/Sub/C', 'Jogos/A'] })
    expect(read(B, 'index.json').folderCount).toBe(read(A, 'index.json').folderCount)
  })
})
