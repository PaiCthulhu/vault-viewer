import { NextRequest, NextResponse } from 'next/server'
import { dbGetUserById, dbSetUserPermissions } from '@/lib/db'
import { getAllVaultSlugs } from '@/lib/vault-config'
import { requireAdmin } from '@/lib/admin-guard'
import { isVaultLevel } from '@/lib/vault-level'
import type { VaultPermission } from '@/types'

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
  if (!Array.isArray(body?.vaults)) {
    return NextResponse.json({ error: 'vaults deve ser um array' }, { status: 400 })
  }

  // Toda a validação vem antes de qualquer escrita
  const items: VaultPermission[] = []
  const seen = new Set<string>()
  for (const item of body.vaults as unknown[]) {
    if (typeof item !== 'object' || item === null || typeof (item as { slug?: unknown }).slug !== 'string') {
      return NextResponse.json({ error: 'Item inválido em vaults' }, { status: 400 })
    }
    const { slug, level } = item as { slug: string; level?: unknown }
    if (!isVaultLevel(level)) {
      return NextResponse.json({ error: 'Nível inválido (use reader ou editor)' }, { status: 400 })
    }
    if (seen.has(slug)) {
      return NextResponse.json({ error: 'Vault repetido em vaults' }, { status: 400 })
    }
    seen.add(slug)
    items.push({ slug, level })
  }

  // Só aceita slugs que existem na config
  const validSlugs = getAllVaultSlugs()
  const filtered = items.filter((v) => validSlugs.includes(v.slug))

  dbSetUserPermissions(userId, filtered)
  return NextResponse.json({ success: true, vaults: filtered })
}
