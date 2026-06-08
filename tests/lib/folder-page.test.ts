import { describe, it, expect } from 'vitest'
import { buildFolderPage } from '../../lib/folder-page'
import type { TreeNode } from '../../lib/vault-tree'

function folder(name: string, folderPath: string, path: string | null = null): TreeNode {
  return { name, path, folderPath, isFolder: true, children: [], tags: [] }
}
function file(name: string, path: string): TreeNode {
  return { name, path, folderPath: null, isFolder: false, children: [], tags: [] }
}

describe('buildFolderPage', () => {
  const children: TreeNode[] = [
    folder('Regras', 'Outros/Regras', 'Outros/Regras/Regras'), // folder note
    file('Retcons', 'Outros/Retcons'),
    file('Sobre Drachengötter', 'Outros/Sobre Drachengötter'),
  ]

  it('uses the last folderPath segment as the title', () => {
    const page = buildFolderPage('drachegotter', 'Outros', 'Outros', children)
    expect(page.title).toBe('Outros')
    expect(page.path).toBe('Outros')
    expect(page.html).toContain('<h1 class="vault-page-title">Outros</h1>')
  })

  it('wraps the list in the vault-content article with a folder-index list', () => {
    const page = buildFolderPage('drachegotter', 'Outros', 'Outros', children)
    expect(page.html).toContain('<article class="vault-content">')
    expect(page.html).toContain('<ul class="folder-index">')
  })

  it('links a folder note to its real page with a document icon', () => {
    const page = buildFolderPage('drachegotter', 'Outros', 'Outros', children)
    expect(page.html).toContain(
      '<a href="/vault/drachegotter/Outros/Regras/Regras"><span class="folder-index-icon">📄</span>Regras</a>',
    )
  })

  it('links a plain folder to its folderPath index', () => {
    const page = buildFolderPage('s', 'Top', 'Top', [folder('Sub', 'Top/Sub')])
    expect(page.html).toContain(
      '<a href="/vault/s/Top/Sub"><span class="folder-index-icon">📁</span>Sub</a>',
    )
  })

  it('links file children to their page with a document icon', () => {
    const page = buildFolderPage('drachegotter', 'Outros', 'Outros', children)
    expect(page.html).toContain('<span class="folder-index-icon">📄</span>Retcons')
    expect(page.html).toContain('<span class="folder-index-icon">📄</span>Sobre Drachengötter')
  })

  it('per-segment URL encodes paths (spaces, not slashes)', () => {
    const page = buildFolderPage('s', 'A', 'A', [file('B C', 'A/B C')])
    expect(page.html).toContain('href="/vault/s/A/B%20C"')
  })

  it('escapes & and < in titles and child names', () => {
    const page = buildFolderPage('s', 'A & <B>', 'A & <B>', [file('x<y&z', 'A/x')])
    expect(page.html).toContain('<h1 class="vault-page-title">A &amp; &lt;B></h1>')
    expect(page.html).toContain('x&lt;y&amp;z')
  })

  it('produces a PageMeta-shaped object with empty graph fields', () => {
    const page = buildFolderPage('s', 'A', 'A', [])
    expect(page.outlinks).toEqual([])
    expect(page.tags).toEqual([])
    expect(page.css).toBe('')
    expect(page.allFields).toEqual({})
    expect(page.frontmatter).toEqual({ cssclasses: '' })
  })
})
