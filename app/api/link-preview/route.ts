import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'
import { decodeEntities as decodeEntitiesShared } from '@/lib/preview'

// ─── Response shape ──────────────────────────────────────────────────────────
interface LinkPreviewData {
  title: string | null
  description: string | null
  image: string | null
  favicon: string | null
  themeColor: string | null
  siteName: string | null
  url: string
}

// ─── Module-level in-memory cache (shared across requests in this process) ────
interface CacheEntry {
  data: LinkPreviewData
  ts: number
}
const CACHE_TTL = 60 * 60 * 1000 // 1h
const CACHE_CAP = 200
const cache = new Map<string, CacheEntry>()

function cacheGet(url: string): LinkPreviewData | null {
  const entry = cache.get(url)
  if (!entry) return null
  if (Date.now() - entry.ts > CACHE_TTL) {
    cache.delete(url)
    return null
  }
  return entry.data
}

function cacheSet(url: string, data: LinkPreviewData): void {
  // Evict oldest entries when over capacity (Map preserves insertion order).
  while (cache.size >= CACHE_CAP) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  cache.set(url, { data, ts: Date.now() })
}

// ─── SSRF protection ─────────────────────────────────────────────────────────
// NOTE: This only blocks IP-literal hostnames and obvious local names. DNS
// rebinding (a hostname that resolves to a private IP) is out of scope here.
function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const o = m.slice(1).map(Number)
  if (o.some(n => n > 255)) return true // malformed → treat as unsafe
  const [a, b] = o
  if (a === 127) return true // loopback
  if (a === 10) return true // private
  if (a === 0) return true // "this" network
  if (a === 169 && b === 254) return true // link-local
  if (a === 192 && b === 168) return true // private
  if (a === 172 && b >= 16 && b <= 31) return true // private
  return false
}

function isPrivateIPv6(host: string): boolean {
  // Hostnames from URL parsing may keep brackets; strip them.
  let h = host
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
  h = h.toLowerCase()
  if (h === '::1') return true // loopback
  if (h.startsWith('fe80')) return true // link-local fe80::/10
  // Unique-local fc00::/7 → first byte 0xfc or 0xfd.
  if (h.startsWith('fc') || h.startsWith('fd')) return true
  return false
}

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase()
  if (h === 'localhost') return true
  if (h.endsWith('.local') || h.endsWith('.internal')) return true
  if (isPrivateIPv4(h)) return true
  if (isPrivateIPv6(h)) return true
  return false
}

// ─── Body reading: cap at ~96KB ──────────────────────────────────────────────
const MAX_BYTES = 96 * 1024

async function readLimited(res: Response): Promise<string> {
  const body = res.body
  if (!body) return await res.text()
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        total += value.length
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
  let merged = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    merged.set(c.subarray(0, Math.min(c.length, merged.length - offset)), offset)
    offset += c.length
  }
  return new TextDecoder('utf-8').decode(merged.subarray(0, MAX_BYTES))
}

// ─── Meta parsing (regex-based, no DOM) ──────────────────────────────────────
// Use the SAME entity decoder as the internal preview helper so og:title,
// og:description, site-name and <title> all decode numeric + named entities
// consistently. Trim afterwards (the shared helper does not trim).
function decodeEntities(s: string): string {
  return decodeEntitiesShared(s).trim()
}

// Find a <meta> tag's content where the property/name attr equals `key`.
// Handles both property= and name= forms, and content before or after the key.
function metaContent(html: string, key: string): string | null {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    // <meta property="og:title" content="...">
    new RegExp(
      `<meta[^>]+(?:property|name)\\s*=\\s*["']${esc}["'][^>]*?content\\s*=\\s*["']([^"']*)["']`,
      'i',
    ),
    // <meta content="..." property="og:title">
    new RegExp(
      `<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*?(?:property|name)\\s*=\\s*["']${esc}["']`,
      'i',
    ),
  ]
  for (const re of patterns) {
    const m = re.exec(html)
    if (m && m[1]) return decodeEntities(m[1])
  }
  return null
}

function findTitleTag(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (m && m[1]) return decodeEntities(m[1].replace(/\s+/g, ' '))
  return null
}

