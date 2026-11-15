import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { BuildState } from '@/lib/rebuild'
import type { VaultConfig } from '@/types'
import { scanVault, isScannedPath } from '@/builder/scanner'
import { loadVaultIgnore } from '@/builder/vault-ignore'
import {
  safePagePath, noteFor, lastScanMs, isPending, pageStatus, provisionalPage,
} from '@/lib/pending-page'

let root: string
let vaultDir: string
let vault: VaultConfig

function state(over: Partial<BuildState> = {}): BuildState {
  return { running: null, queued: false, first: [], lastAttemptStartedAt: null, ...over }
}
function deps(s: BuildState) {
  return { buildState: vi.fn(() => s), requestBuild: vi.fn() }
}
function writeIndex(over: Record<string, unknown>) {
  fs.mkdirSync(path.join(root, 'data', 'v'), { recursive: true })
  fs.writeFileSync(path.join(root, 'data', 'v', 'index.json'), JSON.stringify({ pageCount: 1, folderCount: 0, ...over }))
}
function writePageJson(p: string, content: string, mtimeMs: number) {
  const f = path.join(root, 'data', 'v', 'pages', p + '.json')
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, content)
  fs.utimesSync(f, new Date(mtimeMs), new Date(mtimeMs))
}
function note(p: string) {
  const f = path.join(vaultDir, p + '.md')
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, '# x')
}
const T = () => noteFor(vault, 'Jogos/Nova')!.t
const idx = (ms: number) =>
  writeIndex({ builtAt: new Date(ms).toISOString(), startedAt: new Date(ms).toISOString() })

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-'))
  vaultDir = path.join(root, 'vault')
  fs.mkdirSync(vaultDir, { recursive: true })
  vault = { slug: 'v', name: 'v', path: vaultDir, description: '', homePage: '', coverImage: null }
  vi.spyOn(process, 'cwd').mockReturnValue(root)
  note('Jogos/Nova')
})
afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('safePagePath', () => {
  it('aceita caminho comum', () => expect(safePagePath('Jogos/Foo')).toBe(true))
  it.each(['../x', 'a\\b', 'a//b', '.obsidian/x', 'a/.oculta', ''])('recusa %j', p => {
    expect(safePagePath(p)).toBe(false)
  })
})

describe('noteFor', () => {
  it('acha .md e .canvas', () => {
    expect(noteFor(vault, 'Jogos/Nova')!.t).toBeGreaterThan(0)
    fs.writeFileSync(path.join(vaultDir, 'Mapa.canvas'), '{}')
    expect(noteFor(vault, 'Mapa')).not.toBeNull()
  })
  it('devolve null para ausente, pasta ignorada e segmento com ponto', () => {
    expect(noteFor(vault, 'Nao/Existe')).toBeNull()
    fs.writeFileSync(path.join(vaultDir, '.viewerignore'), 'Privado/\n')
    note('Privado/Segredo')
    expect(noteFor(vault, 'Privado/Segredo')).toBeNull()
    note('.oculta/x')
    expect(noteFor(vault, '.oculta/x')).toBeNull()
  })
})

describe('isScannedPath', () => {
  it('dá o mesmo resultado que o scanVault', () => {
    fs.writeFileSync(path.join(vaultDir, '.viewerignore'), 'Privado/\n')
    note('Privado/Segredo')
    note('.oculta/x')
    note('Pub/Ok')
    const ig = loadVaultIgnore(vaultDir)
    const scanned = new Set(scanVault(vaultDir, ig).map(f => f.relativePath + '.md'))
    for (const rel of ['Privado/Segredo.md', '.oculta/x.md', 'Pub/Ok.md', 'Jogos/Nova.md']) {
      expect(isScannedPath(rel, ig)).toBe(scanned.has(rel))
    }
  })
})

describe('lastScanMs', () => {
  it('null sem index nem tentativa', () => expect(lastScanMs('v', state())).toBeNull())
  it('usa builtAt de index antigo', () => {
    writeIndex({ builtAt: '2026-01-01T00:00:00.000Z' })
    expect(lastScanMs('v', state())).toBe(Date.parse('2026-01-01T00:00:00.000Z'))
  })
  it('pega o maior entre startedAt e lastAttemptStartedAt', () => {
    writeIndex({ builtAt: '2026-01-01T00:00:10.000Z', startedAt: '2026-01-01T00:00:00.000Z' })
    expect(lastScanMs('v', state({ lastAttemptStartedAt: 5 }))).toBe(Date.parse('2026-01-01T00:00:00.000Z'))
    expect(lastScanMs('v', state({ lastAttemptStartedAt: 9e15 }))).toBe(9e15)
  })
})

