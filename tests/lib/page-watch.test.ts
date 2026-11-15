import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createPageWatcher,
  type PageWatcher,
  type WatchStatus,
} from '@/lib/page-watch'

const S = (v: string | null, b = false): WatchStatus => ({ version: v, building: b })

let visible: boolean
let busy: boolean
let refresh: ReturnType<typeof vi.fn>
let fetchStatus: ReturnType<typeof vi.fn>
let watcher: PageWatcher

function make(queue: Array<WatchStatus | null>, initial = 'v1') {
  let i = 0
  fetchStatus = vi.fn(async () => queue[Math.min(i++, queue.length - 1)])
  return build(initial)
}

function build(initial = 'v1') {
  watcher = createPageWatcher(initial, {
    fetchStatus: fetchStatus as () => Promise<WatchStatus | null>,
    refresh: refresh as () => void,
    isVisible: () => visible,
    isBusy: () => busy,
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  })
  return watcher
}

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms)

beforeEach(() => {
  vi.useFakeTimers()
  visible = true
  busy = false
  refresh = vi.fn()
})

afterEach(() => {
  watcher?.stop()
  vi.useRealTimers()
})

describe('createPageWatcher', () => {
  it('consulta ao montar e depois a cada 60 s', async () => {
    make([S('v1')]).start()
    await advance(0)
    expect(fetchStatus).toHaveBeenCalledTimes(1)
    await advance(59_999)
    expect(fetchStatus).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(fetchStatus).toHaveBeenCalledTimes(2)
  })

  it('aba oculta não consulta', async () => {
    visible = false
    make([S('v1')]).start()
    await advance(120_000)
    expect(fetchStatus).toHaveBeenCalledTimes(0)
  })

  it('voltar para a aba consulta na hora e depois em rampa: 500 ms, 1 s, 1,5 s e 2 s até os 20 s', async () => {
    visible = false
    make([S('v1')]).start()
    visible = true
    watcher.becameVisible()
    await advance(0)
    expect(fetchStatus).toHaveBeenCalledTimes(1) // t = 0
    await advance(499)
    expect(fetchStatus).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(fetchStatus).toHaveBeenCalledTimes(2) // t = 0,5 s
    await advance(999)
    expect(fetchStatus).toHaveBeenCalledTimes(2)
    await advance(1)
    expect(fetchStatus).toHaveBeenCalledTimes(3) // t = 1,5 s
    await advance(1_499)
    expect(fetchStatus).toHaveBeenCalledTimes(3)
    await advance(1)
    expect(fetchStatus).toHaveBeenCalledTimes(4) // t = 3 s
    await advance(1_999)
    expect(fetchStatus).toHaveBeenCalledTimes(4)
    await advance(1)
    expect(fetchStatus).toHaveBeenCalledTimes(5) // t = 5 s
    await advance(14_000)
    expect(fetchStatus).toHaveBeenCalledTimes(12) // 7, 9, …, 19 s
    await advance(2_000)
    expect(fetchStatus).toHaveBeenCalledTimes(13) // 21 s: agendada ainda dentro da janela
    await advance(59_999)
    expect(fetchStatus).toHaveBeenCalledTimes(13)
    await advance(1)
    expect(fetchStatus).toHaveBeenCalledTimes(14) // fora da janela: 60 s
  })

  it('cada volta para a aba recomeça a rampa', async () => {
    visible = false
    make([S('v1')]).start()
    visible = true
    watcher.becameVisible()
    await advance(5_000) // t = 0; 0,5; 1,5; 3; 5 s
    expect(fetchStatus).toHaveBeenCalledTimes(5)
    watcher.becameHidden()
    visible = false
    await advance(10_000)
    visible = true
    watcher.becameVisible()
    await advance(0)
    expect(fetchStatus).toHaveBeenCalledTimes(6)
    await advance(500)
    expect(fetchStatus).toHaveBeenCalledTimes(7)
    await advance(1_000)
    expect(fetchStatus).toHaveBeenCalledTimes(8)
  })

  it('visibilitychange e focus juntos contam como uma consulta', async () => {
    visible = false
    make([S('v1')]).start()
    visible = true
    watcher.becameVisible()
    watcher.becameVisible()
    await advance(0)
    expect(fetchStatus).toHaveBeenCalledTimes(1)
  })

  it('troca rápida de aba não deixa o vigia sem timer', async () => {
    make([S('v1')]).start()
    await advance(0)
    watcher.becameHidden()
    visible = false
    await advance(500)
    visible = true
    watcher.becameVisible()
    expect(fetchStatus).toHaveBeenCalledTimes(1)
    await advance(499)
    expect(fetchStatus).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(fetchStatus).toHaveBeenCalledTimes(2)
    await advance(60_000)
    expect(fetchStatus.mock.calls.length).toBeGreaterThan(2)
  })

  it('dedupe não consulta na hora, mas segue a rampa', async () => {
    make([S('v1')]).start()
    await advance(0)
    watcher.becameVisible()
    expect(fetchStatus).toHaveBeenCalledTimes(1)
    await advance(500)
    expect(fetchStatus).toHaveBeenCalledTimes(2)
    await advance(1_000)
    expect(fetchStatus).toHaveBeenCalledTimes(3)
  })

  it('falha não dispara refresh adiado; o próximo sucesso dispara', async () => {
    busy = true
    make([S('v2'), null, S('v2')]).start()
    await advance(0)
    expect(refresh).not.toHaveBeenCalled()
    busy = false
    await advance(2_000)
    expect(fetchStatus).toHaveBeenCalledTimes(2)
    expect(refresh).not.toHaveBeenCalled()
    await advance(2_000)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('build rodando consulta a cada 2 s até terminar', async () => {
    make([S('v1', true), S('v1', true), S('v1', false)]).start()
    await advance(0)
    await advance(2_000)
    await advance(2_000)
    expect(fetchStatus).toHaveBeenCalledTimes(3)
    await advance(59_999)
    expect(fetchStatus).toHaveBeenCalledTimes(3)
  })

  it('build rodando há mais de 5 min cai para 60 s', async () => {
    make([S('v1', true)]).start()
    await advance(300_000)
    const before = fetchStatus.mock.calls.length
    await advance(59_999)
    expect(fetchStatus).toHaveBeenCalledTimes(before)
    await advance(1)
    expect(fetchStatus).toHaveBeenCalledTimes(before + 1)
    await advance(60_000)
    expect(fetchStatus).toHaveBeenCalledTimes(before + 2)
  })

  it('versão igual à renderizada não dá refresh', async () => {
    make([S('v1')]).start()
    await advance(0)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('versão nula não dá refresh', async () => {
    make([S(null)]).start()
    await advance(0)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('versão nova dá refresh uma vez', async () => {
    make([S('v2')]).start()
    await advance(0)
    expect(refresh).toHaveBeenCalledTimes(1)
    watcher.setVersion('v2')
    await advance(180_000)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('ocupado adia o refresh', async () => {
    busy = true
    make([S('v2')]).start()
    await advance(0)
    expect(refresh).not.toHaveBeenCalled()
    expect(fetchStatus).toHaveBeenCalledTimes(1)
    await advance(2_000)
    expect(fetchStatus).toHaveBeenCalledTimes(2)
    expect(refresh).not.toHaveBeenCalled()
    busy = false
    await advance(2_000)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('antilaço', async () => {
    make([S('v2'), S('v2'), S('v3')]).start()
    await advance(0)
    expect(refresh).toHaveBeenCalledTimes(1)
    await advance(60_000)
    expect(refresh).toHaveBeenCalledTimes(1)
    await advance(60_000)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('intervalo mínimo de 5 s', async () => {
    make([S('v2', true), S('v3', true)]).start()
    await advance(0)
    expect(refresh).toHaveBeenCalledTimes(1)
    watcher.setVersion('v2')
    await advance(2_000)
    await advance(2_000)
    expect(refresh).toHaveBeenCalledTimes(1)
    await advance(2_000)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('falha na consulta não dá refresh e segue a cadência', async () => {
    make([null]).start()
    await advance(0)
    expect(refresh).not.toHaveBeenCalled()
    await advance(59_999)
    expect(fetchStatus).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(fetchStatus).toHaveBeenCalledTimes(2)
  })

  it('consulta que lança não escapa e segue a cadência', async () => {
    fetchStatus = vi.fn(async () => {
      throw new Error('rede')
    })
    build().start()
    await advance(0)
    expect(refresh).not.toHaveBeenCalled()
    await advance(60_000)
    expect(fetchStatus).toHaveBeenCalledTimes(2)
  })

  it('aba escondida com consulta em andamento não agenda nada', async () => {
    let resolve!: (s: WatchStatus) => void
    fetchStatus = vi.fn(() => new Promise<WatchStatus>((r) => (resolve = r)))
    build().start()
    expect(fetchStatus).toHaveBeenCalledTimes(1)
    watcher.becameHidden()
    visible = false
    resolve(S('v1'))
    await advance(120_000)
    expect(fetchStatus).toHaveBeenCalledTimes(1)
  })

  it('stop com consulta em andamento não dá refresh nem agenda', async () => {
    let resolve!: (s: WatchStatus) => void
    fetchStatus = vi.fn(() => new Promise<WatchStatus>((r) => (resolve = r)))
    build().start()
    watcher.stop()
    resolve(S('v2'))
    await advance(120_000)
    expect(refresh).not.toHaveBeenCalled()
    expect(fetchStatus).toHaveBeenCalledTimes(1)
  })
})
