import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { BuildState } from '@/lib/rebuild'
import type { VaultConfig } from '@/types'
import { scanVault, isScannedPath, noteTime } from '@/builder/scanner'
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
const T = () => noteFor(vault, 'Pasta/Nova')!.t
const idx = (ms: number) =>
  writeIndex({ builtAt: new Date(ms).toISOString(), startedAt: new Date(ms).toISOString() })

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-'))
  vaultDir = path.join(root, 'vault')
  fs.mkdirSync(vaultDir, { recursive: true })
  vault = { slug: 'v', name: 'v', path: vaultDir, description: '', homePage: '', coverImage: null }
  vi.spyOn(process, 'cwd').mockReturnValue(root)
  note('Pasta/Nova')
})
afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('safePagePath', () => {
  it('aceita caminho comum', () => expect(safePagePath('Pasta/Foo')).toBe(true))
  it.each(['../x', 'a\\b', 'a//b', '.obsidian/x', 'a/.oculta', '', 'a:b', 'a?b', 'a"b', 'a<b', 'a|b', 'a*b', 'ab'])('recusa %j', p => {
    expect(safePagePath(p)).toBe(false)
  })
})

describe('noteFor', () => {
  it('acha .md e .canvas', () => {
    expect(noteFor(vault, 'Pasta/Nova')!.t).toBeGreaterThan(0)
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
  it('não contorna o .viewerignore com sintaxe de stream do NTFS', () => {
    fs.writeFileSync(path.join(vaultDir, '.viewerignore'), 'Privado/\n')
    note('Privado/Segredo')
    expect(noteFor(vault, 'Privado::$INDEX_ALLOCATION/Segredo')).toBeNull()
    expect(noteFor(vault, 'Privado:$I30:$INDEX_ALLOCATION/Segredo')).toBeNull()
  })
  it('não acha nota ignorada por ponto ou espaço no fim do segmento', () => {
    fs.writeFileSync(path.join(vaultDir, '.viewerignore'), 'Privado/\n')
    note('Privado/Segredo')
    expect(noteFor(vault, 'Privado./Segredo')).toBeNull()
    expect(noteFor(vault, 'Privado /Segredo')).toBeNull()
  })
  it('acha a nota com caixa diferente', () => {
    expect(noteFor(vault, 'pasta/nova')).not.toBeNull()
  })
  it('não acha nota pelo caminho de uma junção', () => {
    note('Real/Dentro')
    const link = path.join(vaultDir, 'Atalho')
    let ok = true
    try {
      fs.symlinkSync(path.join(vaultDir, 'Real'), link, 'junction')
    } catch {
      ok = false
    }
    if (!ok) return // ambiente sem permissão para criar link
    expect(noteFor(vault, 'Real/Dentro')).not.toBeNull()
    expect(noteFor(vault, 'Atalho/Dentro')).toBeNull()
  })
  it('nada dentro de _comments/ da raiz é página, em qualquer caixa e profundidade', () => {
    note('_comments/Pasta/Nova/2026-11-16 153012 ana-k3f9')
    fs.writeFileSync(path.join(vaultDir, '_comments', 'Mapa.canvas'), '{}')
    expect(noteFor(vault, '_comments/Pasta/Nova/2026-11-16 153012 ana-k3f9')).toBeNull()
    expect(noteFor(vault, '_COMMENTS/Pasta/Nova/2026-11-16 153012 ana-k3f9')).toBeNull()
    expect(noteFor(vault, '_comments/Mapa')).toBeNull()
  })
  it('_comments fora da raiz e _comments.md na raiz continuam sendo notas', () => {
    note('Pasta/_comments/x')
    note('_comments')
    expect(noteFor(vault, 'Pasta/_comments/x')).not.toBeNull()
    expect(noteFor(vault, '_comments')).not.toBeNull()
  })
  it('com .md e .canvas de mesmo nome usa o maior t', () => {
    const md = noteFor(vault, 'Pasta/Nova')!.t
    const canvas = path.join(vaultDir, 'Pasta', 'Nova.canvas')
    fs.writeFileSync(canvas, '{}')
    const futuro = new Date(Math.min(md + 60_000, Date.now() - 1000))
    fs.utimesSync(canvas, futuro, futuro)
    const t = noteFor(vault, 'Pasta/Nova')!.t
    expect(t).toBeGreaterThanOrEqual(md)
    expect(t).toBe(Math.max(md, noteTime(fs.statSync(canvas))))
  })
})

describe('noteTime', () => {
  const now = 1_000_000_000_000
  it('ignora timestamps no futuro', () => {
    expect(noteTime({ mtimeMs: now + 3_600_000, ctimeMs: 5, birthtimeMs: 3 }, now)).toBe(5)
  })
  it('os três no futuro dão -Infinity', () => {
    const f = now + 3_600_000
    expect(noteTime({ mtimeMs: f, ctimeMs: f, birthtimeMs: f }, now)).toBe(-Infinity)
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
    for (const rel of ['Privado/Segredo.md', '.oculta/x.md', 'Pub/Ok.md', 'Pasta/Nova.md']) {
      expect(isScannedPath(rel, ig)).toBe(scanned.has(rel))
    }
  })
  it('concorda com o scanVault em padrão de arquivo e padrão aninhado', () => {
    fs.writeFileSync(path.join(vaultDir, '.viewerignore'), '*.rascunho.md\n**/X/\n')
    note('A/Nota.rascunho')
    note('A/B/X/Fundo')
    note('X/Raiz')
    note('A/B/Visivel')
    const ig = loadVaultIgnore(vaultDir)
    const scanned = new Set(scanVault(vaultDir, ig).map(f => f.relativePath + '.md'))
    const todos = ['A/Nota.rascunho.md', 'A/B/X/Fundo.md', 'X/Raiz.md', 'A/B/Visivel.md']
    for (const rel of todos) expect(isScannedPath(rel, ig)).toBe(scanned.has(rel))
    expect(scanned.has('A/B/Visivel.md')).toBe(true)
    expect(scanned.has('A/Nota.rascunho.md')).toBe(false)
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
    expect(isPending(vault, 'Pasta/Nova', { trigger: true }, d)).toBe(true)
    expect(d.requestBuild).not.toHaveBeenCalled()
  })
  it('(b) parado com index velho: só pede build com trigger', () => {
    const t = T(); idx(t - 10_000)
    const d = deps(state())
    expect(isPending(vault, 'Pasta/Nova', { trigger: false }, d)).toBe(true)
    expect(d.requestBuild).not.toHaveBeenCalled()
    expect(isPending(vault, 'Pasta/Nova', { trigger: true }, d)).toBe(true)
    expect(d.requestBuild).toHaveBeenCalledWith('v', ['Pasta/Nova'])
  })
  it('(b) build rodando que começou antes da nota pede build', () => {
    const t = T(); idx(t - 10_000)
    const d = deps(state({ running: { startedAt: t - 1000 } }))
    expect(isPending(vault, 'Pasta/Nova', { trigger: true }, d)).toBe(true)
    expect(d.requestBuild).toHaveBeenCalledWith('v', ['Pasta/Nova'])
  })
  it('(c) build extra na fila espera sem pedir build', () => {
    const t = T(); idx(t + 5000)
    const d = deps(state({ queued: true, running: { startedAt: t - 1000 } }))
    expect(isPending(vault, 'Pasta/Nova', { trigger: true }, d)).toBe(true)
    expect(d.requestBuild).not.toHaveBeenCalled()
  })
  it('build que falhou não provoca laço', () => {
    const t = T(); idx(t - 10_000)
    const d = deps(state({ lastAttemptStartedAt: t + 1000 }))
    expect(isPending(vault, 'Pasta/Nova', { trigger: true }, d)).toBe(false)
    expect(d.requestBuild).not.toHaveBeenCalled()
  })
  it('build que terminou sem gerar a página não é pendente', () => {
    const t = T(); idx(t + 1000)
    expect(isPending(vault, 'Pasta/Nova', { trigger: true }, deps(state()))).toBe(false)
  })
  it('index antigo só com builtAt é usado', () => {
    const t = T(); writeIndex({ builtAt: new Date(t + 1000).toISOString() })
    expect(isPending(vault, 'Pasta/Nova', { trigger: true }, deps(state()))).toBe(false)
  })
  it('nota com mtime no futuro não provoca build em laço', () => {
    const futuro = new Date(Date.now() + 3_600_000)
    fs.utimesSync(path.join(vaultDir, 'Pasta', 'Nova.md'), futuro, futuro)
    // o utimesSync põe o ctime em "agora": o index fica depois dele para isolar o mtime futuro
    idx(Date.now() + 1000)
    const d = deps(state())
    expect(isPending(vault, 'Pasta/Nova', { trigger: true }, d)).toBe(false)
    expect(d.requestBuild).not.toHaveBeenCalled()
  })
  it('arquivo de _comments/ nunca é pendente nem pede build', () => {
    note('_comments/Pasta/Nova/2026-11-16 153012 ana-k3f9')
    const d = deps(state())
    expect(isPending(vault, '_comments/Pasta/Nova/2026-11-16 153012 ana-k3f9', { trigger: true }, d)).toBe(false)
    expect(d.requestBuild).not.toHaveBeenCalled()
    expect(pageStatus(vault, '_comments/Pasta/Nova/2026-11-16 153012 ana-k3f9', d)).toBe('missing')
  })
  it('sem nota devolve false', () => {
    expect(isPending(vault, 'Nao/Existe', { trigger: true }, deps(state()))).toBe(false)
  })
  it('página existente: JSON mais novo que a nota nunca é pendente', () => {
    const t = T(); idx(t - 10_000)
    const d = deps(state())
    expect(isPending(vault, 'Pasta/Nova', { trigger: true, pageJsonMtimeMs: t + 1 }, d)).toBe(false)
    expect(d.requestBuild).not.toHaveBeenCalled()
    expect(isPending(vault, 'Pasta/Nova', { trigger: true, pageJsonMtimeMs: t - 1 }, d)).toBe(true)
    expect(d.requestBuild).toHaveBeenCalledWith('v', ['Pasta/Nova'])
  })
})

describe('pageStatus', () => {
  it('caminho inseguro é missing sem tocar no disco', () => {
    const d = deps(state())
    expect(pageStatus(vault, '../x', d)).toBe('missing')
    expect(d.buildState).not.toHaveBeenCalled()
  })
  it('nunca dispara build no ramo (b), com e sem JSON', () => {
    const t = T(); idx(t - 10_000)
    const d = deps(state())
    expect(pageStatus(vault, 'Pasta/Nova', d)).toBe('pending')
    writePageJson('Pasta/Nova', '{}', t - 5000)
    expect(pageStatus(vault, 'Pasta/Nova', d)).toBe('pending')
    expect(d.requestBuild).not.toHaveBeenCalled()
  })
  it('JSON mais novo que a nota é ready', () => {
    const t = T(); idx(t - 10_000)
    writePageJson('Pasta/Nova', '{}', t + 5000)
    const d = deps(state())
    expect(pageStatus(vault, 'Pasta/Nova', d)).toBe('ready')
    expect(d.requestBuild).not.toHaveBeenCalled()
  })
  it('JSON velho com build rodando depois da nota é pending', () => {
    const t = T(); idx(t - 10_000)
    writePageJson('Pasta/Nova', '{}', t - 5000)
    const d = deps(state({ running: { startedAt: t + 1000 } }))
    expect(pageStatus(vault, 'Pasta/Nova', d)).toBe('pending')
    expect(d.requestBuild).not.toHaveBeenCalled()
  })
  it('JSON velho com build que falhou é ready', () => {
    const t = T(); idx(t - 10_000)
    writePageJson('Pasta/Nova', '{}', t - 5000)
    const d = deps(state({ lastAttemptStartedAt: t + 1000 }))
    expect(pageStatus(vault, 'Pasta/Nova', d)).toBe('ready')
    expect(d.requestBuild).not.toHaveBeenCalled()
  })
  it('sem JSON: pending com build depois da nota, missing sem pendência', () => {
    const t = T(); idx(t - 10_000)
    expect(pageStatus(vault, 'Pasta/Nova', deps(state({ running: { startedAt: t + 1000 } })))).toBe('pending')
    expect(pageStatus(vault, 'Pasta/Nova', deps(state({ lastAttemptStartedAt: t + 1000 })))).toBe('missing')
  })
  it('JSON inválido (parcial) nunca é ready', () => {
    const t = T(); idx(t - 10_000)
    writePageJson('Pasta/Nova', '{', t + 5000)
    expect(pageStatus(vault, 'Pasta/Nova', deps(state({ running: { startedAt: t + 1000 } })))).toBe('pending')
    expect(pageStatus(vault, 'Pasta/Nova', deps(state({ lastAttemptStartedAt: t + 1000 })))).toBe('missing')
  })
})

describe('provisionalPage', () => {
  it('escapa o título', () => {
    const page = provisionalPage('Pasta/<b>X&Y')
    expect(page.title).toBe('<b>X&Y')
    expect(page.html).toContain('&lt;b&gt;X&amp;Y')
    expect(page.html).not.toContain('<b>')
  })
})
