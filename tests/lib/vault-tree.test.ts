import { describe, it, expect } from 'vitest'
import { buildTree, countTreeFolders } from '../../lib/vault-tree'
import type { PageSummary } from '../../builder/types'

const pages: PageSummary[] = [
  { path: 'Alpha', title: 'Alpha', file: 'Alpha', tags: [] },
  { path: 'Equipes/Charlie', title: 'Charlie', file: 'Charlie', tags: ['tag-a'] },
  { path: 'Equipes/Delta', title: 'Delta', file: 'Delta', tags: [] },
  { path: 'Seleções/Subpasta/Ágata', title: 'Ágata', file: 'Ágata', tags: [] },
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
    const equipes = tree.find(n => n.name === 'Equipes')
    expect(equipes).toBeDefined()
    expect(equipes?.isFolder).toBe(true)
    expect(equipes?.path).toBeNull()
    expect(equipes?.folderPath).toBe('Equipes')
    expect(equipes?.children).toHaveLength(2)
  })

  it('nests folders recursively', () => {
    const tree = buildTree(pages)
    const selecoes = tree.find(n => n.name === 'Seleções')
    expect(selecoes?.isFolder).toBe(true)
    expect(selecoes?.folderPath).toBe('Seleções')
    const subpasta = selecoes?.children.find(n => n.name === 'Subpasta')
    expect(subpasta?.isFolder).toBe(true)
    expect(subpasta?.folderPath).toBe('Seleções/Subpasta')
    expect(subpasta?.children[0].name).toBe('Ágata')
    expect(subpasta?.children[0].path).toBe('Seleções/Subpasta/Ágata')
    expect(subpasta?.children[0].folderPath).toBeNull()
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
      { path: 'Ômega/Ômega', title: 'Ômega', file: 'Ômega', tags: ['tag-b'] },
      { path: 'Ômega/Gama', title: 'Gama', file: 'Gama', tags: [] },
    ])
    const folder = tree.find(n => n.name === 'Ômega')
    expect(folder).toBeDefined()
    expect(folder?.isFolder).toBe(true)
    expect(folder?.folderPath).toBe('Ômega')
    // The folder now points at the folder-note page.
    expect(folder?.path).toBe('Ômega/Ômega')
    // The same-name child was removed; only siblings remain.
    expect(folder?.children).toHaveLength(1)
    expect(folder?.children[0].name).toBe('Gama')
    expect(folder?.children.find(c => c.name === 'Ômega')).toBeUndefined()
  })

  it('leaves a folder without a same-name child unchanged', () => {
    const tree = buildTree([
      { path: 'Equipes/Charlie', title: 'Charlie', file: 'Charlie', tags: [] },
      { path: 'Equipes/Delta', title: 'Delta', file: 'Delta', tags: [] },
    ])
    const folder = tree.find(n => n.name === 'Equipes')
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
      { path: 'Equipes/Canções', title: 'Canções', file: 'Canções', tags: ['tag-b'] },
      { path: 'Equipes/Canções/Ômega', title: 'Ômega', file: 'Ômega', tags: [] },
    ])
    const parent = tree.find(n => n.name === 'Equipes')
    expect(parent?.isFolder).toBe(true)
    const cancoes = parent?.children.find(n => n.name === 'Canções')
    // The folder absorbed its sibling note as the folder page.
    expect(cancoes?.isFolder).toBe(true)
    expect(cancoes?.folderPath).toBe('Equipes/Canções')
    expect(cancoes?.path).toBe('Equipes/Canções')
    // The sibling file was removed; only the folder node named "Canções" remains.
    const namedCancoes = parent?.children.filter(n => n.name === 'Canções')
    expect(namedCancoes).toHaveLength(1)
    expect(parent?.children.find(c => c.name === 'Canções' && !c.isFolder)).toBeUndefined()
    // Folder's own contents are preserved.
    expect(cancoes?.children).toHaveLength(1)
    expect(cancoes?.children[0].name).toBe('Ômega')
  })

  it('absorbs a sibling note at the root level', () => {
    const tree = buildTree([
      { path: 'Canções', title: 'Canções', file: 'Canções', tags: [] },
      { path: 'Canções/Ômega', title: 'Ômega', file: 'Ômega', tags: [] },
    ])
    const namedCancoes = tree.filter(n => n.name === 'Canções')
    expect(namedCancoes).toHaveLength(1)
    const cancoes = namedCancoes[0]
    expect(cancoes.isFolder).toBe(true)
    expect(cancoes.path).toBe('Canções')
    expect(cancoes.folderPath).toBe('Canções')
    expect(tree.find(n => n.name === 'Canções' && !n.isFolder)).toBeUndefined()
    expect(cancoes.children).toHaveLength(1)
    expect(cancoes.children[0].name).toBe('Ômega')
  })

  it('prefers the inside note over a sibling note when both exist', () => {
    const tree = buildTree([
      // sibling note next to the folder
      { path: 'Parent/Canções', title: 'Canções (sibling)', file: 'Canções', tags: [] },
      // inside note within the folder
      { path: 'Parent/Canções/Canções', title: 'Canções (inside)', file: 'Canções', tags: [] },
      { path: 'Parent/Canções/Outro', title: 'Outro', file: 'Outro', tags: [] },
    ])
    const parent = tree.find(n => n.name === 'Parent')
    const cancoesFolder = parent?.children.find(n => n.name === 'Canções' && n.isFolder)
    // Inside note wins.
    expect(cancoesFolder?.path).toBe('Parent/Canções/Canções')
    expect(cancoesFolder?.children).toHaveLength(1)
    expect(cancoesFolder?.children[0].name).toBe('Outro')
    // Sibling file is left alone as a normal child of the parent. Its display
    // name is the title (which differs from the filename/folder name).
    const siblingFile = parent?.children.find(n => !n.isFolder && n.path === 'Parent/Canções')
    expect(siblingFile).toBeDefined()
    expect(siblingFile?.name).toBe('Canções (sibling)')
    // Parent therefore has two children: the "Canções" folder and the sibling file.
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
      { path: 'Equipes/Home', title: 'Minha Coleção', file: 'Home', tags: [] },
    ])
    const folder = tree.find(n => n.name === 'Equipes')
    expect(folder?.isFolder).toBe(true)
    const leaf = folder?.children[0]
    // Leaf name reflects the resolved display title, not the filename.
    expect(leaf?.name).toBe('Minha Coleção')
    expect(leaf?.path).toBe('Equipes/Home')
  })

  it('absorbs a folder note matched by path basename even when its title differs', () => {
    const tree = buildTree([
      // Inside note: filename equals folder name, but display title differs.
      { path: 'Ômega/Ômega', title: 'O Grande Ômega', file: 'Ômega', tags: ['tag-b'] },
      { path: 'Ômega/Gama', title: 'Gama', file: 'Gama', tags: [] },
    ])
    const folder = tree.find(n => n.name === 'Ômega')
    expect(folder?.isFolder).toBe(true)
    // Absorbed despite the differing display title.
    expect(folder?.path).toBe('Ômega/Ômega')
    expect(folder?.children).toHaveLength(1)
    expect(folder?.children[0].name).toBe('Gama')
  })
})

