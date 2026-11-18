import { NextRequest, NextResponse } from 'next/server'
import { editorSession, json } from '@/lib/vault-session'
import { getPropertyRelation, getPropertyValues } from '@/lib/vault'

// Só lê: os valores já usados numa propriedade de lista, para sugerir na edição.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const session = await editorSession(slug)
  if (session instanceof NextResponse) return session

  const key = request.nextUrl.searchParams.get('key')
  if (!key) return json({ error: 'key ausente' }, 400)

  const index = getPropertyValues(slug)
  const values = Object.hasOwn(index, key) ? index[key] : []
  const relation = getPropertyRelation(slug, key)
  return json(relation ? { values, relation } : { values })
}
