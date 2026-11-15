import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

// The real runRebuild runs here; only the builder process is fake. Every spawn is
// recorded and stays "running" until finish() closes it.
type FakeChild = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

const calls: { args: string[]; child: FakeChild }[] = []

function fakeSpawn(_cmd: string, args: string[]) {
  const child = new EventEmitter() as FakeChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  calls.push({ args, child })
  return child
}

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return { ...actual, default: { ...actual, spawn: fakeSpawn }, spawn: fakeSpawn }
})

vi.mock('@/lib/vault-config', () => ({
  getVaultBySlug: (slug: string) => (slug === 'inexistente' ? undefined : { slug }),
}))

import { POST } from '@/app/api/internal/rebuild/[slug]/route'
import { REBUILD_TIMEOUT_MS } from '@/lib/rebuild'

const KEY = 'chave-de-teste'

function call(slug: string, query = '', opts: { key?: string; signal?: AbortSignal } = {}) {
  const headers: Record<string, string> = { 'x-rebuild-key': opts.key ?? KEY }
  return POST(
    new Request(`http://localhost/api/internal/rebuild/${slug}${query}`, {
      method: 'POST',
      headers,
      signal: opts.signal,
    }) as never,
    { params: Promise.resolve({ slug }) },
  )
}

function finish(i: number, code: number, stderr = '') {
  if (stderr) calls[i].child.stderr.emit('data', Buffer.from(stderr))
  calls[i].child.emit('close', code)
}

// Tracks whether a promise has settled, without awaiting it.
function track<T>(p: Promise<T>) {
  const t = { settled: false }
  void p.then(() => { t.settled = true }, () => { t.settled = true })
  return t
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  calls.length = 0
  process.env.INTERNAL_REBUILD_KEY = KEY
})
afterEach(() => {
  delete process.env.INTERNAL_REBUILD_KEY
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('POST /api/internal/rebuild/[slug]?wait=1', () => {
  it('só responde depois de o build terminar: 200 { ok: true }', async () => {
    const res = call('w-ok', '?wait=1')
    const t = track(res)
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    await flush()
    expect(t.settled).toBe(false)

    finish(0, 0)
    const r = await res
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
  })

  it('build que falha → 500 { ok: false }, com o output no log e não no corpo', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = call('w-fail', '?wait=1')
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    finish(0, 1, 'Erro em C:/vaults/segredo/nota.md')

    const r = await res
    expect(r.status).toBe(500)
    const body = await r.text()
    expect(JSON.parse(body)).toEqual({ ok: false })
    expect(body).not.toContain('segredo')
    expect(err.mock.calls.flat().join('\n')).toContain('Erro em C:/vaults/segredo/nota.md')
  })

  it('build que estoura o prazo → 500 { ok: false } (não 504)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = call('w-timeout', '?wait=1')
    await vi.waitFor(() => expect(calls).toHaveLength(1))

    await vi.advanceTimersByTimeAsync(REBUILD_TIMEOUT_MS)
    const r = await res
    expect(calls[0].child.kill).toHaveBeenCalled()
    expect(r.status).toBe(500)
    expect(await r.json()).toEqual({ ok: false })
  })

  it('com um build já rodando, espera o build extra, e não o que estava rodando', async () => {
    const running = await call('w-busy') // build de antes do pedido, sem espera
    expect(running.status).toBe(202)
    await vi.waitFor(() => expect(calls).toHaveLength(1))

    const res = call('w-busy', '?wait=1')
    const t = track(res)
    await flush()
    finish(0, 0) // termina o build que já rodava: não cobre o pedido
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    await flush()
    expect(t.settled).toBe(false)

    vi.spyOn(console, 'error').mockImplementation(() => {})
    finish(1, 1, 'falhou o extra')
    const r = await res
    expect(r.status).toBe(500) // é o resultado do extra, não o do primeiro (que deu certo)
    expect(await r.json()).toEqual({ ok: false })
  })

  it('build extra que falha com dois ?wait=1 esperando → uma linha de log só', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await call('w-count')).status).toBe(202) // build de antes dos pedidos, sem espera
    await vi.waitFor(() => expect(calls).toHaveLength(1))

    const a = call('w-count', '?wait=1')
    const b = call('w-count', '?wait=1')
    await flush()
    finish(0, 0)
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    finish(1, 1, 'falhou o extra contado')

    expect((await a).status).toBe(500)
    expect((await b).status).toBe(500)
    await flush()
    // Conta pelo slug, não pelo output: uma linha repetida sem o output também conta.
    const lines = err.mock.calls.map((c) => c.map(String).join(' ')).filter((l) => l.includes('w-count'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('falhou o extra contado')
  })

  it('sem wait, build que falha → uma linha de log só', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await call('w-nowait-fail')).status).toBe(202)
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    finish(0, 1, 'falhou sem espera')
    await flush()
    const lines = err.mock.calls.map((c) => c.map(String).join(' ')).filter((l) => l.includes('w-nowait-fail'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('falhou sem espera')
  })

  it('cliente que desiste não cancela o build, e a rota termina sem erro', async () => {
    const ctrl = new AbortController()
    const res = call('w-abort', '?wait=1', { signal: ctrl.signal })
    await vi.waitFor(() => expect(calls).toHaveLength(1))

    ctrl.abort()
    await flush()
    expect(calls[0].child.kill).not.toHaveBeenCalled()

    finish(0, 0)
    expect((await res).status).toBe(200)

    // A trava do vault foi solta: o pedido seguinte começa outro build na hora.
    const again = await call('w-abort')
    expect(again.status).toBe(202)
    expect(calls).toHaveLength(2)
    finish(1, 0)
  })

  it.each(['', '?wait=0', '?wait=true', '?wait='])(
    'sem wait=1 (%s) → 202 na hora, com o build ainda rodando',
    async (query) => {
      const slug = 'w-none' + query.replace(/\W/g, '')
      const r = await call(slug, query)
      expect(r.status).toBe(202)
      expect(await r.json()).toEqual({ ok: true })
      expect(calls).toHaveLength(1)
      finish(0, 0)
      await flush()
    },
  )

  it('a autenticação vem antes da espera: chave errada → 401, sem build', async () => {
    const r = await call('w-auth', '?wait=1', { key: 'errada' })
    expect(r.status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('vault fora do vaults.config.json com wait=1 → 404, sem build', async () => {
    const r = await call('inexistente', '?wait=1')
    expect(r.status).toBe(404)
    expect(calls).toHaveLength(0)
  })
})
