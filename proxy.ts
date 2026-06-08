import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

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
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|vault-assets|.*\\.png|.*\\.jpg|.*\\.jpeg|.*\\.webp|.*\\.svg|.*\\.gif).*)',
  ],
}
