import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

let mockToken: string | undefined
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (mockToken !== undefined ? { name, value: mockToken } : undefined),
  }),
}))
vi.mock('@/lib/auth', () => ({
  COOKIE_NAME: 'vault_session',
  verifyToken: async (t: string) => {
    if (t === 'admin') return { userId: 1, username: 'a', isAdmin: true }
    if (t === 'leitor') return { userId: 2, username: 'l', isAdmin: false }
    if (t === 'outro') return { userId: 3, username: 'o', isAdmin: false }
    return null
  },
}))
vi.mock('@/lib/db', () => ({ dbUserHasVaultAccess: (userId: number) => userId === 2 }))
vi.mock('@/lib/vault-config', () => ({
  getVaultBySlug: (slug: string) => (slug === 'v' ? { slug: 'v', path: 'x' } : undefined),
}))
const pageStatus = vi.fn()
vi.mock('@/lib/pending-page', () => ({ pageStatus: (...a: unknown[]) => pageStatus(...a) }))

import { GET } from '@/app/api/vault/[slug]/page-status/route'

function call(slug: string, qs = '?path=Jogos/Nova') {
  const req = new NextRequest(`http://localhost/api/vault/${slug}/page-status${qs}`)
  return GET(req, { params: Promise.resolve({ slug }) })
}

beforeEach(() => {
  mockToken = 'admin'
  pageStatus.mockReset()
  pageStatus.mockReturnValue('pending')
})

describe('GET page-status', () => {
  it('401 sem token', async () => {
    mockToken = undefined
    expect((await call('v')).status).toBe(401)
  })
  it('401 com token inválido', async () => {
    mockToken = 'lixo'
    expect((await call('v')).status).toBe(401)
  })
  it('403 sem acesso ao vault', async () => {
    mockToken = 'outro'
    expect((await call('v')).status).toBe(403)
  })
  it('404 para vault desconhecido', async () => {
    expect((await call('zzz')).status).toBe(404)
  })
  it('400 sem path', async () => {
    expect((await call('v', '')).status).toBe(400)
  })
  it('200 com state e no-store', async () => {
    mockToken = 'leitor'
    const res = await call('v')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ state: 'pending' })
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(pageStatus).toHaveBeenCalledWith({ slug: 'v', path: 'x' }, 'Jogos/Nova')
  })
})
