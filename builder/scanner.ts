import fs from 'fs'
import path from 'path'
import type { VaultIgnore } from './vault-ignore'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif'])

const NOOP_IGNORE: VaultIgnore = { ignores: () => false, ignoresDir: () => false }

export interface ScannedFile {
  absolutePath: string
  relativePath: string  // relativo ao vault root, sem .md, barras normais
  title: string
}

// Caminho relativo (com barras normais e extensão) de um arquivo ao vault root.
function relOf(vaultPath: string, full: string): string {
  return path.relative(vaultPath, full).replace(/\\/g, '/')
}

// Varre o vault aplicando `.viewerignore`: pula diretórios e arquivos casados.
function walkVault(
  vaultPath: string,
  ig: VaultIgnore,
  visitFile: (entryName: string, full: string, rel: string) => void,
): void {
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      const rel = relOf(vaultPath, full)
      if (entry.isDirectory()) {
        if (ig.ignoresDir(rel)) continue
        walk(full)
      } else {
        if (ig.ignores(rel)) continue
        visitFile(entry.name, full, rel)
      }
    }
  }
  walk(vaultPath)
}

export function scanVault(vaultPath: string, ig: VaultIgnore = NOOP_IGNORE): ScannedFile[] {
  const results: ScannedFile[] = []
  walkVault(vaultPath, ig, (name, full, rel) => {
    if (name.endsWith('.md')) {
      results.push({ absolutePath: full, relativePath: rel.replace(/\.md$/, ''), title: name.slice(0, -3) })
    }
  })
  return results
}

export function scanCanvases(vaultPath: string, ig: VaultIgnore = NOOP_IGNORE): ScannedFile[] {
  const results: ScannedFile[] = []
  walkVault(vaultPath, ig, (name, full, rel) => {
    if (name.endsWith('.canvas')) {
      results.push({ absolutePath: full, relativePath: rel.replace(/\.canvas$/, ''), title: name.slice(0, -7) })
    }
  })
  return results
}

export function scanImages(vaultPath: string, ig: VaultIgnore = NOOP_IGNORE): Map<string, string> {
  const result = new Map<string, string>()
  walkVault(vaultPath, ig, (name, _full, rel) => {
    if (IMAGE_EXTS.has(path.extname(name).toLowerCase())) {
      result.set(name.toLowerCase(), rel)
    }
  })
  return result
}

export function countFolders(vaultPath: string, ig: VaultIgnore = NOOP_IGNORE): number {
  let count = 0
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      if (!entry.isDirectory()) continue
      const full = path.join(dir, entry.name)
      if (ig.ignoresDir(relOf(vaultPath, full))) continue
      count++
      walk(full)
    }
  }
  walk(vaultPath)
  return count
}
