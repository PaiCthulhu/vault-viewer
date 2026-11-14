import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'
import { runRebuild } from '@/lib/rebuild'
import { getVaultBySlug } from '@/lib/vault-config'

// Internal rebuild trigger, called by the external sync service after it writes a
// note. proxy.ts lets /api/internal/ through without a session, so this route
// authenticates itself: shared key, and never through the public tunnel.

// A request that came through a reverse proxy / tunnel carries one of these.
const FORWARD_HEADERS = ['cf-connecting-ip', 'forwarded', 'x-real-ip']

// Next itself fills x-forwarded-for with the socket address when it is absent
// (base-server.js), so a direct local call always has it, holding a loopback IP.
// A proxy (Caddy, tunnel) sets the real client IP there: anything non-loopback
// means the request did not come straight from this machine.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

function viaProxy(request: NextRequest): boolean {
  if (FORWARD_HEADERS.some((h) => request.headers.has(h))) return true
  const xff = request.headers.get('x-forwarded-for')
  if (!xff) return false
  return !xff.split(',').every((ip) => LOOPBACK.has(ip.trim()))
}

// Caddy forwards the public Host by default; the service calls loopback directly.
// Next's x-forwarded-for cannot tell a local client from one coming via the proxy
// (both are loopback), but Host can.
function loopbackHost(request: NextRequest): boolean {
  const host = (request.headers.get('host') ?? new URL(request.url).host).toLowerCase()
  return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)
}

function sameKey(given: string, expected: string): boolean {
  // Digests have equal length, so timingSafeEqual cannot throw on a size mismatch.
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (viaProxy(request) || !loopbackHost(request)) {
    return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  }

  const expected = process.env.INTERNAL_REBUILD_KEY
  if (!expected) return new NextResponse(null, { status: 404 })

  const given = request.headers.get('x-rebuild-key') ?? ''
  if (!given || !sameKey(given, expected)) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  const { slug } = await params
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
    return NextResponse.json({ error: 'Slug inválido' }, { status: 400 })
  }

  if (!getVaultBySlug(slug)) {
    return NextResponse.json({ error: 'Vault não encontrado' }, { status: 404 })
  }

  // Fire and forget: the caller must not wait for the build.
  runRebuild(slug)
    .then((r) => {
      if (!r.ok) console.error(`[rebuild] "${slug}" falhou: ${r.output}`)
    })
    .catch((err) => {
      console.error(`[rebuild] "${slug}" erro: ${err instanceof Error ? err.message : 'desconhecido'}`)
    })

  return NextResponse.json({ ok: true }, { status: 202 })
}
