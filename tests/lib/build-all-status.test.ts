import { describe, it, expect } from 'vitest'
import { summarizeStatuses, type BuildStatus } from '@/lib/build-all-status'

describe('summarizeStatuses', () => {
  it('counts ok, error and done over the total', () => {
    const s: BuildStatus[] = ['ok', 'error', 'ok', 'pending']
    expect(summarizeStatuses(s)).toEqual({ ok: 2, error: 1, done: 3, total: 4 })
  })

  it('treats building as not done', () => {
    const s: BuildStatus[] = ['building', 'pending']
    expect(summarizeStatuses(s)).toEqual({ ok: 0, error: 0, done: 0, total: 2 })
  })

  it('handles an empty list', () => {
    expect(summarizeStatuses([])).toEqual({ ok: 0, error: 0, done: 0, total: 0 })
  })
})
