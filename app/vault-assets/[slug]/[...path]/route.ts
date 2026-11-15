import fs from 'fs'
import path from 'path'
import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'
import { dbUserHasVaultAccess } from '@/lib/db'
import { assetAccessStatus } from '@/lib/asset-guard'
import { getVaultBySlug } from '@/lib/vault-config'
import { IMAGE_CONTENT_TYPES, lookupAsset, resolveInsideRoot } from '@/lib/vault-assets'
import { IMAGE_EXTS } from '@/builder/scanner'

const empty = (status: number) => new Response(null, { status })

const SLUG_RE = /^[a-zA-Z0-9_-]+$/

type Params = { params: Promise<{ slug: string; path: string[] }> }

function badSegment(s: string): boolean {
  return s === '' || s === '.' || s === '..' || s.includes('\\') || s.includes('\0')
}

/** Valida o caminho já juntado (um `%2F` decodificado pode criar `..`). */
function badPath(joined: string): boolean {
  return joined.split('/').some(badSegment)
}

/**
 * Todas as checagens (passos 1 a 6) e os cabeçalhos. Devolve uma resposta de
 * erro/304 pronta, ou `{ abs, headers, size }` para o GET ler e o HEAD só
 * responder. O arquivo é lido inteiro no GET (imagens de poucos MB): um stream
 * aberto vazaria o descritor se o cliente desistisse ou no HEAD.
 */
async function prepare(request: NextRequest, { params }: Params) {
  const { slug, path: segments } = await params

  // 1. Sessão. O proxy já barra antes; aqui confere de novo.
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  const user = token ? await verifyToken(token) : null
  const status = assetAccessStatus(slug, user, dbUserHasVaultAccess)
  if (status !== 200) return { response: empty(status) }

  // 2. Slug válido e configurado.
  if (!SLUG_RE.test(slug)) return { response: empty(404) }
  const vault = getVaultBySlug(slug)
  if (!vault) return { response: empty(404) }

  // 3. Segmentos suspeitos, por segmento e no caminho juntado.
  if (!segments?.length || segments.some(badSegment) || badPath(segments.join('/'))) {
    return { response: empty(404) }
  }

  // 4. Só serve o que está no assets.json. Tenta como chegou e, se não achar,
  // decodificado (tanto faz se o Next entrega os segmentos já decodificados).
  let rel = lookupAsset(slug, segments.join('/'))
  if (!rel) {
    let decoded: string
    try {
      decoded = segments.map(decodeURIComponent).join('/')
    } catch {
      return { response: empty(404) }
    }
    if (badPath(decoded)) return { response: empty(404) }
    rel = lookupAsset(slug, decoded)
  }
  if (!rel) return { response: empty(404) }

  // 5. Dentro da raiz do vault, arquivo comum, extensão de imagem.
  const abs = resolveInsideRoot(vault.path, rel)
  if (!abs) return { response: empty(404) }
  const ext = path.extname(abs).toLowerCase()
  if (!IMAGE_EXTS.has(ext)) return { response: empty(404) }
  let st: fs.Stats
  try {
    st = fs.statSync(abs)
  } catch {
    return { response: empty(404) }
  }
  if (!st.isFile()) return { response: empty(404) }

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
  if (notModified) return { response: new Response(null, { status: 304, headers }) }

  headers['Content-Type'] = IMAGE_CONTENT_TYPES[ext] ?? 'application/octet-stream'
  headers['X-Content-Type-Options'] = 'nosniff'
  if (ext === '.svg') {
    headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
  }
  return { abs, headers, size: st.size }
}

export async function GET(request: NextRequest, ctx: Params) {
  const r = await prepare(request, ctx)
  if (r.response) return r.response
  let data: Buffer
  try {
    data = await fs.promises.readFile(r.abs)
  } catch {
    return empty(404)
  }
  return new Response(data as unknown as BodyInit, {
    status: 200,
    headers: { ...r.headers, 'Content-Length': String(data.length) },
  })
}

export async function HEAD(request: NextRequest, ctx: Params) {
  const r = await prepare(request, ctx)
  if (r.response) return r.response
  return new Response(null, {
    status: 200,
    headers: { ...r.headers, 'Content-Length': String(r.size) },
  })
}
