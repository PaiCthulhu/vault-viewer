import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'events'
import { runRebuild } from '@/lib/rebuild'

type FakeChild = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: () => void
}

// Fake spawn: every call is recorded and stays "running" until finish() is called.
function makeSpawn() {
  const calls: { slug: string; child: FakeChild }[] = []
  let running = 0
  let maxRunning = 0
  const spawnFn = ((_cmd: string, args: string[]) => {
    const child = new EventEmitter() as FakeChild
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => {}
    const slug = args[args.length - 1]
    calls.push({ slug, child })
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
})
