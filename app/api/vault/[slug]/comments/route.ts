import { NextRequest, NextResponse } from 'next/server'
import {
  bodyField, commentSession, errorResponse, json, pathField, readJsonObject, requestRebuild,
} from '@/lib/comment-api'
import { createComment, deleteComment, editComment } from '@/lib/comment-store'

type Ctx = { params: Promise<{ slug: string }> }

// Cria um comentário numa nota (`parent` = caminho da nota) ou uma resposta (`parent` =
// caminho de um comentário). Devolve o comentário já renderizado.
export async function POST(request: NextRequest, { params }: Ctx) {
  const { slug } = await params
  const session = await commentSession(slug)
  if (session instanceof NextResponse) return session
  const data = await readJsonObject(request)
  if (data instanceof NextResponse) return data

  const parent = pathField(data.parent)
  if (parent === null) return json({ error: 'parent ausente ou inválido' }, 400)
  const body = bodyField(data.body)
  if (body instanceof NextResponse) return body

  try {
    const created = await createComment(session.vault, { parent, body, author: session.username })
    requestRebuild(slug, created.mother)
    return json({ comment: created.comment, replyTo: created.replyTo }, 201)
  } catch (err) {
    return errorResponse(err, slug)
  }
}

// Edita o corpo de um comentário. Só o autor; `version` é a versão que o cliente leu.
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { slug } = await params
  const session = await commentSession(slug)
  if (session instanceof NextResponse) return session
  const data = await readJsonObject(request)
  if (data instanceof NextResponse) return data

  const path = pathField(data.path)
  if (path === null) return json({ error: 'path ausente ou inválido' }, 400)
  if (typeof data.version !== 'string' || data.version === '') {
    return json({ error: 'version ausente' }, 400)
  }
  const body = bodyField(data.body)
  if (body instanceof NextResponse) return body

  try {
    const edited = await editComment(session.vault, {
      path, body, version: data.version, username: session.username,
    })
    requestRebuild(slug, edited.mother)
    return json({ comment: edited.comment })
  } catch (err) {
    return errorResponse(err, slug)
  }
}

// Apaga um comentário: o autor ou um admin. Um principal leva as respostas junto.
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const { slug } = await params
  const session = await commentSession(slug)
  if (session instanceof NextResponse) return session
  const data = await readJsonObject(request)
  if (data instanceof NextResponse) return data

  const path = pathField(data.path)
  if (path === null) return json({ error: 'path ausente ou inválido' }, 400)

  try {
    const removed = await deleteComment(session.vault, {
      path, username: session.username, isAdmin: session.isAdmin,
    })
    requestRebuild(slug, removed.mother)
    return json({ deleted: removed.deleted })
  } catch (err) {
    return errorResponse(err, slug)
  }
}
