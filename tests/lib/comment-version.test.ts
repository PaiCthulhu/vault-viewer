import { describe, it, expect } from 'vitest'
import { commentVersion } from '@/lib/comment-version'

const base = { body: 'oi', createdAt: '2026-11-16T18:30:12.000Z', updatedAt: null }

describe('commentVersion', () => {
  it('é estável para o mesmo comentário e ignora os outros campos', () => {
    const a = commentVersion(base)
    const b = commentVersion({ ...base, path: 'x', author: 'ana', html: '<p>oi</p>' } as typeof base)
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-z]+$/)
  })
  it('muda com o corpo, com createdAt e com updatedAt', () => {
    const v = commentVersion(base)
    expect(commentVersion({ ...base, body: 'oi!' })).not.toBe(v)
    expect(commentVersion({ ...base, createdAt: null })).not.toBe(v)
    expect(commentVersion({ ...base, updatedAt: '2026-11-17T12:02:00.000Z' })).not.toBe(v)
  })
  it('não confunde a fronteira entre os campos', () => {
    const a = commentVersion({ body: 'a', createdAt: 'b', updatedAt: null })
    const b = commentVersion({ body: 'a","b', createdAt: null, updatedAt: null })
    expect(a).not.toBe(b)
  })
})
