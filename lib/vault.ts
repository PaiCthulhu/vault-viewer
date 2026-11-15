import fs from 'fs'
import path from 'path'
import type { PageMeta, BuildGraph, PageSummary } from '@/builder/types'
import type { TreeNode } from '@/lib/vault-tree'

// Calculado na chamada (e não no carregamento do módulo) para que testes possam trocar o cwd.
function dataRoot(): string {
  return path.join(process.cwd(), 'data')
}

function sanitizeSlug(slug: string): string | null {
  // Slug must only contain alphanumeric, hyphens, underscores
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) return null
  return slug
}

const ILLEGAL_CHARS = /[<>:"|?*\\]/g

function toFilePath(pagePath: string): string {
  return pagePath
    .split('/')
    .map(s => s.replace(ILLEGAL_CHARS, '_'))
    .join(path.sep)
}

// Caminho do JSON de uma página, saneado e contido em pages/ (null se o slug ou o caminho forem inválidos).
export function pageFilePath(slug: string, pagePath: string): string | null {
  const safe = sanitizeSlug(slug)
  if (!safe) return null
  if (!pagePath) return null
  const pagesRoot = path.join(dataRoot(), safe, 'pages')
  const filePath = path.join(pagesRoot, toFilePath(pagePath) + '.json')
  if (!filePath.startsWith(pagesRoot + path.sep) && filePath !== pagesRoot) return null
  return filePath
}

export function pageJsonMtimeMs(slug: string, pagePath: string): number | null {
  const filePath = pageFilePath(slug, pagePath)
  if (!filePath) return null
  try {
    return fs.statSync(filePath).mtimeMs
  } catch {
    return null
  }
}

export function getPageData(slug: string, pathSegments: string[]): PageMeta | null {
  if (pathSegments.length === 0) return null
  const pagePath = pathSegments.map(s => decodeURIComponent(s)).join('/')
  const filePath = pageFilePath(slug, pagePath)
  if (!filePath) return null
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PageMeta
  } catch {
    return null
  }
}

export function getPagesIndex(slug: string): PageSummary[] {
  const safe = sanitizeSlug(slug)
  if (!safe) return []
  const filePath = path.join(dataRoot(), safe, 'pages-index.json')
  if (!fs.existsSync(filePath)) return []
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PageSummary[]
  } catch {
    return []
  }
}

export function getVaultTree(slug: string): TreeNode[] {
  const safe = sanitizeSlug(slug)
  if (!safe) return []
  const filePath = path.join(dataRoot(), safe, 'tree.json')
  if (!fs.existsSync(filePath)) return []
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as TreeNode[]
  } catch {
    return []
  }
}

export function getGraphData(slug: string): BuildGraph | null {
  const safe = sanitizeSlug(slug)
  if (!safe) return null
  const filePath = path.join(dataRoot(), safe, 'graph.json')
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as BuildGraph
  } catch {
    return null
  }
}

export function getVaultIndex(slug: string): { pageCount: number; folderCount: number; builtAt: string; startedAt?: string } | null {
  const safe = sanitizeSlug(slug)
  if (!safe) return null
  const filePath = path.join(dataRoot(), safe, 'index.json')
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

export function findHomePage(slug: string, homePageTitle: string): PageMeta | null {
  const pages = getPagesIndex(slug)
  // Match by filename (homePage is usually a filename) or display title.
  const found = pages.find(p => p.file === homePageTitle || p.title === homePageTitle)
  if (found) return getPageData(slug, found.path.split('/'))
  if (pages.length > 0) return getPageData(slug, pages[0].path.split('/'))
  return null
}
