import { spawn as nodeSpawn } from 'child_process'

export const REBUILD_TIMEOUT_MS = 300_000
const TAIL_CHARS = 600

export interface RebuildResult {
  ok: boolean
  output: string
  coalesced?: boolean
  timedOut?: boolean
}

type SpawnFn = typeof nodeSpawn

export interface BuildState {
  /** Build em andamento (ms epoch, gravado logo antes do spawn). */
  running: { startedAt: number } | null
  /** Há um build extra pedido para depois do atual. */
  queued: boolean
  /** Caminhos da frente do build extra. */
  first: string[]
  /** startedAt do último build que terminou, com sucesso ou não. */
  lastAttemptStartedAt: number | null
}

interface VaultState extends BuildState {
  /** Resolves with the result of the extra build; created by the first coalesced `wait` request. */
  next?: { promise: Promise<RebuildResult>; resolve: (r: RebuildResult) => void }
}

const MAX_FIRST = 20

// O estado fica em globalThis porque páginas e route handlers rodam em runtimes
// diferentes do Turbopack, cada um com seu próprio cache de módulos: uma variável
// de módulo seria uma cópia por runtime e os dois não veriam o mesmo build.
// O registro de um vault não sai do mapa ao fim do build, para guardar lastAttemptStartedAt.
const STATE_KEY = Symbol.for('vault-viewer.rebuild')
type GlobalWithState = typeof globalThis & { [STATE_KEY]?: Map<string, VaultState> }

function states(): Map<string, VaultState> {
  const g = globalThis as GlobalWithState
  return (g[STATE_KEY] ??= new Map<string, VaultState>())
}

function stateOf(slug: string): VaultState {
  const m = states()
  let st = m.get(slug)
  if (!st) {
    st = { running: null, queued: false, first: [], lastAttemptStartedAt: null }
    m.set(slug, st)
  }
  return st
}

/** Cópia do estado do build do vault; vault sem estado → tudo vazio/null. */
export function getBuildState(slug: string): BuildState {
  const st = states().get(slug)
  if (!st) return { running: null, queued: false, first: [], lastAttemptStartedAt: null }
  return {
    running: st.running ? { ...st.running } : null,
    queued: st.queued,
    first: [...st.first],
    lastAttemptStartedAt: st.lastAttemptStartedAt,
  }
}

function tail(s: string): string {
  return s.length > TAIL_CHARS ? s.slice(-TAIL_CHARS) : s
}

// Never throws: it runs inside catches that must not reject.
function errorText(err: unknown): string {
  try {
    return String(err instanceof Error ? err.message : err)
  } catch {
    return 'erro sem descrição'
  }
}

// Same Node binary as this server, with tsx as an import hook: no shell and no
// `npx` (spawn with shell:true is deprecated, DEP0190).
function buildOnce(slug: string, spawnFn: SpawnFn, first: string[] = []): Promise<RebuildResult> {
  return new Promise((resolve) => {
    let child: ReturnType<SpawnFn>
    try {
      child = spawnFn(process.execPath, [
        '--import', 'tsx', 'builder/index.ts',
        ...first.flatMap((p) => ['--first', p]),
        '--vault', slug,
      ], {
        cwd: process.cwd(),
      })
    } catch (err) {
      resolve({ ok: false, output: tail(errorText(err)) })
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false

    // Only called from child events and the timer, all after `timer` exists.
    const finish = (r: RebuildResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(r)
    }

    const timer = setTimeout(() => {
      child.kill()
      finish({ ok: false, timedOut: true, output: tail(stderr || stdout) })
    }, REBUILD_TIMEOUT_MS)

    child.stdout?.on('data', (d) => { stdout += d.toString() })
    child.stderr?.on('data', (d) => { stderr += d.toString() })
    child.on('error', (err) => finish({ ok: false, output: tail(err.message) }))
    child.on('close', (code) => {
      finish(code === 0 ? { ok: true, output: tail(stdout) } : { ok: false, output: tail(stderr || stdout) })
    })
  })
}

// The one log line of a failed build. Callers don't log the result: N requests waiting for
// the same build would repeat its output. Never throws, so it can't make runRebuild reject.
function logFailure(slug: string, r: RebuildResult): void {
  if (r.ok) return
  try {
    const why = r.timedOut ? ` (tempo esgotado, ${REBUILD_TIMEOUT_MS / 1000} s)` : ''
    // JSON.stringify quotes the slug and escapes what an invalid one could carry (a newline).
    console.error(`[rebuild] ${JSON.stringify(slug)} falhou${why}: ${r.output}`)
  } catch {
    // nothing left to report it to
  }
}

// buildOnce settles through the child's events or the timer, but a throw it doesn't foresee
// (a different spawnFn, an error inside the executor) would reject. That counts as a failed
// build, so the lock is released (or the next extra build starts) and whoever waits gets
// ok:false instead of hanging. The timer, if it was set, still kills the child.
// Every build, first or extra, ends here, so this is where a failure is logged.
async function buildOrFail(slug: string, spawnFn: SpawnFn, first: string[]): Promise<RebuildResult> {
  let r: RebuildResult
  try {
    r = await buildOnce(slug, spawnFn, first)
  } catch (err) {
    r = { ok: false, output: tail(errorText(err)) }
  }
  logFailure(slug, r)
  return r
}

/**
 * Rebuilds one vault, never two builds of the same vault at once. A request that
 * arrives while that vault is building returns `{ok:true, coalesced:true}` at
 * once and makes ONE more build run after the current one (however many arrive).
 * Different vaults do not block each other. `first` lists notes the builder
 * should write before the rest; those of coalesced requests are merged (arrival
 * order, no repeats, at most 20) into the extra build. A failed build is logged
 * here, once; callers must not log the result again.
 */
export async function runRebuild(
  slug: string,
  opts: { spawnFn?: SpawnFn; wait?: boolean; first?: string[] } = {},
): Promise<RebuildResult> {
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
    // No build runs, but the refusal is logged too: callers don't log results.
    const refused = { ok: false, output: 'Slug inválido' }
    logFailure(slug, refused)
    return refused
  }
  const spawnFn = opts.spawnFn ?? nodeSpawn
  const st = stateOf(slug)

  if (st.running) {
    st.queued = true
    for (const p of opts.first ?? []) {
      if (st.first.length >= MAX_FIRST) break
      if (!st.first.includes(p)) st.first.push(p)
    }
    if (!st.next) {
      let resolve!: (r: RebuildResult) => void
      const promise = new Promise<RebuildResult>((res) => { resolve = res })
      st.next = { promise, resolve }
    }
    // With `wait`, the caller gets the result of the build that covers its request.
    if (opts.wait) return st.next.promise
    return { ok: true, output: '', coalesced: true }
  }

  const startedAt = Date.now()
  st.running = { startedAt }
  const result = await buildOrFail(slug, spawnFn, (opts.first ?? []).slice(0, MAX_FIRST))
  st.lastAttemptStartedAt = startedAt

  if (!st.queued) {
    st.running = null
    return result
  }

  // Follow-up builds run detached, still holding the lock (`running`).
  void (async () => {
    try {
      while (st.queued) {
        st.queued = false
        const waiters = st.next
        st.next = undefined
        const first = st.first
        st.first = []
        const extraStartedAt = Date.now()
        st.running = { startedAt: extraStartedAt }
        const r = await buildOrFail(slug, spawnFn, first)
        st.lastAttemptStartedAt = extraStartedAt
        waiters?.resolve(r)
      }
    } finally {
      st.running = null
    }
  })()

  return result
}
