import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'
import { dbUserHasVaultAccess } from '@/lib/db'
import { assetAccessStatus } from '@/lib/asset-guard'
import { getVaultBySlug } from '@/lib/vault-config'
import { IMAGE_CONTENT_TYPES, lookupAsset } from '@/lib/vault-assets'
import { IMAGE_EXTS } from '@/builder/scanner'

const empty = (status: number) => new Response(null, { status })

const SLUG_RE = /^[a-zA-Z0-9_-]+$/

function badSegment(s: string): boolean {
  return s === '' || s === '.' || s === '..' || s.includes('\\') || s.includes('\0')
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; path: string[] }> },
) {
  const { slug, path: segments } = await params

  // 1. Sessão. O proxy já barra antes; aqui confere de novo.
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  const user = token ? await verifyToken(token) : null
  const status = assetAccessStatus(slug, user, dbUserHasVaultAccess)
  if (status !== 200) return empty(status)

  // 2. Slug válido e configurado.
  if (!SLUG_RE.test(slug)) return empty(404)
  const vault = getVaultBySlug(slug)
  if (!vault) return empty(404)

  // 3. Segmentos suspeitos.
  if (!segments?.length || segments.some(badSegment)) return empty(404)

  // 4. Só serve o que está no assets.json. Tenta como chegou e, se não achar,
  // decodificado (tanto faz se o Next entrega os segmentos já decodificados).
  let rel = lookupAsset(slug, segments.join('/'))
  if (!rel) {
    let decoded: string[]
    try {
      decoded = segments.map(decodeURIComponent)
    } catch {
      return empty(404)
    }
    if (decoded.some(badSegment)) return empty(404)
    rel = lookupAsset(slug, decoded.join('/'))
  }
  if (!rel) return empty(404)

  // 5. Dentro da raiz do vault, arquivo comum, extensão de imagem.
  const root = path.resolve(vault.path)
  const abs = path.resolve(root, rel)
  if (!abs.startsWith(root + path.sep)) return empty(404)
  const ext = path.extname(abs).toLowerCase()
  if (!IMAGE_EXTS.has(ext)) return empty(404)
  let st: fs.Stats
  try {
    st = fs.statSync(abs)
  } catch {
    return empty(404)
  }
  if (!st.isFile()) return empty(404)

  // 6. Cabeçalhos e 304.
  const headers: Record<string, string> = {
    ETag: `W/"${st.size}-${Math.floor(st.mtimeMs)}"`,
    'Last-Modified': new Date(st.mtimeMs).toUTCString(),
    'Cache-Control': 'private, no-cache',
  }
  const inm = request.headers.get('if-none-match')
  const ims = request.headers.get('if-modified-since')
  let notModified = false
  if (inm !== null) {
    notModified = inm.split(',').some((t) => t.trim() === headers.ETag)
  } else if (ims) {
    const t = Date.parse(ims)
    notModified = !Number.isNaN(t) && t >= Math.floor(st.mtimeMs / 1000) * 1000
  }
  if (notModified) return new Response(null, { status: 304, headers })

  headers['Content-Type'] = IMAGE_CONTENT_TYPES[ext] ?? 'application/octet-stream'
  headers['Content-Length'] = String(st.size)
  headers['X-Content-Type-Options'] = 'nosniff'
  if (ext === '.svg') {
    headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
  }
  const body = Readable.toWeb(fs.createReadStream(abs)) as unknown as ReadableStream
  return new Response(body, { status: 200, headers })
}
