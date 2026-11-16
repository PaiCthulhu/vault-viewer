import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/admin-guard', () => ({ requireAdmin: vi.fn(async () => null) }))
vi.mock('@/lib/auth', () => ({ hashPassword: vi.fn(async () => 'hash') }))
vi.mock('@/lib/db', () => ({
  dbGetAllUsers: vi.fn(),
  dbGetUserPermissions: vi.fn(() => []),
  dbCreateUser: vi.fn(),
  dbGetUserById: vi.fn(),
  dbUpdateUser: vi.fn(),
  dbDeleteUser: vi.fn(),
}))

import * as db from '@/lib/db'
import { GET, POST } from '@/app/api/admin/users/route'
import { PUT } from '@/app/api/admin/users/[id]/route'

function req(body: unknown, method = 'POST'): NextRequest {
  return new NextRequest('http://test.local/api/admin/users', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const row = (extra: object = {}) => ({
  id: 1,
  username: 'ana',
  password_hash: 'h',
  is_admin: 0,
  created_at: '2026-01-01',
  display_name: null,
  ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('admin/users', () => {
  it('GET inclui displayName', async () => {
    vi.mocked(db.dbGetAllUsers).mockReturnValue([
      row({ display_name: 'Ana Souza' }),
      row({ id: 2, username: 'bob' }),
    ])
    const res = await GET()
    const { users } = await res.json()
    expect(users[0].displayName).toBe('Ana Souza')
    expect(users[1].displayName).toBeNull()
  })

  it('POST aceita displayName e recusa inválido', async () => {
    vi.mocked(db.dbCreateUser).mockReturnValue(row({ display_name: 'Ana' }))
    const ok = await POST(req({ username: 'ana', password: 'x', displayName: 'Ana' }))
    expect(ok.status).toBe(201)
    expect(db.dbCreateUser).toHaveBeenCalledWith('ana', 'hash', false, 'Ana')
    expect((await ok.json()).user.displayName).toBe('Ana')

    vi.mocked(db.dbCreateUser).mockClear()
    const bad = await POST(req({ username: 'ana', password: 'x', displayName: 'a'.repeat(81) }))
    expect(bad.status).toBe(400)
    expect(db.dbCreateUser).not.toHaveBeenCalled()
  })

  it('PUT grava, limpa e recusa displayName', async () => {
    vi.mocked(db.dbGetUserById).mockReturnValue(row())
    const put = (body: unknown) =>
      PUT(req(body, 'PUT'), { params: Promise.resolve({ id: '1' }) })

    expect((await put({ displayName: 'Ana' })).status).toBe(200)
    expect(db.dbUpdateUser).toHaveBeenLastCalledWith(1, { displayName: 'Ana' })

    expect((await put({ displayName: '' })).status).toBe(200)
    expect(db.dbUpdateUser).toHaveBeenLastCalledWith(1, { displayName: null })

    expect((await put({ username: 'x' })).status).toBe(200)
    const fields = vi.mocked(db.dbUpdateUser).mock.lastCall![1]
    expect(fields).toEqual({ username: 'x' })
    expect('displayName' in fields).toBe(false)

    vi.mocked(db.dbUpdateUser).mockClear()
    expect((await put({ displayName: 5 })).status).toBe(400)
    expect(db.dbUpdateUser).not.toHaveBeenCalled()
  })

  it('PUT com corpo que não é objeto responde 400 sem mexer no usuário', async () => {
    vi.mocked(db.dbGetUserById).mockReturnValue(row())
    for (const body of [5, 'x', true]) {
      const res = await PUT(req(body, 'PUT'), { params: Promise.resolve({ id: '1' }) })
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(await res.json()).toEqual({ error: 'Corpo inválido' })
    }
    expect(db.dbUpdateUser).not.toHaveBeenCalled()
  })

  it('PUT com JSON inválido ou null continua como corpo vazio', async () => {
    vi.mocked(db.dbGetUserById).mockReturnValue(row())
    const invalido = new NextRequest('http://test.local/api/admin/users/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{nao é json',
    })
    expect((await PUT(invalido, { params: Promise.resolve({ id: '1' }) })).status).toBe(200)
    expect(db.dbUpdateUser).toHaveBeenLastCalledWith(1, {})
    expect((await PUT(req(null, 'PUT'), { params: Promise.resolve({ id: '1' }) })).status).toBe(200)
    expect(db.dbUpdateUser).toHaveBeenLastCalledWith(1, {})
  })
})
