import { NextRequest, NextResponse } from 'next/server'
import { dbGetUserById, dbUpdateUser, dbDeleteUser } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
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

  const body = await request.json().catch(() => ({}))
  const fields: { username?: string; passwordHash?: string } = {}

  if (body.username) fields.username = body.username
  if (body.password) fields.passwordHash = await hashPassword(body.password)

  dbUpdateUser(userId, fields)
  return NextResponse.json({ success: true })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  const userId = parseInt(id, 10)
  if (isNaN(userId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const user = dbGetUserById(userId)
  if (!user) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
  if (user.is_admin) return NextResponse.json({ error: 'Não é possível deletar o admin' }, { status: 403 })

  dbDeleteUser(userId)
  return NextResponse.json({ success: true })
}
