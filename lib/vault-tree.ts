import type { PageSummary } from '@/builder/types'

// Last '/'-separated segment of a page path (the filename, sans extension since
// vault paths never carry one). Folder-note matching is filename-based, so it
// must compare this against a folder's name — never the (possibly remapped)
// display title.
function basename(p: string): string {
  return p.split('/').pop() ?? p
}

export interface TreeNode {
  name: string
  path: string | null        // null for folder nodes
  folderPath: string | null  // full folder path (folder names joined by '/'), null for files
  isFolder: boolean
  children: TreeNode[]
  tags: string[]
}

export function buildTree(pages: PageSummary[]): TreeNode[] {
  const root: TreeNode[] = []

  for (const page of pages) {
    const segments = page.path.split('/')
    let level = root
    const folderSegments: string[] = []

    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]
      folderSegments.push(seg)
      let node = level.find(n => n.name === seg && n.isFolder)
      if (!node) {
        node = {
          name: seg,
          path: null,
          folderPath: folderSegments.join('/'),
          isFolder: true,
          children: [],
          tags: [],
        }
        level.push(node)
      }
      level = node.children
    }

    // Leaf display name is the page's resolved title; folder structure/sorting
    // above still keys off path segments. Folder-note matching below uses the
    // path basename, so a differing display title never breaks absorption.
    level.push({ name: page.title, path: page.path, folderPath: null, isFolder: false, children: [], tags: page.tags })
  }

  sortTree(root)
  absorbFolderNotes(root)
  return root
}

// Notion-style folder notes, two conventions:
//   1. INSIDE  — a folder contains a direct child file whose name equals the
//      folder's own name (e.g. `Império/Império.md`).
//   2. SIBLING — a file sits NEXT TO the folder in the same directory, sharing
//      its name (e.g. `Personalidades/Nações.md` next to `Personalidades/Nações/`).
// In both cases that page becomes the folder's page (the folder stays a folder)
// and the file node is removed from the listing.
//
// Precedence: if BOTH conventions exist for the same folder, the INSIDE note
// wins and the sibling file is left alone as a normal child of the parent.
function absorbFolderNotes(nodes: TreeNode[]): void {
  // First, absorb INSIDE notes (and recurse into the subtree from there).
  for (const node of nodes) {
    if (node.isFolder) {
      const idx = node.children.findIndex(
        c => !c.isFolder && c.path !== null && basename(c.path) === node.name,
      )
      if (idx !== -1) {
        const child = node.children[idx]
        node.path = child.path
        node.children.splice(idx, 1)
      }
      absorbFolderNotes(node.children)
    }
  }

  // Then, at this level, absorb SIBLING notes: a folder and a file sharing the
  // same name. Skip folders that already have an inside-note (precedence).
  for (const node of nodes) {
    if (!node.isFolder || node.path !== null) continue
    const idx = nodes.findIndex(n => !n.isFolder && n.path !== null && basename(n.path) === node.name)
    if (idx !== -1) {
      const sibling = nodes[idx]
      node.path = sibling.path
      nodes.splice(idx, 1)
    }
  }
}

function sortTree(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
    return a.name.localeCompare(b.name, 'pt-BR')
  })
  nodes.forEach(n => sortTree(n.children))
}