// Página só pelo caminho: título e arquivo saem do último segmento.
const pg = (p: string): PageSummary => {
  const file = p.split('/').pop() ?? p
  return { path: p, title: file, file, tags: [] }
}
const count = (paths: string[]) => countTreeFolders(buildTree(paths.map(pg)))

describe('countTreeFolders', () => {
  it('árvore vazia ou só com arquivos na raiz não tem pasta', () => {
    expect(count([])).toBe(0)
    expect(count(['Alpha', 'Beta'])).toBe(0)
  })

  it('conta a pasta comum e a aninhada', () => {
    expect(count(['Alpha', 'Equipes/Charlie', 'Equipes/Delta', 'Seleções/Subpasta/Ágata'])).toBe(3)
  })

  it('a nota de pasta dentro não vira pasta extra', () => {
    expect(count(['Ômega/Ômega', 'Ômega/Gama'])).toBe(1)
  })

  it('a pasta que só tem a nota de pasta dentro continua contando', () => {
    expect(count(['Só/Só'])).toBe(1)
  })

  it('a nota de pasta irmã é absorvida: a pasta conta uma vez só', () => {
    expect(count(['Canções', 'Canções/Ágata'])).toBe(1)
  })

  it('as duas convenções na mesma pasta contam uma vez só', () => {
    expect(count(['Cartões/Cartões', 'Cartões', 'Cartões/Gama'])).toBe(1)
  })

  it('nota de pasta aninhada: cada nível conta uma vez', () => {
    expect(count(['A/A', 'A/B/B', 'A/B/C'])).toBe(2)
  })

  it('não muda a árvore', () => {
    const tree = buildTree(['Canções', 'Canções/Ágata', 'A/B/C'].map(pg))
    const before = JSON.stringify(tree)
    countTreeFolders(tree)
    expect(JSON.stringify(tree)).toBe(before)
  })
})
