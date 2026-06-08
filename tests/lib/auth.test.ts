import { describe, it, expect, beforeAll } from 'vitest'
import { signToken, verifyToken, hashPassword, comparePassword } from '@/lib/auth'

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-32-chars-long-for-vitest-ok'
})

describe('JWT', () => {
  it('assina e verifica token válido', async () => {
    const payload = { userId: 1, username: 'will', isAdmin: true }
    const token = await signToken(payload)
    const result = await verifyToken(token)
    expect(result).toMatchObject(payload)
  })

  it('retorna null para token inválido', async () => {
    const result = await verifyToken('token.invalido.qualquer')
    expect(result).toBeNull()
  })

  it('retorna null para token adulterado', async () => {
    const token = await signToken({ userId: 1, username: 'will', isAdmin: false })
    const [header, , sig] = token.split('.')
    const fakePayload = btoa(JSON.stringify({ userId: 1, username: 'will', isAdmin: true }))
    const result = await verifyToken(`${header}.${fakePayload}.${sig}`)
    expect(result).toBeNull()
  })
})

describe('Password', () => {
  it('hash e compare correto', async () => {
    const hash = await hashPassword('minhasenha')
    expect(await comparePassword('minhasenha', hash)).toBe(true)
    expect(await comparePassword('senhaerrada', hash)).toBe(false)
  })

  it('dois hashes da mesma senha são diferentes (salt)', async () => {
    const h1 = await hashPassword('abc')
    const h2 = await hashPassword('abc')
    expect(h1).not.toBe(h2)
  })
})
