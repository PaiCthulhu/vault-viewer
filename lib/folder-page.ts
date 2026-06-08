import type { PageMeta } from '@/builder/types'
import type { TreeNode } from '@/lib/vault-tree'
import { getVaultTree } from '@/lib/vault'

// Per-segment URL encoding, identical to the helper used elsewhere (SidebarPanel
// `hrefFor`): each path segment is encoded individually so '/' separators stay.
function encodePath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/')
}

// Minimal HTML escaping for text we interpolate into the index markup.
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
}

// Last '/'-separated segment of a path.
function lastSegment(p: string): string {
  return p.split('/').pop() ?? p
}

// Walk the tree to find the folder node whose folderPath === target. Matching by
// the accumulated folderPath (not display name) is robust against name remapping.
function findFolderNode(nodes: TreeNode[], folderPath: string): TreeNode | null {
  for (const node of nodes) {
    if (!node.isFolder) continue
    if (node.folderPath === folderPath) return node
    if (node.folderPath && folderPath.startsWith(node.folderPath + '/')) {
      const found = findFolderNode(node.children, folderPath)
      if (found) return found
    }
  }
  return null
}

// Pure builder: given a folder's display title, its (already-sorted) direct
// children and the vault slug, produce the synthetic index PageMeta. Extracted
// from `getFolderPage` so it is testable without any fs/tree lookup.
export function buildFolderPage(
  slug: string,
  folderPath: string,
  title: string,
  children: TreeNode[],
): PageMeta {
  const items = children
    .map(child => {
      if (child.isFolder) {
        // Match the file-tree convention. A folder note (folder WITH a path) has
        // its own page → 📄, linking to that real page. A plain folder (no path)
        // → 📁, linking to its synthetic index (folderPath).
        const target = child.path ?? child.folderPath
        if (!target) return ''
        const icon = child.path ? '📄' : '📁'
        const href = `/vault/${slug}/${encodePath(target)}`
        return `<li><a href="${href}"><span class="folder-index-icon">${icon}</span>${escapeHtml(child.name)}</a></li>`
      }
      // File leaf.
      const targetPath = child.path
      if (!targetPath) return ''
      const href = `/vault/${slug}/${encodePath(targetPath)}`
      return `<li><a href="${href}"><span class="folder-index-icon">📄</span>${escapeHtml(child.name)}</a></li>`
    })
    .filter(Boolean)
    .join('')

  const html =
    `<article class="vault-content">` +
    `<h1 class="vault-page-title">${escapeHtml(title)}</h1>` +
    `<ul class="folder-index">${items}</ul>` +
    `</article>`

  return {
    path: folderPath,
    title,
    frontmatter: { cssclasses: '' },
    allFields: {},
    html,
    outlinks: [],
    tags: [],
    css: '',
  }
}

// Given a slug and a folder path, build a synthetic index PageMeta listing the
// folder's direct children — or null if the path is not a folder in the vault.
export function getFolderPage(slug: string, folderPath: string): PageMeta | null {
  if (!folderPath) return null
  const tree = getVaultTree(slug)
  const node = findFolderNode(tree, folderPath)
  if (!node) return null
  const title = lastSegment(folderPath)
  return buildFolderPage(slug, folderPath, title, node.children)
}
