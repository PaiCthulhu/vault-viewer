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

interface Slot {
  /** A request arrived during the current build: run exactly one more after it. */
  pending: boolean
  /** Resolves with the result of that extra build; created by the first coalesced request. */
  next?: { promise: Promise<RebuildResult>; resolve: (r: RebuildResult) => void }
}

// Per-vault lock, in memory (one server process). Presence = a build is running.
const slots = new Map<string, Slot>()

function tail(s: string): string {
  return s.length > TAIL_CHARS ? s.slice(-TAIL_CHARS) : s
}

// Same Node binary as this server, with tsx as an import hook: no shell and no
// `npx` (spawn with shell:true is deprecated, DEP0190).
function buildOnce(slug: string, spawnFn: SpawnFn): Promise<RebuildResult> {
  return new Promise((resolve) => {
    let child: ReturnType<SpawnFn>
    try {
      child = spawnFn(process.execPath, ['--import', 'tsx', 'builder/index.ts', '--vault', slug], {
        cwd: process.cwd(),
      })
    } catch (err) {
      resolve({ ok: false, output: tail(err instanceof Error ? err.message : String(err)) })
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

/**
 * Rebuilds one vault, never two builds of the same vault at once. A request that
 * arrives while that vault is building returns `{ok:true, coalesced:true}` at
 * once and makes ONE more build run after the current one (however many arrive).
 * Different vaults do not block each other.
 */
export async function runRebuild(
  slug: string,
  opts: { spawnFn?: SpawnFn; wait?: boolean } = {},
): Promise<RebuildResult> {
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
    return { ok: false, output: 'Slug inválido' }
  }
  const spawnFn = opts.spawnFn ?? nodeSpawn

  const running = slots.get(slug)
  if (running) {
    running.pending = true
    if (!running.next) {
      let resolve!: (r: RebuildResult) => void
      const promise = new Promise<RebuildResult>((res) => { resolve = res })
      running.next = { promise, resolve }
    }
    // With `wait`, the caller gets the result of the build that covers its request.
    if (opts.wait) return running.next.promise
    return { ok: true, output: '', coalesced: true }
  }

  const slot: Slot = { pending: false }
  slots.set(slug, slot)
  const result = await buildOnce(slug, spawnFn)

  // Follow-up builds run detached, still holding the lock; a failure goes to the log.
  void (async () => {
    try {
      while (slot.pending) {
        slot.pending = false
        const waiters = slot.next
        slot.next = undefined
        const r = await buildOnce(slug, spawnFn)
        waiters?.resolve(r)
        if (!r.ok) console.error(`[rebuild] build extra de "${slug}" falhou: ${r.output}`)
      }
    } finally {
      slots.delete(slug)
    }
  })()

  return result
}
