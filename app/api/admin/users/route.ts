import { NextRequest, NextResponse } from 'next/server'
import { dbGetAllUsers, dbCreateUser, dbGetUserPermissions } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import type { UserPublic } from '@/types'

export async function GET() {
  const users = dbGetAllUsers()
  const result: UserPublic[] = users.map((u) => ({
    id: u.id,
    username: u.username,
    isAdmin: Boolean(u.is_admin),
    createdAt: u.created_at,
    vaultSlugs: dbGetUserPermissions(u.id),
  }))
  return NextResponse.json({ users: result })
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body?.username || !body?.password) {
    return NextResponse.json({ error: 'username e password são obrigatórios' }, { status: 400 })
  }

  const passwordHash = await hashPassword(body.password)

  try {
    const user = dbCreateUser(body.username, passwordHash, Boolean(body.isAdmin))
    const result: UserPublic = {
      id: user.id,
      username: user.username,
      isAdmin: Boolean(user.is_admin),
      createdAt: user.created_at,
      vaultSlugs: [],
    }
    return NextResponse.json({ user: result }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Username já existe' }, { status: 409 })
  }
}
