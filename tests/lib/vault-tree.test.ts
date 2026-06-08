import { describe, it, expect } from 'vitest'
import { buildTree } from '../../lib/vault-tree'
import type { PageSummary } from '../../builder/types'

const pages: PageSummary[] = [
  { path: 'Alpha', title: 'Alpha', file: 'Alpha', tags: [] },
  { path: 'Personagens/Aldor', title: 'Aldor', file: 'Aldor', tags: ['lore'] },
  { path: 'Personagens/Ragnar', title: 'Ragnar', file: 'Ragnar', tags: [] },
  { path: 'Facções/Cavaleiros/Ordem', title: 'Ordem', file: 'Ordem', tags: [] },
]

describe('buildTree', () => {
  it('creates top-level files as leaf nodes', () => {
    const tree = buildTree(pages)
    const alpha = tree.find(n => n.name === 'Alpha')
    expect(alpha).toBeDefined()
    expect(alpha?.isFolder).toBe(false)
    expect(alpha?.path).toBe('Alpha')
  })

  it('creates folder nodes for path segments', () => {
    const tree = buildTree(pages)
    const personagens = tree.find(n => n.name === 'Personagens')
    expect(personagens).toBeDefined()
    expect(personagens?.isFolder).toBe(true)
    expect(personagens?.path).toBeNull()
    expect(personagens?.folderPath).toBe('Personagens')
    expect(personagens?.children).toHaveLength(2)
  })

  it('nests folders recursively', () => {
    const tree = buildTree(pages)
    const faccoes = tree.find(n => n.name === 'Facções')
    expect(faccoes?.isFolder).toBe(true)
    expect(faccoes?.folderPath).toBe('Facções')
    const cavaleiros = faccoes?.children.find(n => n.name === 'Cavaleiros')
    expect(cavaleiros?.isFolder).toBe(true)
    expect(cavaleiros?.folderPath).toBe('Facções/Cavaleiros')
    expect(cavaleiros?.children[0].name).toBe('Ordem')
    expect(cavaleiros?.children[0].path).toBe('Facções/Cavaleiros/Ordem')
    expect(cavaleiros?.children[0].folderPath).toBeNull()
  })

  it('sorts folders before files, then alphabetically', () => {
    const tree = buildTree(pages)
    const folderFirst = tree.filter(n => n.isFolder)
    const filesAfter = tree.filter(n => !n.isFolder)
    expect(tree.indexOf(folderFirst[0])).toBeLessThan(tree.indexOf(filesAfter[0]))
  })
})

