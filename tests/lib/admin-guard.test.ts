import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'

// Mutable cookie value driven by each test. The proxy normally sets/clears this
// via the request; here we drive it directly to exercise requireAdmin in isolation.
let mockToken: string | undefined

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      mockToken !== undefined ? { name, value: mockToken } : undefined,
  }),
}))

import { signToken } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin-guard'

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-32-chars-long-for-vitest-ok'
})

beforeEach(() => {
  mockToken = undefined
})

describe('requireAdmin', () => {
  it('401 quando não há cookie de sessão', async () => {
    const res = await requireAdmin()
    expect(res?.status).toBe(401)
  })

  it('401 para token inválido/adulterado', async () => {
    mockToken = 'lixo.invalido.token'
    const res = await requireAdmin()
    expect(res?.status).toBe(401)
  })

  it('403 para usuário autenticado não-admin', async () => {
    mockToken = await signToken({ userId: 2, username: 'reader', isAdmin: false })
    const res = await requireAdmin()
    expect(res?.status).toBe(403)
  })

  it('null (libera) para admin', async () => {
    mockToken = await signToken({ userId: 1, username: 'will', isAdmin: true })
    const res = await requireAdmin()
    expect(res).toBeNull()
  })
})
