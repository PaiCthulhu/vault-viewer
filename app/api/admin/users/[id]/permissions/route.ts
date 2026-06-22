import { NextRequest, NextResponse } from 'next/server'
import { dbGetUserById, dbSetUserPermissions } from '@/lib/db'
import { getAllVaultSlugs } from '@/lib/vault-config'
import { requireAdmin } from '@/lib/admin-guard'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  const userId = parseInt(id, 10)
  if (isNaN(userId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const user = dbGetUserById(userId)
  if (!user) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  const body = await request.json().catch(() => null)
  if (!Array.isArray(body?.vaultSlugs)) {
    return NextResponse.json({ error: 'vaultSlugs deve ser um array' }, { status: 400 })
  }

  // Only accept slugs that exist in config
  const validSlugs = getAllVaultSlugs()
  const filtered = (body.vaultSlugs as string[]).filter((s) => validSlugs.includes(s))

  dbSetUserPermissions(userId, filtered)
  return NextResponse.json({ success: true, vaultSlugs: filtered })
}
