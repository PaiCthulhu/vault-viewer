import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'
import { dbUserHasVaultAccess } from '@/lib/db'
import { getVaultBySlug } from '@/lib/vault-config'
import { pageStatus } from '@/lib/pending-page'

// Só lê: informa se a página está pronta, sendo gerada ou inexistente. Nunca dispara build.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const payload = await verifyToken(token)
  if (!payload) return NextResponse.json({ error: 'Token inválido' }, { status: 401 })

  if (!payload.isAdmin && !dbUserHasVaultAccess(payload.userId, slug)) {
    return NextResponse.json({ error: 'Sem acesso' }, { status: 403 })
  }

  const vault = getVaultBySlug(slug)
  if (!vault) return NextResponse.json({ error: 'Vault não encontrado' }, { status: 404 })

  const p = request.nextUrl.searchParams.get('path') ?? ''
  if (!p) return NextResponse.json({ error: 'Path ausente' }, { status: 400 })

  return NextResponse.json({ state: pageStatus(vault, p) }, { headers: { 'Cache-Control': 'no-store' } })
}
