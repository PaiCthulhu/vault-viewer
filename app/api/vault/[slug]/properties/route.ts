import { NextRequest, NextResponse } from 'next/server'
import { editorSession, json } from '@/lib/vault-session'
import { pathField, readJsonObject } from '@/lib/comment-api'
import { afterPropertyWrite, propertyErrorResponse } from '@/lib/property-api'
import { editProperty } from '@/lib/property-store'

type Ctx = { params: Promise<{ slug: string }> }

const MAX_KEY_CHARS = 1000

// Troca o valor de uma propriedade que já existe numa nota. Só editor do vault ou admin.
// `expected` é o valor que o cliente viu; `confirm` libera a troca de um valor fora do tipo.
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { slug } = await params
  const session = await editorSession(slug)
  if (session instanceof NextResponse) return session
  const data = await readJsonObject(request)
  if (data instanceof NextResponse) return data

  const path = pathField(data.path)
  if (path === null) return json({ error: 'path ausente ou inválido' }, 400)
  const key = data.key
  if (typeof key !== 'string' || key === '' || key.length > MAX_KEY_CHARS) {
    return json({ error: 'key ausente ou inválida' }, 400)
  }
  if (!Object.hasOwn(data, 'value')) return json({ error: 'value ausente' }, 400)
  if (!Object.hasOwn(data, 'expected')) return json({ error: 'expected ausente' }, 400)
  if (Object.hasOwn(data, 'confirm') && typeof data.confirm !== 'boolean') {
    return json({ error: 'confirm inválido' }, 400)
  }

  const ctx = { slug, username: session.username, key }
  try {
    const edited = await editProperty(session.vault, {
      path, key, value: data.value, expected: data.expected, confirm: data.confirm === true,
    })
    if (edited.wrote) afterPropertyWrite(ctx, edited.notePath)
    return json({ property: edited.property })
  } catch (err) {
    return propertyErrorResponse(err, ctx)
  }
}
