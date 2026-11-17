import fs from 'fs'
import path from 'path'
import type { VaultIgnore } from './vault-ignore'

export const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif'])

// Folga para o relógio do disco e a fração de ms do stat: uma nota recém-gravada pode vir 1 ms à frente.
const FUTURE_SLACK_MS = 2000

// Momento da nota para decidir se mudou: o maior entre mtime, ctime e birthtime
// (um arquivo copiado/movido mantém o mtime antigo, mas ganha ctime/birthtime novos).
// Timestamps no futuro (relógio adiantado, cópia que preserva datas) são ignorados: senão a nota
// nunca ficaria "anterior" a um build. Devolve -Infinity se os três estiverem no futuro.
export function noteTime(
  st: { mtimeMs: number; ctimeMs: number; birthtimeMs: number },
  now: number = Date.now(),
): number {
  return Math.max(...[st.mtimeMs, st.ctimeMs, st.birthtimeMs].filter(t => t <= now + FUTURE_SLACK_MS), -Infinity)
}

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

// Diz se o walkVault chegaria a visitar este arquivo (caminho relativo com extensão e barras '/').
// É a mesma regra da varredura: segmento vazio ou com ponto, pasta ignorada acima ou arquivo ignorado.
export function isScannedPath(relPath: string, ig: VaultIgnore): boolean {
  const parts = relPath.split('/')
  if (parts.some(seg => seg === '' || seg.startsWith('.'))) return false
  for (let i = 1; i < parts.length; i++) {
    if (ig.ignoresDir(parts.slice(0, i).join('/'))) return false
  }
  return !ig.ignores(relPath)
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
