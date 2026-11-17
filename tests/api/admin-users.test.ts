import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/admin-guard', () => ({ requireAdmin: vi.fn(async () => null) }))
vi.mock('@/lib/auth', () => ({ hashPassword: vi.fn(async () => 'hash') }))
vi.mock('@/lib/vault-config', () => ({ getAllVaultSlugs: () => ['my-vault', 'test-vault'] }))
vi.mock('@/lib/db', () => ({
  dbGetAllUsers: vi.fn(),
  dbGetUserVaultPermissions: vi.fn(() => []),
  dbSetUserPermissions: vi.fn(),
  dbCreateUser: vi.fn(),
  dbGetUserById: vi.fn(),
  dbUpdateUser: vi.fn(),
  dbDeleteUser: vi.fn(),
}))

import * as db from '@/lib/db'
import { requireAdmin } from '@/lib/admin-guard'
import { NextResponse } from 'next/server'
import { GET, POST } from '@/app/api/admin/users/route'
import { PUT } from '@/app/api/admin/users/[id]/route'
import { PUT as PUT_PERMS } from '@/app/api/admin/users/[id]/permissions/route'

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

  it('GET devolve o nível de cada vault', async () => {
    vi.mocked(db.dbGetAllUsers).mockReturnValue([row()])
    vi.mocked(db.dbGetUserVaultPermissions).mockReturnValue([{ slug: 'my-vault', level: 'editor' }])
    const { users } = await (await GET()).json()
    expect(users[0].vaults).toEqual([{ slug: 'my-vault', level: 'editor' }])
    expect('vaultSlugs' in users[0]).toBe(false)
  })
})

describe('admin/users/[id]/permissions', () => {
  const putPerms = (body: unknown, id = '1') =>
    PUT_PERMS(req(body, 'PUT'), { params: Promise.resolve({ id }) })

  beforeEach(() => {
    vi.mocked(db.dbGetUserById).mockReturnValue(row())
  })

  it('PUT de permissões sem admin devolve a resposta do guard e não grava', async () => {
    const denied = NextResponse.json({ error: 'Proibido' }, { status: 403 })
    vi.mocked(requireAdmin).mockResolvedValueOnce(denied)
    const res = await putPerms({ vaults: [{ slug: 'my-vault', level: 'editor' }] })
    expect(res).toBe(denied)
    expect(db.dbGetUserById).not.toHaveBeenCalled()
    expect(db.dbSetUserPermissions).not.toHaveBeenCalled()
  })

  it('PUT de permissões grava slug e nível', async () => {
    const res = await putPerms({
      vaults: [
        { slug: 'my-vault', level: 'editor' },
        { slug: 'test-vault', level: 'reader', extra: 1 },
      ],
    })
    const expected = [
      { slug: 'my-vault', level: 'editor' },
      { slug: 'test-vault', level: 'reader' },
    ]
    expect(res.status).toBe(200)
    expect(db.dbSetUserPermissions).toHaveBeenCalledWith(1, expected)
    expect(await res.json()).toEqual({ success: true, vaults: expected })
  })

  it('PUT de permissões filtra slug desconhecido', async () => {
    const res = await putPerms({
      vaults: [
        { slug: 'nao-existe', level: 'reader' },
        { slug: 'my-vault', level: 'reader' },
      ],
    })
    const expected = [{ slug: 'my-vault', level: 'reader' }]
    expect(db.dbSetUserPermissions).toHaveBeenCalledWith(1, expected)
    expect(await res.json()).toEqual({ success: true, vaults: expected })
  })

  it('PUT de permissões recusa nível inválido sem gravar', async () => {
    for (const slug of ['my-vault', 'nao-existe']) {
      for (const item of [
        { slug, level: 'Editor' },
        { slug, level: 'admin' },
        { slug },
        { slug, level: null },
      ]) {
        const res = await putPerms({ vaults: [item] })
        expect(res.status, JSON.stringify(item)).toBe(400)
        expect(await res.json()).toEqual({ error: 'Nível inválido (use reader ou editor)' })
      }
    }
    expect(db.dbSetUserPermissions).not.toHaveBeenCalled()
  })

  it('PUT de permissões recusa corpo malformado', async () => {
    const cases: [unknown, string][] = [
      [{ vaultSlugs: ['my-vault'] }, 'vaults deve ser um array'],
      [{}, 'vaults deve ser um array'],
      [5, 'vaults deve ser um array'],
      [{ vaults: 'x' }, 'vaults deve ser um array'],
      [{ vaults: [5] }, 'Item inválido em vaults'],
      [{ vaults: [{ level: 'reader' }] }, 'Item inválido em vaults'],
      [
        { vaults: [{ slug: 'my-vault', level: 'reader' }, { slug: 'my-vault', level: 'editor' }] },
        'Vault repetido em vaults',
      ],
    ]
    for (const [body, error] of cases) {
      const res = await putPerms(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(await res.json()).toEqual({ error })
    }
    expect(db.dbSetUserPermissions).not.toHaveBeenCalled()
  })

  it('PUT de permissões: id inválido 400, usuário inexistente 404', async () => {
    expect((await putPerms({ vaults: [] }, 'abc')).status).toBe(400)
    vi.mocked(db.dbGetUserById).mockReturnValue(undefined)
    expect((await putPerms({ vaults: [] })).status).toBe(404)
    expect(db.dbSetUserPermissions).not.toHaveBeenCalled()
  })
})
