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
    writes.push({ file: String(f).split(path.sep).join('/'), content: String(d) })
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
        const { builtAt: _b1, startedAt: _s1, ...ra } = JSON.parse(ca)
        const { builtAt: _b2, startedAt: _s2, ...rb } = JSON.parse(cb)
        expect(rb).toEqual(ra)
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
