import fs from 'fs'
import path from 'path'

export const IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
}

/**
 * Resolve `rel` dentro de `root`; null se o resultado sair da raiz (ou for a
 * própria raiz).
 */
export function resolveInsideRoot(root: string, rel: string): string | null {
  const base = path.resolve(root)
  const abs = path.resolve(base, rel)
  return abs.startsWith(base + path.sep) ? abs : null
}

interface AssetIndex {
  mtimeMs: number
  size: number
  /** caminho em minúsculas -> caminho exato da lista */
  byLower: Map<string, string>
}

const cache = new Map<string, AssetIndex>()

/**
 * Procura `relPath` no `data/<slug>/assets.json` (lista de imagens citadas,
 * gravada pelo builder), sem diferenciar caixa, e devolve o caminho exato da
 * lista. Cache por slug, mtime e tamanho; JSON inválido (lido no meio da gravação)
 * mantém o cache anterior e não grava o mtime novo, para tentar de novo.
 */
export function lookupAsset(slug: string, relPath: string): string | null {
  const file = path.join(process.cwd(), 'data', slug, 'assets.json')
  let mtimeMs: number
  let size: number
  try {
    const st = fs.statSync(file)
    mtimeMs = st.mtimeMs
    size = st.size
  } catch {
    cache.delete(slug)
    return null
  }
  let entry = cache.get(slug)
  if (!entry || entry.mtimeMs !== mtimeMs || entry.size !== size) {
    try {
      const list: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'))
      if (!Array.isArray(list)) throw new Error('assets.json não é um array')
      const byLower = new Map<string, string>()
      for (const item of list) {
        if (typeof item === 'string' && !byLower.has(item.toLowerCase())) {
          byLower.set(item.toLowerCase(), item)
        }
      }
      entry = { mtimeMs, size, byLower }
      cache.set(slug, entry)
    } catch {
      // mantém o cache anterior (se houver) e tenta de novo na próxima requisição
    }
  }
  return entry?.byLower.get(relPath.toLowerCase()) ?? null
}
