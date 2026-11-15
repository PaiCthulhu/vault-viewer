import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import { runRebuild, getBuildState } from '@/lib/rebuild'

type FakeChild = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: () => void
}

// Fake spawn: every call is recorded and stays "running" until finish() is called.
function makeSpawn() {
  const calls: { slug: string; args: string[]; child: FakeChild }[] = []
  let running = 0
  let maxRunning = 0
  const spawnFn = ((_cmd: string, args: string[]) => {
    const child = new EventEmitter() as FakeChild
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => {}
    const slug = args[args.length - 1]
    calls.push({ slug, args, child })
    running++
    maxRunning = Math.max(maxRunning, running)
    return child
  }) as never
  const finish = (i: number, code = 0) => {
    running--
    calls[i].child.emit('close', code)
  }
  return { spawnFn, calls, finish, maxRunning: () => maxRunning }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('runRebuild', () => {
  it('dois pedidos simultâneos → 2 spawns em sequência, nunca em paralelo', async () => {
    const s = makeSpawn()
    const a = runRebuild('notes', { spawnFn: s.spawnFn })
    const b = runRebuild('notes', { spawnFn: s.spawnFn })
    expect(await b).toMatchObject({ ok: true, coalesced: true })
    expect(s.calls).toHaveLength(1)
    s.finish(0)
    expect(await a).toMatchObject({ ok: true })
    await tick()
    expect(s.calls).toHaveLength(2)
    s.finish(1)
    await tick()
    expect(s.maxRunning()).toBe(1)
  })

  it('cinco pedidos durante um build → só 1 build extra', async () => {
    const s = makeSpawn()
    const first = runRebuild('notes', { spawnFn: s.spawnFn })
    for (let i = 0; i < 5; i++) {
      expect(await runRebuild('notes', { spawnFn: s.spawnFn })).toMatchObject({ coalesced: true })
    }
    s.finish(0)
    await first
    await tick()
    s.finish(1)
    await tick()
    expect(s.calls).toHaveLength(2)
  })

  it('vaults diferentes não se travam', async () => {
    const s = makeSpawn()
    const a = runRebuild('um', { spawnFn: s.spawnFn })
    const b = runRebuild('dois', { spawnFn: s.spawnFn })
    expect(s.calls.map((c) => c.slug)).toEqual(['um', 'dois'])
    s.finish(0)
    s.finish(1)
    expect(await a).toMatchObject({ ok: true })
    expect(await b).toMatchObject({ ok: true })
  })

  it('pedido coalescido com wait resolve com o resultado do build extra (sucesso)', async () => {
    const s = makeSpawn()
    const first = runRebuild('w', { spawnFn: s.spawnFn })
    const waiter = runRebuild('w', { spawnFn: s.spawnFn, wait: true })
    const waiter2 = runRebuild('w', { spawnFn: s.spawnFn, wait: true })
    let done = false
    void waiter.then(() => { done = true })
    s.finish(0)
    await first
    await tick()
    expect(done).toBe(false) // o primeiro build não cobre o pedido dele
    expect(s.calls).toHaveLength(2)
    s.finish(1)
    const r = await waiter
    expect(r).toMatchObject({ ok: true })
    expect(r.coalesced).toBeUndefined()
    expect(await waiter2).toMatchObject({ ok: true })
  })

  it('pedido coalescido com wait resolve com o resultado do build extra (falha)', async () => {
    const s = makeSpawn()
    const first = runRebuild('wf', { spawnFn: s.spawnFn })
    const waiter = runRebuild('wf', { spawnFn: s.spawnFn, wait: true })
    s.finish(0)
    expect(await first).toMatchObject({ ok: true })
    await tick()
    s.finish(1, 1)
    expect(await waiter).toMatchObject({ ok: false })
  })

  it('falha do build volta ok:false e libera a trava', async () => {
    const s = makeSpawn()
    const a = runRebuild('x', { spawnFn: s.spawnFn })
    s.finish(0, 1)
    expect(await a).toMatchObject({ ok: false })
    const b = runRebuild('x', { spawnFn: s.spawnFn })
    expect(s.calls).toHaveLength(2)
    s.finish(1)
    expect(await b).toMatchObject({ ok: true })
  })

  it('passa cada caminho de first como argumento próprio do spawn', async () => {
    const s = makeSpawn()
    const a = runRebuild('f1', { spawnFn: s.spawnFn, first: ['Jogos/A b', 'X'] })
    expect(s.calls[0].args.slice(-6)).toEqual(['--first', 'Jogos/A b', '--first', 'X', '--vault', 'f1'])
    s.finish(0)
    await a
  })

  it('first dos pedidos juntados vai para o build extra, sem repetir', async () => {
    const s = makeSpawn()
    const a = runRebuild('f2', { spawnFn: s.spawnFn })
    await runRebuild('f2', { spawnFn: s.spawnFn, first: ['A'] })
    await runRebuild('f2', { spawnFn: s.spawnFn, first: ['B', 'A'] })
    expect(getBuildState('f2')).toMatchObject({ queued: true, first: ['A', 'B'] })
    s.finish(0)
    await a
    await tick()
    const args = s.calls[1].args
    expect(args.join('|')).toContain('--first|A|--first|B')
    expect(getBuildState('f2').first).toEqual([])
    s.finish(1)
    await tick()
  })

  it('getBuildState: running durante o build e lastAttemptStartedAt depois, mesmo com falha', async () => {
    const s = makeSpawn()
    expect(getBuildState('st')).toEqual({ running: null, queued: false, first: [], lastAttemptStartedAt: null })
    const before = Date.now()
    const a = runRebuild('st', { spawnFn: s.spawnFn })
    const during = getBuildState('st').running
    expect(during).not.toBeNull()
    expect(during!.startedAt).toBeGreaterThanOrEqual(before)
    s.finish(0, 1)
    await a
    await tick()
    const after = getBuildState('st')
    expect(after.running).toBeNull()
    expect(after.lastAttemptStartedAt).toBe(during!.startedAt)
  })

  it('duas cópias isoladas do módulo veem o mesmo estado', async () => {
    const s = makeSpawn()
    vi.resetModules()
    const m1 = await import('@/lib/rebuild')
    vi.resetModules()
    const m2 = await import('@/lib/rebuild')
    expect(m1).not.toBe(m2)
    const a = m1.runRebuild('g', { spawnFn: s.spawnFn })
    expect(m2.getBuildState('g').running).not.toBeNull()
    expect(await m2.runRebuild('g', { spawnFn: s.spawnFn })).toMatchObject({ coalesced: true })
    expect(s.calls).toHaveLength(1)
    s.finish(0)
    await a
    await tick()
    s.finish(1)
    await tick()
  })
})
