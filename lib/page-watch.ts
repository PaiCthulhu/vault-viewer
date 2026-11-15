// Vigia da aba: decide quando consultar a versão da página e quando dar refresh.
// Lógica pura, sem React nem Next; o componente PageWatcher liga isto ao documento.

export const IDLE_POLL_MS = 60_000
export const FAST_POLL_MS = 2_000
export const RETURN_FAST_WINDOW_MS = 20_000
// Intervalos das primeiras consultas depois de voltar para a aba; esgotada a
// rampa, segue FAST_POLL_MS até o fim da janela.
export const RETURN_RAMP_MS: readonly number[] = [500, 1_000, 1_500]
export const BUILDING_FAST_CAP_MS = 300_000
export const WATCH_MIN_REFRESH_GAP_MS = 5_000
export const BUSY_QUIET_MS = 3_000
export const VISIBLE_DEDUPE_MS = 1_000

export interface WatchStatus {
  version: string | null
  building: boolean
}

export interface PageWatchDeps {
  fetchStatus(): Promise<WatchStatus | null> // null = falha (rede, não-ok)
  refresh(): void
  isVisible(): boolean
  isBusy(): boolean
  now(): number
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
}

export interface PageWatcher {
  start(): void // ao montar: consulta já se a aba estiver visível
  becameVisible(): void // visibilitychange para visível, ou focus da janela
  becameHidden(): void
  setVersion(v: string): void // a versão renderizada mudou (depois do refresh)
  stop(): void
}

export function createPageWatcher(initialVersion: string, deps: PageWatchDeps): PageWatcher {
  let rendered = initialVersion
  let stopped = false
  let inFlight = false
  let timer: unknown = null
  let lastCheckStartedAt = -Infinity
  let lastRefreshAt = -Infinity
  let lastRefreshedFor: string | null = null
  let fastUntil = -Infinity
  let returnStep = 0
  let buildingSince: number | null = null
  let wanted: string | null = null

  const cancel = () => {
    if (timer !== null) {
      deps.clearTimer(timer)
      timer = null
    }
  }

  const schedule = (ms: number) => {
    cancel()
    timer = deps.setTimer(() => {
      timer = null
      void check()
    }, ms)
  }

  // Consome um passo da rampa quando está na janela de volta à aba: chame só
  // para agendar a próxima consulta.
  const nextDelay = (): number => {
    const now = deps.now()
    if (now < fastUntil) return RETURN_RAMP_MS[returnStep++] ?? FAST_POLL_MS
    if (wanted !== null) return FAST_POLL_MS
    if (buildingSince !== null && now - buildingSince < BUILDING_FAST_CAP_MS) return FAST_POLL_MS
    return IDLE_POLL_MS
  }

  const handle = (status: WatchStatus | null) => {
    const now = deps.now()
    // Falha de consulta = sem novidade: mantém o que estava pendente e não
    // dispara refresh (ele provavelmente falharia e gastaria a versão).
    if (!status) return
    buildingSince = status.building ? (buildingSince ?? now) : null
    const v = status.version
    wanted = v !== null && v !== rendered && v !== lastRefreshedFor ? v : null
    if (wanted !== null && !deps.isBusy() && now - lastRefreshAt >= WATCH_MIN_REFRESH_GAP_MS) {
      lastRefreshedFor = wanted
      lastRefreshAt = now
      wanted = null
      deps.refresh()
    }
  }

  async function check(): Promise<void> {
    if (stopped || inFlight) return
    inFlight = true
    lastCheckStartedAt = deps.now()
    let status: WatchStatus | null = null
    try {
      status = await deps.fetchStatus()
    } catch {
      status = null
    }
    inFlight = false
    if (stopped) return
    handle(status)
    if (!stopped && deps.isVisible()) schedule(nextDelay())
  }

  return {
    start() {
      if (stopped || !deps.isVisible()) return
      void check()
    },
    becameVisible() {
      if (stopped) return
      const now = deps.now()
      fastUntil = now + RETURN_FAST_WINDOW_MS
      returnStep = 0
      if (now - lastCheckStartedAt < VISIBLE_DEDUPE_MS) {
        // Consulta recente: não repete já, mas rearma o timer na cadência
        // rápida (uma troca rápida de aba pode ter limpado o timer, ou ele
        // ainda estar na espera de 60 s). Com consulta em andamento, ela mesma reagenda.
        if (!inFlight && deps.isVisible()) schedule(nextDelay())
        return
      }
      cancel()
      void check()
    },
    becameHidden() {
      cancel()
    },
    setVersion(v: string) {
      rendered = v
      if (wanted === v) wanted = null
    },
    stop() {
      stopped = true
      cancel()
    },
  }
}

const NON_TEXT_INPUTS = new Set([
  'button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image',
])

// O usuário está no meio de algo que um refresh atrapalharia?
export function isUserBusy(doc: Document, lastInteractionAt: number, now: number): boolean {
  if (doc.querySelector('.dv-filter-menu.is-open')) return true
  const el = doc.activeElement
  if (!el || now - lastInteractionAt >= BUSY_QUIET_MS) return false
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has((el as HTMLInputElement).type)
  return el.closest('[contenteditable]:not([contenteditable="false"])') !== null
}
