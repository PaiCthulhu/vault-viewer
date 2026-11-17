// O que as rotas de comentário têm em comum: quem pode escrever, a leitura do corpo JSON e
// o disparo do rebuild. A escrita no disco fica em `lib/comment-store.ts`.
import { NextRequest, NextResponse } from 'next/server'
import type { VaultConfig } from '@/types'
import { json, vaultSession } from '@/lib/vault-session'
import { runRebuild } from '@/lib/rebuild'
import { CommentError, MAX_COMMENT_CHARS, normalizeBody, wroteMother } from '@/lib/comment-store'
import { commentTooDeep } from '@/builder/comment-render'

// Teto do corpo da requisição: 10.000 caracteres de comentário, no pior caso do JSON
// (`\uXXXX` para cada um), mais os outros campos.
const MAX_REQUEST_BYTES = 128 * 1024
const MAX_PATH_CHARS = 1000

export { json }

const fail = (status: number, error: string): NextResponse => json({ error }, status)

export interface CommentSession {
  vault: VaultConfig
  username: string
  isAdmin: boolean
}

// Quem pode escrever comentários neste vault: a sessão comum (`vaultSession`) e a flag
// `comments` ligada. O nome e o papel vêm do banco, não do token.
export async function commentSession(slug: string): Promise<CommentSession | NextResponse> {
  const session = await vaultSession(slug)
  if (session instanceof NextResponse) return session
  if (session.vault.comments !== true) return fail(403, 'Comentários desligados neste vault')
  return { vault: session.vault, username: session.username, isAdmin: session.isAdmin }
}

// Corpo JSON obrigatório (`Content-Type: application/json`), com teto de tamanho, e tem de
// ser um objeto. Um formulário de outro site não consegue mandar este tipo sem preflight.
export async function readJsonObject(request: NextRequest): Promise<Record<string, unknown> | NextResponse> {
  const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (type !== 'application/json') return fail(415, 'O corpo tem de ser application/json')
  if (Number(request.headers.get('content-length') ?? 0) > MAX_REQUEST_BYTES) {
    return fail(413, 'Requisição grande demais')
  }

  const chunks: Uint8Array[] = []
  let total = 0
  const reader = request.body?.getReader()
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined)
        return fail(413, 'Requisição grande demais')
      }
      chunks.push(value)
    }
  }

  let data: unknown
  try {
    data = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
  } catch {
    return fail(400, 'JSON inválido')
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return fail(400, 'Corpo inválido')
  return data as Record<string, unknown>
}

// Campo de caminho: texto não vazio e de tamanho razoável. A validação de verdade
// (segmentos, caminho canônico) é da loja.
export function pathField(v: unknown): string | null {
  return typeof v === 'string' && v !== '' && v.length <= MAX_PATH_CHARS ? v : null
}

// Corpo do comentário, normalizado, ou a resposta de erro. Um corpo fundo demais para o
// render restrito (`commentTooDeep`) é recusado aqui, antes de qualquer escrita: no build ele
// só sairia como texto.
export function bodyField(v: unknown): string | NextResponse {
  const body = normalizeBody(v)
  if (body === null || body === '') return fail(400, 'O comentário não pode ficar vazio')
  if (body.length > MAX_COMMENT_CHARS) {
    return fail(400, `O comentário passa de ${MAX_COMMENT_CHARS} caracteres`)
  }
  if (commentTooDeep(body)) return fail(400, 'O comentário tem aninhamento demais')
  return body
}

// O "rebuild silencioso": pede o build com a mãe na frente e não espera. Pedidos seguidos
// se juntam num build só (`runRebuild`), que também loga a própria falha.
export function requestRebuild(slug: string, mother: string | null): void {
  void runRebuild(slug, { first: mother ? [mother] : [] }).catch(err =>
    console.error(`[comments] erro ao pedir o build de ${JSON.stringify(slug)}:`, err),
  )
}

// Erro da loja vira a resposta com o status dele; qualquer outro é 500, com o detalhe só
// no log. Se o disco já tinha mudado quando o erro veio, o build é pedido assim mesmo.
export function errorResponse(err: unknown, slug: string): NextResponse {
  const mother = wroteMother(err)
  if (mother !== undefined) requestRebuild(slug, mother)
  if (err instanceof CommentError) return json({ error: err.message, ...err.extra }, err.status)
  console.error('[comments] erro ao escrever comentário:', err)
  return fail(500, 'Erro ao gravar o comentário')
}
