import fs from 'fs'
import { createHash } from 'crypto'
import type { PageMeta } from '@/builder/types'
import { getFolderPage } from '@/lib/folder-page'
import { safePagePath } from '@/lib/pending-page'
import { pageFilePath } from '@/lib/vault'

// Versão de uma página: sha1 do objeto serializado, o mesmo que o page.tsx calcula sobre o que renderiza.
export function pageVersion(page: PageMeta): string {
  return createHash('sha1').update(JSON.stringify(page)).digest('hex')
}

// O builder regrava todo JSON a cada build, mesmo sem mudança, então o mtime não serve de versão: o
// hash é sobre o objeto. O cache evita reler e re-hashear o arquivo enquanto mtime e tamanho não mudam.
const cache = new Map<string, { mtimeMs: number; size: number; version: string }>()

// `p` já vem decodificado (por isso não passa por getPageData, que decodifica por segmento).
// null quando o caminho é inseguro, a página não existe ou o JSON não parseia.
export function currentPageVersion(slug: string, p: string): string | null {
  if (!safePagePath(p)) return null
  const file = pageFilePath(slug, p)
  if (!file) return null

  let st: fs.Stats | null = null
  try {
    st = fs.statSync(file)
  } catch {
    st = null
  }

  if (st?.isFile()) {
    const hit = cache.get(file)
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.version
    try {
      const version = pageVersion(JSON.parse(fs.readFileSync(file, 'utf-8')) as PageMeta)
      cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, version })
      return version
    } catch {
      return null
    }
  }

  // Sem JSON: página de pasta (sintética), recalculada a cada chamada.
  const folder = getFolderPage(slug, p)
  return folder ? pageVersion(folder) : null
}
