// Chamadas do navegador à API de comentários (`/api/vault/<slug>/comments`). Cada uma
// devolve o resultado ou a chave i18n de um erro curto para a faixa mostrar.
import type { PageComment } from '@/builder/types'
import { commentVersion } from '@/lib/comment-version'

// O mesmo teto da API (`MAX_COMMENT_CHARS`), contado como ela conta: depois de normalizar
// as quebras de linha e aparar.
export const MAX_COMMENT_CHARS = 10_000

export function normalizeDraft(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim()
}

const REQUEST_TIMEOUT_MS = 30_000

export type CommentFailure = {
  ok: false
  status: number // 0 = rede, tempo esgotado ou redirecionamento para o login
  errorKey: string
  // No 409 do editar: o comentário como está no disco.
  comment?: PageComment
}
export type CommentResult<T> = ({ ok: true } & T) | CommentFailure

type Method = 'POST' | 'PATCH' | 'DELETE'

export function commentErrorKey(method: Method, status: number): string {
  if (status === 401) return 'comments.error.session'
  if (status === 403) return 'comments.error.forbidden'
  if (status === 404) return method === 'POST' ? 'comments.error.noteGone' : 'comments.error.gone'
  if (status === 409 && method === 'PATCH') return 'comments.error.conflict'
  if (status === 413) return 'comments.error.tooLong'
  return 'comments.error.generic'
}

function isComment(v: unknown): v is PageComment {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  return (
    typeof c.path === 'string' && typeof c.author === 'string' && typeof c.body === 'string' &&
    typeof c.html === 'string' &&
    (c.createdAt === null || typeof c.createdAt === 'string') &&
    (c.updatedAt === null || typeof c.updatedAt === 'string')
  )
}

async function call(
  slug: string, method: Method, payload: Record<string, unknown>,
): Promise<{ status: number; data: Record<string, unknown> | null }> {
  // AbortController + setTimeout (e não AbortSignal.timeout) para o relógio falso dos testes valer.
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch('/api/vault/' + encodeURIComponent(slug) + '/comments', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
      // Sem cookie de sessão o proxy redireciona para o login: sem isto o fetch seguiria
      // o redirecionamento e receberia a página de login como se fosse a resposta.
      redirect: 'manual',
      signal: ctrl.signal,
    })
    if (res.type === 'opaqueredirect') return { status: 401, data: null }
    let data: unknown = null
    try {
      data = await res.json()
    } catch {
      data = null
    }
    const obj = typeof data === 'object' && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null
    return { status: res.status, data: obj }
  } catch {
    return { status: 0, data: null }
  } finally {
    clearTimeout(timer)
  }
}

const failure = (method: Method, status: number): CommentFailure =>
  ({ ok: false, status, errorKey: commentErrorKey(method, status) })

// `parent`: o caminho da nota (comentário principal) ou o de um comentário (resposta).
export async function postComment(
  slug: string, parent: string, body: string,
): Promise<CommentResult<{ comment: PageComment; replyTo: string | null }>> {
  const { status, data } = await call(slug, 'POST', { parent, body })
  if (status !== 201 || !data || !isComment(data.comment)) return failure('POST', status === 201 ? 0 : status)
  return { ok: true, comment: data.comment, replyTo: typeof data.replyTo === 'string' ? data.replyTo : null }
}

// `current`: o comentário como a faixa o mostra; a versão dele vai junto, e a API recusa
// (409, com o comentário atual) se o arquivo mudou desde então.
export async function patchComment(
  slug: string, current: PageComment, body: string,
): Promise<CommentResult<{ comment: PageComment }>> {
  const { status, data } = await call(slug, 'PATCH', {
    path: current.path, body, version: commentVersion(current),
  })
  if (status === 200 && data && isComment(data.comment)) return { ok: true, comment: data.comment }
  const fail = failure('PATCH', status === 200 ? 0 : status)
  if (status === 409 && data && isComment(data.comment)) fail.comment = data.comment
  return fail
}

export async function deleteComment(slug: string, path: string): Promise<CommentResult<{ deleted: number }>> {
  const { status, data } = await call(slug, 'DELETE', { path })
  if (status !== 200 || !data) return failure('DELETE', status === 200 ? 0 : status)
  return { ok: true, deleted: typeof data.deleted === 'number' ? data.deleted : 0 }
}
