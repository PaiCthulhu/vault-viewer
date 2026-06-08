import fs from 'fs'
import path from 'path'
import type { PageMeta, VaultIndex, BuildGraph, PageSummary } from './types'
import { buildTree } from '@/lib/vault-tree'

// Chars ilegais em nomes de arquivo no Windows
const ILLEGAL_CHARS = /[<>:"|?*\\]/g

function toFilePath(pagePath: string): string {
  return pagePath
    .split('/')
    .map(segment => segment.replace(ILLEGAL_CHARS, '_'))
    .join(path.sep)
}

export function writeOutput(
  slug: string,
  pages: PageMeta[],
  graph: BuildGraph,
  index: VaultIndex,
  dataRoot: string = path.join(process.cwd(), 'data'),
): void {
  const dataDir = path.join(dataRoot, slug)
  const pagesDir = path.join(dataDir, 'pages')

  fs.mkdirSync(dataDir, { recursive: true })

  // index.json
  fs.writeFileSync(path.join(dataDir, 'index.json'), JSON.stringify(index, null, 2), 'utf-8')

  // graph.json
  fs.writeFileSync(path.join(dataDir, 'graph.json'), JSON.stringify(graph, null, 2), 'utf-8')

  // pages-index.json — `file` is the path basename (filename without extension),
  // kept alongside the display `title` so home/filename lookups still work even
  // when `title` comes from a frontmatter property.
  const pagesIndex: PageSummary[] = pages.map(p => ({
    path: p.path,
    title: p.title,
    file: p.path.split('/').pop() ?? p.path,
    tags: p.tags,
  }))
  fs.writeFileSync(path.join(dataDir, 'pages-index.json'), JSON.stringify(pagesIndex), 'utf-8')

  // tree.json — folder notes resolved at build time so the sidebar can bind it ready-made
  const tree = buildTree(pagesIndex)
  fs.writeFileSync(path.join(dataDir, 'tree.json'), JSON.stringify(tree), 'utf-8')

  // pages/*.json
  for (const page of pages) {
    const filePath = path.join(pagesDir, toFilePath(page.path) + '.json')
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(page, null, 2), 'utf-8')
  }

  console.log(`[${slug}] Escrito: ${pages.length} páginas → ${pagesDir}`)
}
