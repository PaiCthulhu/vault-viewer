import { describe, it, expect, afterEach } from 'vitest'
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
  afterEach(() => fs.rmSync(TMP, { recursive: true, force: true }))

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
})
