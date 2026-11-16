import { NextRequest, NextResponse } from 'next/server'
import { dbGetAllUsers, dbCreateUser, dbGetUserPermissions } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin-guard'
import { validateDisplayName } from '@/lib/display-name'
import type { UserPublic } from '@/types'

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied

  const users = dbGetAllUsers()
  const result: UserPublic[] = users.map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name ?? null,
    isAdmin: Boolean(u.is_admin),
    createdAt: u.created_at,
    vaultSlugs: dbGetUserPermissions(u.id),
  }))
  return NextResponse.json({ users: result })
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const body = await request.json().catch(() => null)
  if (!body?.username || !body?.password) {
    return NextResponse.json({ error: 'username e password são obrigatórios' }, { status: 400 })
  }

  let displayName: string | null = null
  if (body.displayName !== undefined) {
    const checked = validateDisplayName(body.displayName)
    if ('error' in checked) return NextResponse.json({ error: checked.error }, { status: 400 })
    displayName = checked.value
  }

  const passwordHash = await hashPassword(body.password)

  try {
    const user = dbCreateUser(body.username, passwordHash, Boolean(body.isAdmin), displayName)
    const result: UserPublic = {
      id: user.id,
      username: user.username,
      displayName: user.display_name ?? null,
      isAdmin: Boolean(user.is_admin),
      createdAt: user.created_at,
      vaultSlugs: [],
    }
    return NextResponse.json({ user: result }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Username já existe' }, { status: 409 })
  }
}