describe('isPending', () => {
  it('(a) build rodando que começou depois da nota espera sem pedir build', () => {
    const t = T(); idx(t - 10_000)
    const d = deps(state({ running: { startedAt: t + 1000 } }))
    expect(isPending(vault, 'Jogos/Nova', { trigger: true }, d)).toBe(true)
    expect(d.requestBuild).not.toHaveBeenCalled()
  })
  it('(b) parado com index velho: só pede build com trigger', () => {
    const t = T(); idx(t - 10_000)
    const d = deps(state())
    expect(isPending(vault, 'Jogos/Nova', { trigger: false }, d)).toBe(true)
    expect(d.requestBuild).not.toHaveBeenCalled()
    expect(isPending(vault, 'Jogos/Nova', { trigger: true }, d)).toBe(true)
    expect(d.requestBuild).toHaveBeenCalledWith('v', ['Jogos/Nova'])
  })
  it('(b) build rodando que começou antes da nota pede build', () => {
    const t = T(); idx(t - 10_000)
    const d = deps(state({ running: { startedAt: t - 1000 } }))
    expect(isPending(vault, 'Jogos/Nova', { trigger: true }, d)).toBe(true)
    expect(d.requestBuild).toHaveBeenCalledWith('v', ['Jogos/Nova'])
  })
  it('(c) build extra na fila espera sem pedir build', () => {
    const t = T(); idx(t + 5000)
    const d = deps(state({ queued: true, running: { startedAt: t - 1000 } }))
    expect(isPending(vault, 'Jogos/Nova', { trigger: true }, d)).toBe(true)
    expect(d.requestBuild).not.toHaveBeenCalled()
  })
  it('build que falhou não provoca laço', () => {
    const t = T(); idx(t - 10_000)
    const d = deps(state({ lastAttemptStartedAt: t + 1000 }))
    expect(isPending(vault, 'Jogos/Nova', { trigger: true }, d)).toBe(false)
    expect(d.requestBuild).not.toHaveBeenCalled()
  })
  it('build que terminou sem gerar a página não é pendente', () => {
    const t = T(); idx(t + 1000)
    expect(isPending(vault, 'Jogos/Nova', { trigger: true }, deps(state()))).toBe(false)
  })
  it('index antigo só com builtAt é usado', () => {
    const t = T(); writeIndex({ builtAt: new Date(t + 1000).toISOString() })
    expect(isPending(vault, 'Jogos/Nova', { trigger: true }, deps(state()))).toBe(false)
  })
  it('sem nota devolve false', () => {
    expect(isPending(vault, 'Nao/Existe', { trigger: true }, deps(state()))).toBe(false)
  })
  it('página existente: JSON mais novo que a nota nunca é pendente', () => {
    const t = T(); idx(t - 10_000)
    const d = deps(state())
    expect(isPending(vault, 'Jogos/Nova', { trigger: true, pageJsonMtimeMs: t + 1 }, d)).toBe(false)
    expect(d.requestBuild).not.toHaveBeenCalled()
    expect(isPending(vault, 'Jogos/Nova', { trigger: true, pageJsonMtimeMs: t - 1 }, d)).toBe(true)
    expect(d.requestBuild).toHaveBeenCalledWith('v', ['Jogos/Nova'])
  })
})

describe('pageStatus', () => {
  it('JSON mais novo que a nota é ready', () => {
    const t = T(); idx(t - 10_000)
    writePageJson('Jogos/Nova', '{}', t + 5000)
    const d = deps(state())
    expect(pageStatus(vault, 'Jogos/Nova', d)).toBe('ready')
    expect(d.requestBuild).not.toHaveBeenCalled()
  })
  it('JSON velho com build rodando depois da nota é pending', () => {
    const t = T(); idx(t - 10_000)
    writePageJson('Jogos/Nova', '{}', t - 5000)
    const d = deps(state({ running: { startedAt: t + 1000 } }))
    expect(pageStatus(vault, 'Jogos/Nova', d)).toBe('pending')
    expect(d.requestBuild).not.toHaveBeenCalled()
  })
  it('JSON velho com build que falhou é ready', () => {
    const t = T(); idx(t - 10_000)
    writePageJson('Jogos/Nova', '{}', t - 5000)
    const d = deps(state({ lastAttemptStartedAt: t + 1000 }))
    expect(pageStatus(vault, 'Jogos/Nova', d)).toBe('ready')
    expect(d.requestBuild).not.toHaveBeenCalled()
  })
  it('sem JSON: pending com build depois da nota, missing sem pendência', () => {
    const t = T(); idx(t - 10_000)
    expect(pageStatus(vault, 'Jogos/Nova', deps(state({ running: { startedAt: t + 1000 } })))).toBe('pending')
    expect(pageStatus(vault, 'Jogos/Nova', deps(state({ lastAttemptStartedAt: t + 1000 })))).toBe('missing')
  })
  it('JSON inválido (parcial) nunca é ready', () => {
    const t = T(); idx(t - 10_000)
    writePageJson('Jogos/Nova', '{', t + 5000)
    expect(pageStatus(vault, 'Jogos/Nova', deps(state({ running: { startedAt: t + 1000 } })))).toBe('pending')
    expect(pageStatus(vault, 'Jogos/Nova', deps(state({ lastAttemptStartedAt: t + 1000 })))).toBe('missing')
  })
})

describe('provisionalPage', () => {
  it('escapa o título', () => {
    const page = provisionalPage('Jogos/<b>X&Y')
    expect(page.title).toBe('<b>X&Y')
    expect(page.html).toContain('&lt;b&gt;X&amp;Y')
    expect(page.html).not.toContain('<b>')
  })
})
