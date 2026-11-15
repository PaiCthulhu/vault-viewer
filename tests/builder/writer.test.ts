import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { writeOutput } from '../../builder/writer'
import type { PageMeta, BuildGraph, VaultIndex } from '../../builder/types'

const TMP = path.join(os.tmpdir(), 'writer-test-' + Math.random().toString(36).slice(2))

const pages: PageMeta[] = [
  { path: 'Notas/Alpha', title: 'Alpha', frontmatter: { tags: ['lore'] }, allFields: {}, html: '<p>hi</p>', outlinks: ['Notas/Beta'], tags: ['lore'], css: '' },
  { path: 'Notas/Beta', title: 'Beta', frontmatter: {}, allFields: {}, html: '<p>bye</p>', outlinks: [], tags: [], css: '' },
]
const graph: BuildGraph = {
  nodes: [{ id: 'Notas/Alpha', label: 'Alpha', tags: ['lore'] }, { id: 'Notas/Beta', label: 'Beta', tags: [] }],
  edges: [{ source: 'Notas/Alpha', target: 'Notas/Beta' }],
}
const index: VaultIndex = { pageCount: 2, folderCount: 1, builtAt: '2026-01-01T00:00:00Z' }

describe('writeOutput', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(TMP, { recursive: true, force: true })
  })

  it('writes pages-index.json with PageSummary array', () => {
    writeOutput('test-vault', pages, graph, index, TMP)
    const raw = fs.readFileSync(path.join(TMP, 'test-vault', 'pages-index.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toEqual({ path: 'Notas/Alpha', title: 'Alpha', file: 'Alpha', tags: ['lore'] })
    expect(parsed[1]).toEqual({ path: 'Notas/Beta', title: 'Beta', file: 'Beta', tags: [] })
  })

  it('writes index.json, graph.json, pages/*.json as before', () => {
    writeOutput('test-vault', pages, graph, index, TMP)
    expect(fs.existsSync(path.join(TMP, 'test-vault', 'index.json'))).toBe(true)
    expect(fs.existsSync(path.join(TMP, 'test-vault', 'graph.json'))).toBe(true)
    expect(fs.existsSync(path.join(TMP, 'test-vault', 'pages', 'Notas', 'Alpha.json'))).toBe(true)
  })
  it('index.json é o último arquivo gravado e as páginas vêm antes do pages-index', () => {
    const spy = vi.spyOn(fs, 'writeFileSync')
    writeOutput('test-vault', pages, graph, index, TMP, { assets: ['a.png'] })
    const files = spy.mock.calls.map(c => String(c[0]).split(path.sep).join('/'))
    expect(path.basename(files[files.length - 1])).toBe('index.json')
    const idx = files.findIndex(f => f.endsWith('/pages-index.json'))
    const pageIdxs = files.map((f, i) => (/\/pages\/.+\.json$/.test(f) ? i : -1)).filter(i => i >= 0)
    expect(pageIdxs.length).toBe(2)
    for (const i of pageIdxs) expect(i).toBeLessThan(idx)
  })

  it('grava assets.json com a lista passada', () => {
    writeOutput('test-vault', pages, graph, index, TMP, { assets: ['a/b.png', 'c.jpg'] })
    const raw = fs.readFileSync(path.join(TMP, 'test-vault', 'assets.json'), 'utf-8')
    expect(JSON.parse(raw)).toEqual(['a/b.png', 'c.jpg'])
  })

  it('poda a página que não foi gravada e a pasta que ficou vazia', () => {
    const pagesDir = path.join(TMP, 'test-vault', 'pages')
    fs.mkdirSync(path.join(pagesDir, 'Velha'), { recursive: true })
    fs.mkdirSync(path.join(pagesDir, 'Notas'), { recursive: true })
    fs.writeFileSync(path.join(pagesDir, 'Velha', 'Sumiu.json'), '{}')
    fs.writeFileSync(path.join(pagesDir, 'Notas', 'Gamma.json'), '{}')
    writeOutput('test-vault', pages, graph, index, TMP)
    expect(fs.existsSync(path.join(pagesDir, 'Velha', 'Sumiu.json'))).toBe(false)
    expect(fs.existsSync(path.join(pagesDir, 'Velha'))).toBe(false)
    expect(fs.existsSync(path.join(pagesDir, 'Notas', 'Gamma.json'))).toBe(false)
    expect(fs.existsSync(path.join(pagesDir, 'Notas', 'Alpha.json'))).toBe(true)
    expect(fs.existsSync(path.join(pagesDir, 'Notas', 'Beta.json'))).toBe(true)
  })

  it('poda não diferencia caixa', () => {
    const notasDir = path.join(TMP, 'test-vault', 'pages', 'Notas')
    fs.mkdirSync(notasDir, { recursive: true })
    fs.writeFileSync(path.join(notasDir, 'ALPHA.json'), '{}')
    writeOutput('test-vault', [pages[0]], graph, index, TMP)
    const sobras = fs.readdirSync(notasDir).filter(n => n.toLowerCase() === 'alpha.json')
    expect(sobras.length).toBeGreaterThanOrEqual(1)
    const lida = JSON.parse(fs.readFileSync(path.join(notasDir, 'Alpha.json'), 'utf-8'))
    expect(lida.html).toBe('<p>hi</p>')
  })

  it('zero páginas não apaga nada', () => {
    const pagesDir = path.join(TMP, 'test-vault', 'pages')
    fs.mkdirSync(pagesDir, { recursive: true })
    fs.writeFileSync(path.join(pagesDir, 'X.json'), '{}')
    writeOutput('test-vault', [], graph, index, TMP)
    expect(fs.existsSync(path.join(pagesDir, 'X.json'))).toBe(true)
  })

  it('alreadyWritten não regrava nem poda', () => {
    const file = path.join(TMP, 'test-vault', 'pages', 'Notas', 'Alpha.json')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '"X"')
    writeOutput('test-vault', pages, graph, index, TMP, { alreadyWritten: [file] })
    expect(fs.readFileSync(file, 'utf-8')).toBe('"X"')
    expect(fs.existsSync(path.join(path.dirname(file), 'Beta.json'))).toBe(true)
  })

  it('falha ao listar uma pasta na poda só avisa e o index.json sai', () => {
    const pagesDir = path.join(TMP, 'test-vault', 'pages')
    fs.mkdirSync(path.join(pagesDir, 'Trancada'), { recursive: true })
    const realRead = fs.readdirSync
    vi.spyOn(fs, 'readdirSync').mockImplementation(((p: fs.PathLike, o?: unknown) => {
      if (String(p).endsWith('Trancada')) throw Object.assign(new Error('eperm'), { code: 'EPERM' })
      return (realRead as (p: fs.PathLike, o?: unknown) => unknown)(p, o)
    }) as typeof fs.readdirSync)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})

    expect(() => writeOutput('test-vault', pages, graph, index, TMP)).not.toThrow()

    expect(warn).toHaveBeenCalled()
    expect(fs.existsSync(path.join(TMP, 'test-vault', 'index.json'))).toBe(true)
  })

  it('falha ao apagar na poda só avisa e o index.json sai', () => {
    const pagesDir = path.join(TMP, 'test-vault', 'pages')
    fs.mkdirSync(path.join(pagesDir, 'Velha'), { recursive: true })
    fs.writeFileSync(path.join(pagesDir, 'Velha', 'X.json'), '{}')
    const realRm = fs.rmSync
    vi.spyOn(fs, 'rmSync').mockImplementation((p, o) => {
      if (String(p).endsWith('X.json')) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
      return realRm(p, o)
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})

    expect(() => writeOutput('test-vault', pages, graph, index, TMP)).not.toThrow()

    expect(warn).toHaveBeenCalled()
    expect(fs.existsSync(path.join(TMP, 'test-vault', 'index.json'))).toBe(true)
  })
})
