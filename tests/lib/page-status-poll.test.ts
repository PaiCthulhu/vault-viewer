import { describe, it, expect } from 'vitest'
import { nextPollDelay, POLL_GIVE_UP_MS } from '@/lib/page-status-poll'

describe('nextPollDelay', () => {
  it('consulta a cada 1 s nos primeiros 30 s', () => {
    expect(nextPollDelay(0)).toBe(1000)
    expect(nextPollDelay(29_999)).toBe(1000)
  })
  it('depois consulta a cada 5 s até 5 min', () => {
    expect(nextPollDelay(30_000)).toBe(5000)
    expect(nextPollDelay(299_999)).toBe(5000)
  })
  it('desiste aos 5 min', () => {
    expect(POLL_GIVE_UP_MS).toBe(300_000)
    expect(nextPollDelay(300_000)).toBeNull()
  })
})
