import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { runRebuild, getBuildState, type RebuildResult } from '@/lib/rebuild'

type FakeChild = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: () => void
}

// Fake spawn: every call is recorded and stays "running" until finish() is called.
// `throwOn[i]`: call i returns a child whose stdout.on throws that value. The throw happens
// inside buildOnce's Promise executor, after the spawn try, so that build rejects.
// `onSpawn(i)` runs during call i, before it returns: a request arriving while that build runs.
function makeSpawn(opts: { throwOn?: Record<number, unknown>; onSpawn?: (i: number) => void } = {}) {
  const calls: { slug: string; args: string[]; child: FakeChild }[] = []
  let running = 0
  let maxRunning = 0
  const spawnFn = ((_cmd: string, args: string[]) => {
    const i = calls.length
    const child = new EventEmitter() as FakeChild
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => {}
    const slug = args[args.length - 1]
    calls.push({ slug, args, child })
    opts.onSpawn?.(i)
    if (opts.throwOn && i in opts.throwOn) {
      const thrown = opts.throwOn[i]
      child.stdout.on = () => { throw thrown }
      return child
    }
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

  describe('build que lança erro conta como build que falhou', () => {
    afterEach(() => { vi.restoreAllMocks() })

    it('no primeiro build: resolve ok:false, solta a trava e o pedido seguinte builda na hora', async () => {
      const s = makeSpawn({ throwOn: { 0: new Error('stdout quebrado') } })
      const before = Date.now()
      expect(await runRebuild('rj1', { spawnFn: s.spawnFn })).toEqual({ ok: false, output: 'stdout quebrado' })
      const st = getBuildState('rj1')
      expect(st.running).toBeNull()
      expect(st.lastAttemptStartedAt).toBeGreaterThanOrEqual(before)
      const b = runRebuild('rj1', { spawnFn: s.spawnFn })
      expect(s.calls).toHaveLength(2)
      s.finish(1)
      expect(await b).toEqual({ ok: true, output: '' })
    })

    it('no primeiro build: o pedido que chegou durante ele ganha o build extra, com o first dele', async () => {
      let late: Promise<RebuildResult> | undefined
      const s = makeSpawn({
        throwOn: { 0: new Error('stdout quebrado') },
        onSpawn: (i) => {
          if (i === 0) late = runRebuild('rj4', { spawnFn: s.spawnFn, wait: true, first: ['Nova'] })
        },
      })
      expect(await runRebuild('rj4', { spawnFn: s.spawnFn })).toEqual({ ok: false, output: 'stdout quebrado' })
      await tick()
      expect(s.calls).toHaveLength(2)
      expect(s.calls[1].args.join('|')).toContain('--first|Nova')
      s.finish(1)
      expect(await late).toEqual({ ok: true, output: '' })
    })

    it('num build extra: quem esperava recebe ok:false e o pedido que chegou durante ele ganha o build dele', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      // Relógio que anda 1 s por leitura: sem ele os builds 0 e 1 começam no mesmo ms.
      let clock = 1_000_000
      vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1000))
      let late: Promise<RebuildResult> | undefined
      let extraStartedAt: number | undefined
      const s = makeSpawn({
        throwOn: { 1: new Error('stdout quebrado') },
        onSpawn: (i) => {
          if (i !== 1) return
          extraStartedAt = getBuildState('rj2').running!.startedAt
          late = runRebuild('rj2', { spawnFn: s.spawnFn, wait: true, first: ['Nova'] })
        },
      })
      const a = runRebuild('rj2', { spawnFn: s.spawnFn })
      const waiter = runRebuild('rj2', { spawnFn: s.spawnFn, wait: true })
      s.finish(0)
      expect(await a).toEqual({ ok: true, output: '' })
      expect(await waiter).toEqual({ ok: false, output: 'stdout quebrado' })
      // O build 2 já começou mas não terminou: o último que terminou é o que lançou erro.
      expect(getBuildState('rj2').lastAttemptStartedAt).toBe(extraStartedAt)
      await tick()
      expect(s.calls).toHaveLength(3)
      expect(s.calls[2].args.join('|')).toContain('--first|Nova')
      s.finish(2)
      expect(await late).toEqual({ ok: true, output: '' })
      await tick()
      const st = getBuildState('rj2')
      expect(st.running).toBeNull()
      expect(st.queued).toBe(false)
    })

    it('erro longo guarda só o fim no output, como o spawn que falha', async () => {
      const s = makeSpawn({ throwOn: { 0: new Error('a'.repeat(700) + 'FIM') } })
      expect(await runRebuild('rj5', { spawnFn: s.spawnFn })).toEqual({ ok: false, output: 'a'.repeat(597) + 'FIM' })
    })

    it('valor lançado que não é Error vira texto, e um que nem vira texto ainda dá ok:false', async () => {
      const s = makeSpawn({ throwOn: { 0: 'texto solto', 1: Object.create(null) } })
      expect(await runRebuild('rj3', { spawnFn: s.spawnFn })).toEqual({ ok: false, output: 'texto solto' })
      const r = await runRebuild('rj3', { spawnFn: s.spawnFn })
      expect(r.ok).toBe(false)
      expect(typeof r.output).toBe('string')
      expect(getBuildState('rj3').running).toBeNull()
    })
  })
})
