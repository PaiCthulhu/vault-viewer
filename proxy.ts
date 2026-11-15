import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'
import { dbUserHasVaultAccess } from '@/lib/db'
import { classifyPath, assetAccessStatus } from '@/lib/asset-guard'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Checked against the path the static file server will actually resolve
  // (decoded, case-folded) — see lib/asset-guard.ts.
  const kind = classifyPath(pathname)
  if (kind.kind === 'invalid') return new NextResponse(null, { status: 400 })

  // Imagens dos vaults (/vault-assets/<slug>/…, servidas pela rota em
  // app/vault-assets): exige sessão, e leitor só vê imagens de vaults que pode
  // abrir. O proxy barra antes e a rota confere de novo, então ele não é mais a
  // única trava.
  if (kind.kind === 'asset') {
    const token = request.cookies.get(COOKIE_NAME)?.value
    const payload = token ? await verifyToken(token) : null
    const status = assetAccessStatus(kind.slug, payload, dbUserHasVaultAccess)
    if (status !== 200) return new NextResponse(null, { status })
    return NextResponse.next()
  }

  // Internal service-to-service routes: no session. The route itself checks the
  // shared key and refuses anything that arrived through a proxy/tunnel.
  if (pathname.startsWith('/api/internal/')) return NextResponse.next()

  // Admin API routes require isAdmin
  if (pathname.startsWith('/api/admin')) {
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    const payload = await verifyToken(token)
    if (!payload) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    if (!payload.isAdmin) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    return NextResponse.next()
  }

  // Authenticated API routes (non-admin)
  if (pathname.startsWith('/api/vaults') || pathname.startsWith('/api/auth/me')) {
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    const payload = await verifyToken(token)
    if (!payload) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    return NextResponse.next()
  }

  // Protected app pages
  if (!pathname.startsWith('/login') && !pathname.startsWith('/api/auth/login')) {
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) return NextResponse.redirect(new URL('/login', request.url))
    const payload = await verifyToken(token)
    if (!payload) return NextResponse.redirect(new URL('/login', request.url))

    // Only admin can access /admin
    if (pathname.startsWith('/admin') && !payload.isAdmin) {
      return NextResponse.redirect(new URL('/', request.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  // Tudo, menos os bundles do framework e o favicon. Imagens e `vault-assets`
  // NÃO podem ser excluídos: excluir por extensão ou por `vault-assets` serviu
  // as imagens de todos os vaults sem sessão (hoje a rota também confere).
  matcher: ['/((?!_next/static|favicon.ico).*)'],
}
