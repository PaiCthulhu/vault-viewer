export type BuildStatus = 'pending' | 'building' | 'ok' | 'error'

export interface StatusSummary {
  ok: number
  error: number
  done: number
  total: number
}

export function summarizeStatuses(statuses: BuildStatus[]): StatusSummary {
  const ok = statuses.filter((s) => s === 'ok').length
  const error = statuses.filter((s) => s === 'error').length
  return { ok, error, done: ok + error, total: statuses.length }
}
