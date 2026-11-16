import { describe, it, expect, vi, afterEach } from 'vitest'
import type { PageComment } from '../../builder/types'
import { commentVersion } from '../../lib/comment-version'
import {
  commentErrorKey, deleteComment, normalizeDraft, patchComment, postComment,
} from '../../lib/comment-client'

const COMMENT: PageComment = {
  path: '_comments/Notas/Minha Nota/2026-11-16 153012 ana-k3f9',
  author: 'ana', createdAt: '2026-11-16T18:30:12.000Z', updatedAt: null, body: 'oi', html: '<p>oi</p>',
}

function mockFetch(status: number, body: unknown, extra: Partial<Response> = {}) {
  const fn = vi.fn(async () => ({
    status, type: 'basic', json: async () => body, ...extra,
  }) as unknown as Response)
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('comment-client', () => {
  it('POST manda JSON para a rota do vault e devolve o comentário', async () => {
    const fn = mockFetch(201, { comment: COMMENT, replyTo: null })
    const res = await postComment('my vault', 'Notas/Minha Nota', 'oi')
    expect(res).toEqual({ ok: true, comment: COMMENT, replyTo: null })
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/vault/my%20vault/comments')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(init.redirect).toBe('manual')
    expect(JSON.parse(init.body as string)).toEqual({ parent: 'Notas/Minha Nota', body: 'oi' })
  })

  it('POST de resposta devolve o principal', async () => {
    mockFetch(201, { comment: COMMENT, replyTo: '_comments/N/p' })
    const res = await postComment('v', '_comments/N/p', 'oi')
    expect(res.ok && res.replyTo).toBe('_comments/N/p')
  })

  it('PATCH manda a versão do comentário que o cliente tem', async () => {
    const edited = { ...COMMENT, body: 'novo', updatedAt: '2026-11-17T12:00:00.000Z' }
    const fn = mockFetch(200, { comment: edited })
    const res = await patchComment('v', COMMENT, 'novo')
    expect(res).toEqual({ ok: true, comment: edited })
    const init = (fn.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(JSON.parse(init.body as string)).toEqual({
      path: COMMENT.path, body: 'novo', version: commentVersion(COMMENT),
    })
  })

  it('PATCH 409 devolve o comentário atual e o erro de conflito', async () => {
    const current = { ...COMMENT, body: 'mudou' }
    mockFetch(409, { error: 'x', comment: current })
    const res = await patchComment('v', COMMENT, 'novo')
    expect(res).toEqual({ ok: false, status: 409, errorKey: 'comments.error.conflict', comment: current })
  })

  it('DELETE devolve quantos arquivos saíram', async () => {
    const fn = mockFetch(200, { deleted: 3 })
    expect(await deleteComment('v', COMMENT.path)).toEqual({ ok: true, deleted: 3 })
    const init = (fn.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(init.method).toBe('DELETE')
    expect(JSON.parse(init.body as string)).toEqual({ path: COMMENT.path })
  })

  it('redirecionamento para o login conta como sessão expirada', async () => {
    mockFetch(0, null, { type: 'opaqueredirect' })
    const res = await postComment('v', 'N', 'oi')
    expect(res).toMatchObject({ ok: false, status: 401, errorKey: 'comments.error.session' })
  })

  it('falha de rede vira erro genérico', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('rede') }))
    expect(await deleteComment('v', 'x')).toEqual({ ok: false, status: 0, errorKey: 'comments.error.generic' })
  })

  it('resposta 201 fora do formato é erro, não comentário', async () => {
    mockFetch(201, { comment: { path: 1 } })
    expect(await postComment('v', 'N', 'oi')).toMatchObject({ ok: false, errorKey: 'comments.error.generic' })
  })

  it('corpo que não é JSON não derruba a chamada', async () => {
    mockFetch(500, null, { json: async () => { throw new SyntaxError('x') } })
    expect(await postComment('v', 'N', 'oi')).toMatchObject({ ok: false, status: 500 })
  })

  it('chave de erro por status', () => {
    expect(commentErrorKey('POST', 401)).toBe('comments.error.session')
    expect(commentErrorKey('POST', 403)).toBe('comments.error.forbidden')
    expect(commentErrorKey('POST', 404)).toBe('comments.error.noteGone')
    expect(commentErrorKey('DELETE', 404)).toBe('comments.error.gone')
    expect(commentErrorKey('PATCH', 409)).toBe('comments.error.conflict')
    expect(commentErrorKey('POST', 409)).toBe('comments.error.generic')
    expect(commentErrorKey('POST', 413)).toBe('comments.error.tooLong')
    expect(commentErrorKey('PATCH', 422)).toBe('comments.error.generic')
    expect(commentErrorKey('POST', 500)).toBe('comments.error.generic')
  })

  it('normalizeDraft conta como a API: quebras normalizadas e aparado', () => {
    expect(normalizeDraft('  a\r\nb\rc \n')).toBe('a\nb\nc')
  })
})
