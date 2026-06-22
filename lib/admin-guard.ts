import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'

/**
 * Defense-in-depth admin guard for route handlers.
 *
 * `proxy.ts` already blocks `/api/admin/*` for non-admins, but route handlers
 * must not rely solely on it — Next.js recommends authorizing close to the data,
 * so a future change to the proxy matcher (or a middleware bypass) can't silently
 * expose these endpoints.
 *
 * Returns a 401/403 `NextResponse` to short-circuit the handler, or `null` when
 * the caller is an authenticated admin and the handler may proceed:
 *
 *     const denied = await requireAdmin()
 *     if (denied) return denied
 */
export async function requireAdmin(): Promise<NextResponse | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  const payload = token ? await verifyToken(token) : null
  if (!payload) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!payload.isAdmin) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  return null
}