function findFavicon(html: string): string | null {
  // Match any <link rel="...icon..."> with an href.
  const linkRe = /<link\b[^>]*>/gi
  let m: RegExpExecArray | null
  const candidates: string[] = []
  while ((m = linkRe.exec(html)) !== null) {
    const tag = m[0]
    const relMatch = /\brel\s*=\s*["']([^"']*)["']/i.exec(tag)
    if (!relMatch) continue
    const rel = relMatch[1].toLowerCase()
    if (
      rel === 'icon' ||
      rel === 'shortcut icon' ||
      rel === 'apple-touch-icon' ||
      rel.includes('icon')
    ) {
      const hrefMatch = /\bhref\s*=\s*["']([^"']*)["']/i.exec(tag)
      if (hrefMatch && hrefMatch[1]) candidates.push(decodeEntities(hrefMatch[1]))
    }
  }
  return candidates[0] ?? null
}

function resolveUrl(href: string | null, base: string): string | null {
  if (!href) return null
  try {
    return new URL(href, base).toString()
  } catch {
    return null
  }
}

function parseMeta(html: string, finalUrl: string): LinkPreviewData {
  const origin = (() => {
    try {
      return new URL(finalUrl).origin
    } catch {
      return finalUrl
    }
  })()

  const title =
    metaContent(html, 'og:title') ??
    metaContent(html, 'twitter:title') ??
    findTitleTag(html)

  const description =
    metaContent(html, 'og:description') ??
    metaContent(html, 'twitter:description') ??
    metaContent(html, 'description')

  const rawImage = metaContent(html, 'og:image') ?? metaContent(html, 'twitter:image')
  const image = resolveUrl(rawImage, finalUrl)

  const themeColor = metaContent(html, 'theme-color')
  const siteName = metaContent(html, 'og:site_name')

  const declaredFavicon = findFavicon(html)
  const favicon =
    resolveUrl(declaredFavicon, finalUrl) ?? `${origin}/favicon.ico`

  return {
    title: title || null,
    description: description || null,
    image,
    favicon,
    themeColor: themeColor || null,
    siteName: siteName || null,
    url: finalUrl,
  }
}

function minimalData(url: string): LinkPreviewData {
  let origin = url
  try {
    origin = new URL(url).origin
  } catch {
    /* keep raw */
  }
  return {
    title: null,
    description: null,
    image: null,
    favicon: origin === url ? null : `${origin}/favicon.ico`,
    themeColor: null,
    siteName: null,
    url,
  }
}

export async function GET(request: NextRequest) {
  // Auth — same pattern as the vault preview route (no vault permission needed).
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const payload = await verifyToken(token)
  if (!payload) return NextResponse.json({ error: 'Token inválido' }, { status: 401 })

  const rawUrl = request.nextUrl.searchParams.get('url') ?? ''

  // Validate URL: must parse, http/https only, non-private host.
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return NextResponse.json({ error: 'URL inválida' }, { status: 400 })
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return NextResponse.json({ error: 'Protocolo não permitido' }, { status: 400 })
  }
  if (isBlockedHost(parsed.hostname)) {
    return NextResponse.json({ error: 'Host não permitido' }, { status: 400 })
  }

  const cacheKey = parsed.toString()
  const cached = cacheGet(cacheKey)
  if (cached) {
    return NextResponse.json(cached, {
      headers: { 'Cache-Control': 'private, max-age=3600' },
    })
  }

  let data: LinkPreviewData
  try {
    const res = await fetch(cacheKey, {
      signal: AbortSignal.timeout(3500),
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VaultViewer/1.0)',
        Accept: 'text/html',
      },
    })

    const finalUrl = res.url || cacheKey
    const contentType = res.headers.get('content-type') ?? ''

    if (!res.ok || !contentType.includes('text/html')) {
      // Non-HTML or error status → minimal data based on the final URL.
      data = minimalData(finalUrl)
    } else {
      const html = await readLimited(res)
      data = parseMeta(html, finalUrl)
    }
  } catch {
    // ANY error (timeout, network, parse) → minimal data, never 500.
    data = minimalData(cacheKey)
  }

  cacheSet(cacheKey, data)

  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'private, max-age=3600' },
  })
}
