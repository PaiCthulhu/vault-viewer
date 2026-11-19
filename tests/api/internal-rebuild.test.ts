import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const runRebuild = vi.fn(async () => ({ ok: true, output: '' }))
vi.mock('@/lib/rebuild', () => ({ runRebuild: (...a: unknown[]) => runRebuild(...(a as [])) }))

vi.mock('@/lib/vault-config', () => ({
  getVaultBySlug: (slug: string) => (slug === 'inexistente' ? undefined : { slug }),
}))

import { POST } from '@/app/api/internal/rebuild/[slug]/route'

const KEY = 'chave-de-teste'
const call = (headers: Record<string, string> = {}, slug = 'notes') =>
  POST(
    new Request('http://localhost/api/internal/rebuild/' + slug, { method: 'POST', headers }) as never,
    { params: Promise.resolve({ slug }) },
  )

beforeEach(() => {
  runRebuild.mockClear()
  process.env.INTERNAL_REBUILD_KEY = KEY
})
afterEach(() => {
  delete process.env.INTERNAL_REBUILD_KEY
})

describe('POST /api/internal/rebuild/[slug]', () => {
  it.each(['x-forwarded-for', 'cf-connecting-ip', 'forwarded', 'x-real-ip'])(
    '403 com header %s, mesmo com a chave certa',
    async (h) => {
      const res = await call({ 'x-rebuild-key': KEY, [h]: '1.2.3.4' })
      expect(res.status).toBe(403)
      expect(runRebuild).not.toHaveBeenCalled()
    },
  )

  it('x-forwarded-for só com loopback (o que o Next injeta) não conta como proxy', async () => {
    for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect((await call({ 'x-rebuild-key': KEY, 'x-forwarded-for': ip })).status).toBe(202)
    }
  })

  it('403 com x-forwarded-for de IP externo ou lista que o contém', async () => {
    expect((await call({ 'x-rebuild-key': KEY, 'x-forwarded-for': '1.2.3.4' })).status).toBe(403)
    expect((await call({ 'x-rebuild-key': KEY, 'x-forwarded-for': '127.0.0.1, 1.2.3.4' })).status).toBe(403)
  })

  it('403 com Host público, mesmo com a chave certa; Host loopback com porta passa', async () => {
    expect((await call({ 'x-rebuild-key': KEY, host: 'viewer.example.org' })).status).toBe(403)
    expect((await call({ 'x-rebuild-key': KEY, host: '127.0.0.1:3000' })).status).toBe(202)
    expect((await call({ 'x-rebuild-key': KEY, host: 'localhost' })).status).toBe(202)
    expect((await call({ 'x-rebuild-key': KEY, host: '[::1]:3000' })).status).toBe(202)
  })

  it('404 sem INTERNAL_REBUILD_KEY no env', async () => {
    delete process.env.INTERNAL_REBUILD_KEY
    expect((await call({ 'x-rebuild-key': KEY })).status).toBe(404)
  })

  it('401 sem chave, com chave errada e com chave de outro tamanho', async () => {
    expect((await call()).status).toBe(401)
    expect((await call({ 'x-rebuild-key': 'errada' })).status).toBe(401)
    expect((await call({ 'x-rebuild-key': KEY + 'x' })).status).toBe(401)
    expect(runRebuild).not.toHaveBeenCalled()
  })

  it('slug válido mas inexistente → 404, sem rebuild', async () => {
    const res = await call({ 'x-rebuild-key': KEY }, 'inexistente')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Vault não encontrado' })
    expect(runRebuild).not.toHaveBeenCalled()
  })

  it('400 com slug inválido', async () => {
    expect((await call({ 'x-rebuild-key': KEY }, 'a b')).status).toBe(400)
  })

  it('202 com chave certa, sem esperar o build', async () => {
    runRebuild.mockImplementationOnce(() => new Promise(() => {}) as never)
    const res = await call({ 'x-rebuild-key': KEY })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ ok: true })
    expect(runRebuild).toHaveBeenCalledWith('notes')
  })
})
