import fs from 'fs'
import path from 'path'
import type { PageMeta, BuildGraph, PageSummary } from '@/builder/types'
import type { TreeNode } from '@/lib/vault-tree'

const DATA_ROOT = path.join(process.cwd(), 'data')

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

export function getPageData(slug: string, pathSegments: string[]): PageMeta | null {
  const safe = sanitizeSlug(slug)
  if (!safe) return null
  if (pathSegments.length === 0) return null
  const pagePath = pathSegments.map(s => decodeURIComponent(s)).join('/')
  const filePath = path.join(DATA_ROOT, safe, 'pages', toFilePath(pagePath) + '.json')
  const pagesRoot = path.join(DATA_ROOT, safe, 'pages')
  if (!filePath.startsWith(pagesRoot + path.sep) && filePath !== pagesRoot) return null
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
  const filePath = path.join(DATA_ROOT, safe, 'pages-index.json')
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
  const filePath = path.join(DATA_ROOT, safe, 'tree.json')
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
  const filePath = path.join(DATA_ROOT, safe, 'graph.json')
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as BuildGraph
  } catch {
    return null
  }
}

export function getVaultIndex(slug: string): { pageCount: number; folderCount: number; builtAt: string } | null {
  const safe = sanitizeSlug(slug)
  if (!safe) return null
  const filePath = path.join(DATA_ROOT, safe, 'index.json')
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
