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

  // runRebuild logs a failed build itself, once per build: logging the result here
  // too would repeat it for every request waiting on the same build. It never
  // rejects either; the catches below stay as a guard, so a bug there can't turn
  // into an unhandled rejection or a request that never answers.
  const logError = (err: unknown) => {
    console.error(`[rebuild] "${slug}" erro: ${err instanceof Error ? err.message : 'desconhecido'}`)
  }

  // ?wait=1: answer only when the build that covers this request ends (with a
  // build already running, that is the extra one queued after it). The build
  // output stays in the log. A client that gives up and disconnects cancels
  // nothing: the build runs to the end and its result is dropped.
  if (new URL(request.url).searchParams.get('wait') === '1') {
    try {
      const r = await runRebuild(slug, { wait: true })
      return NextResponse.json({ ok: r.ok }, { status: r.ok ? 200 : 500 })
    } catch (err) {
      logError(err)
      return NextResponse.json({ ok: false }, { status: 500 })
    }
  }

  // Fire and forget: the caller does not wait for the build.
  runRebuild(slug).catch(logError)

  return NextResponse.json({ ok: true }, { status: 202 })
}
