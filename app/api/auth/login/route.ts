import { NextRequest, NextResponse } from 'next/server'
import { dbGetUserByUsername } from '@/lib/db'
import { comparePassword, signToken, COOKIE_NAME, COOKIE_MAX_AGE } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body?.username || !body?.password) {
    return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
  }

  const user = dbGetUserByUsername(body.username)
  // Same error for username and password — don't reveal which is wrong
  if (!user) {
    return NextResponse.json({ error: 'Credenciais inválidas' }, { status: 401 })
  }

  const valid = await comparePassword(body.password, user.password_hash)
  if (!valid) {
    return NextResponse.json({ error: 'Credenciais inválidas' }, { status: 401 })
  }

  const token = await signToken({
    userId: user.id,
    username: user.username,
    isAdmin: Boolean(user.is_admin),
  })

  const response = NextResponse.json({ success: true })
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  })
  return response
}