describe('buildTree folder notes', () => {
  it('absorbs a same-name child into its folder as the folder page', () => {
    const tree = buildTree([
      { path: 'Império/Império', title: 'Império', file: 'Império', tags: ['nation'] },
      { path: 'Império/Cidade', title: 'Cidade', file: 'Cidade', tags: [] },
    ])
    const folder = tree.find(n => n.name === 'Império')
    expect(folder).toBeDefined()
    expect(folder?.isFolder).toBe(true)
    expect(folder?.folderPath).toBe('Império')
    // The folder now points at the folder-note page.
    expect(folder?.path).toBe('Império/Império')
    // The same-name child was removed; only siblings remain.
    expect(folder?.children).toHaveLength(1)
    expect(folder?.children[0].name).toBe('Cidade')
    expect(folder?.children.find(c => c.name === 'Império')).toBeUndefined()
  })

  it('leaves a folder without a same-name child unchanged', () => {
    const tree = buildTree([
      { path: 'Personagens/Aldor', title: 'Aldor', file: 'Aldor', tags: [] },
      { path: 'Personagens/Ragnar', title: 'Ragnar', file: 'Ragnar', tags: [] },
    ])
    const folder = tree.find(n => n.name === 'Personagens')
    expect(folder?.isFolder).toBe(true)
    expect(folder?.path).toBeNull()
    expect(folder?.children).toHaveLength(2)
  })

  it('absorbs nested folder notes at each level', () => {
    const tree = buildTree([
      { path: 'A/A', title: 'A', file: 'A', tags: [] },
      { path: 'A/B/B', title: 'B', file: 'B', tags: [] },
      { path: 'A/B/Leaf', title: 'Leaf', file: 'Leaf', tags: [] },
    ])
    const a = tree.find(n => n.name === 'A')
    expect(a?.isFolder).toBe(true)
    expect(a?.path).toBe('A/A')
    const b = a?.children.find(n => n.name === 'B')
    expect(b?.isFolder).toBe(true)
    expect(b?.path).toBe('A/B/B')
    expect(b?.children).toHaveLength(1)
    expect(b?.children[0].name).toBe('Leaf')
    expect(b?.children[0].path).toBe('A/B/Leaf')
  })

  it('absorbs a sibling note sitting next to the folder', () => {
    const tree = buildTree([
      { path: 'Personalidades/Nações', title: 'Nações', file: 'Nações', tags: ['nation'] },
      { path: 'Personalidades/Nações/Império', title: 'Império', file: 'Império', tags: [] },
    ])
    const parent = tree.find(n => n.name === 'Personalidades')
    expect(parent?.isFolder).toBe(true)
    const nacoes = parent?.children.find(n => n.name === 'Nações')
    // The folder absorbed its sibling note as the folder page.
    expect(nacoes?.isFolder).toBe(true)
    expect(nacoes?.folderPath).toBe('Personalidades/Nações')
    expect(nacoes?.path).toBe('Personalidades/Nações')
    // The sibling file was removed; only the folder node named "Nações" remains.
    const namedNacoes = parent?.children.filter(n => n.name === 'Nações')
    expect(namedNacoes).toHaveLength(1)
    expect(parent?.children.find(c => c.name === 'Nações' && !c.isFolder)).toBeUndefined()
    // Folder's own contents are preserved.
    expect(nacoes?.children).toHaveLength(1)
    expect(nacoes?.children[0].name).toBe('Império')
  })

  it('absorbs a sibling note at the root level', () => {
    const tree = buildTree([
      { path: 'Nações', title: 'Nações', file: 'Nações', tags: [] },
      { path: 'Nações/Império', title: 'Império', file: 'Império', tags: [] },
    ])
    const namedNacoes = tree.filter(n => n.name === 'Nações')
    expect(namedNacoes).toHaveLength(1)
    const nacoes = namedNacoes[0]
    expect(nacoes.isFolder).toBe(true)
    expect(nacoes.path).toBe('Nações')
    expect(nacoes.folderPath).toBe('Nações')
    expect(tree.find(n => n.name === 'Nações' && !n.isFolder)).toBeUndefined()
    expect(nacoes.children).toHaveLength(1)
    expect(nacoes.children[0].name).toBe('Império')
  })

  it('prefers the inside note over a sibling note when both exist', () => {
    const tree = buildTree([
      // sibling note next to the folder
      { path: 'Parent/Nações', title: 'Nações (sibling)', file: 'Nações', tags: [] },
      // inside note within the folder
      { path: 'Parent/Nações/Nações', title: 'Nações (inside)', file: 'Nações', tags: [] },
      { path: 'Parent/Nações/Outro', title: 'Outro', file: 'Outro', tags: [] },
    ])
    const parent = tree.find(n => n.name === 'Parent')
    const nacoesFolder = parent?.children.find(n => n.name === 'Nações' && n.isFolder)
    // Inside note wins.
    expect(nacoesFolder?.path).toBe('Parent/Nações/Nações')
    expect(nacoesFolder?.children).toHaveLength(1)
    expect(nacoesFolder?.children[0].name).toBe('Outro')
    // Sibling file is left alone as a normal child of the parent. Its display
    // name is the title (which differs from the filename/folder name).
    const siblingFile = parent?.children.find(n => !n.isFolder && n.path === 'Parent/Nações')
    expect(siblingFile).toBeDefined()
    expect(siblingFile?.name).toBe('Nações (sibling)')
    // Parent therefore has two children: the "Nações" folder and the sibling file.
    expect(parent?.children).toHaveLength(2)
  })

  it('keeps folders-first ordering after sibling removal', () => {
    const tree = buildTree([
      { path: 'Bravo', title: 'Bravo', file: 'Bravo', tags: [] },
      { path: 'Bravo/Inner', title: 'Inner', file: 'Inner', tags: [] },
      { path: 'Alpha', title: 'Alpha', file: 'Alpha', tags: [] },
    ])
    // Bravo file absorbed into Bravo folder; Alpha file remains.
    const bravo = tree.find(n => n.name === 'Bravo')
    expect(bravo?.isFolder).toBe(true)
    expect(bravo?.path).toBe('Bravo')
    const folders = tree.filter(n => n.isFolder)
    const files = tree.filter(n => !n.isFolder)
    expect(folders.map(n => n.name)).toEqual(['Bravo'])
    expect(files.map(n => n.name)).toEqual(['Alpha'])
    // Folder sorts before file.
    expect(tree.indexOf(bravo!)).toBeLessThan(tree.indexOf(files[0]))
  })

  it('uses the display title as the leaf name even when it differs from the path basename', () => {
    const tree = buildTree([
      { path: 'Personagens/00_Index', title: 'Projeto Ignis', file: '00_Index', tags: [] },
    ])
    const folder = tree.find(n => n.name === 'Personagens')
    expect(folder?.isFolder).toBe(true)
    const leaf = folder?.children[0]
    // Leaf name reflects the resolved display title, not the filename.
    expect(leaf?.name).toBe('Projeto Ignis')
    expect(leaf?.path).toBe('Personagens/00_Index')
  })

  it('absorbs a folder note matched by path basename even when its title differs', () => {
    const tree = buildTree([
      // Inside note: filename equals folder name, but display title differs.
      { path: 'Império/Império', title: 'O Grande Império', file: 'Império', tags: ['nation'] },
      { path: 'Império/Cidade', title: 'Cidade', file: 'Cidade', tags: [] },
    ])
    const folder = tree.find(n => n.name === 'Império')
    expect(folder?.isFolder).toBe(true)
    // Absorbed despite the differing display title.
    expect(folder?.path).toBe('Império/Império')
    expect(folder?.children).toHaveLength(1)
    expect(folder?.children[0].name).toBe('Cidade')
  })
})
