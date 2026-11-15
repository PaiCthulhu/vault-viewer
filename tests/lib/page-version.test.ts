import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { PageMeta } from '@/builder/types'
import { pageVersion, currentPageVersion } from '@/lib/page-version'
import { getFolderPage } from '@/lib/folder-page'

let root: string

function page(over: Partial<PageMeta> = {}): PageMeta {
  return {
    path: 'Jogos/Foo', title: 'Foo', frontmatter: {}, allFields: {},
    html: '<p>a</p>', outlinks: [], tags: [], css: '', ...over,
  }
}
function writePage(p: string, content: string, mtimeMs?: number) {
  const f = path.join(root, 'data', 'v', 'pages', p + '.json')
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, content)
  if (mtimeMs !== undefined) fs.utimesSync(f, new Date(mtimeMs), new Date(mtimeMs))
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pageversion-'))
  vi.spyOn(process, 'cwd').mockReturnValue(root)
})
afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('pageVersion', () => {
  it('é estável e muda com o conteúdo', () => {
    const a = pageVersion(page())
    expect(a).toMatch(/^[0-9a-f]{40}$/)
    expect(pageVersion(page())).toBe(a)
    expect(pageVersion(page({ html: '<p>b</p>' }))).not.toBe(a)
  })
})

describe('currentPageVersion', () => {
  it('bate com pageVersion da página lida', () => {
    const content = JSON.stringify(page())
    writePage('Jogos/Foo', content)
    expect(currentPageVersion('v', 'Jogos/Foo')).toBe(pageVersion(JSON.parse(content)))
  })

  it('regravar com o mesmo conteúdo e mtime novo mantém a versão', () => {
    const content = JSON.stringify(page())
    writePage('Jogos/Foo', content, 1_000_000)
    const a = currentPageVersion('v', 'Jogos/Foo')
    writePage('Jogos/Foo', content, 2_000_000)
    expect(currentPageVersion('v', 'Jogos/Foo')).toBe(a)
  })

  it('mudança de conteúdo com mtime novo muda a versão', () => {
    writePage('Jogos/Foo', JSON.stringify(page()), 1_000_000)
    const a = currentPageVersion('v', 'Jogos/Foo')
    writePage('Jogos/Foo', JSON.stringify(page({ html: '<p>novo</p>' })), 2_000_000)
    const b = currentPageVersion('v', 'Jogos/Foo')
    expect(b).not.toBe(a)
    expect(b).toBe(pageVersion(page({ html: '<p>novo</p>' })))
  })

  it('JSON que não parseia dá null', () => {
    writePage('Jogos/Foo', '{ quebrado')
    expect(currentPageVersion('v', 'Jogos/Foo')).toBeNull()
  })

  it('página de pasta', () => {
    const tree = [{
      name: 'Jogos', path: null, folderPath: 'Jogos', isFolder: true, tags: [],
      children: [{ name: 'Foo', path: 'Jogos/Foo', folderPath: null, isFolder: false, children: [], tags: [] }],
    }]
    fs.mkdirSync(path.join(root, 'data', 'v'), { recursive: true })
    fs.writeFileSync(path.join(root, 'data', 'v', 'tree.json'), JSON.stringify(tree))
    const folder = getFolderPage('v', 'Jogos')!
    expect(folder).not.toBeNull()
    expect(currentPageVersion('v', 'Jogos')).toBe(pageVersion(folder))
  })

  it('inexistente dá null', () => {
    expect(currentPageVersion('v', 'Nao/Existe')).toBeNull()
  })

  it('caminho inseguro dá null', () => {
    expect(currentPageVersion('v', '../x')).toBeNull()
    expect(currentPageVersion('v', 'a\\b')).toBeNull()
  })
})
