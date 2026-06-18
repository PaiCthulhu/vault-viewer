import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'
import { dbUserHasVaultAccess } from '@/lib/db'
import { getPageData } from '@/lib/vault'
import { buildPreview, buildSectionPreview } from '@/lib/preview'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  // Auth — same pattern as the other routes.
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const payload = await verifyToken(token)
  if (!payload) return NextResponse.json({ error: 'Token inválido' }, { status: 401 })

  if (!payload.isAdmin && !dbUserHasVaultAccess(payload.userId, slug)) {
    return NextResponse.json({ error: 'Sem acesso' }, { status: 403 })
  }

  const path = request.nextUrl.searchParams.get('path') ?? ''
  if (!path) return NextResponse.json({ error: 'Path ausente' }, { status: 400 })

  const page = getPageData(slug, path.split('/'))
  if (!page) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  // `[[Page#Heading]]` links pass the heading id as `section`; scope the preview
  // to that section. Falls back to the whole-page preview if the heading is gone.
  const section = request.nextUrl.searchParams.get('section') ?? ''
  if (section) {
    const sec = buildSectionPreview(page.html, section)
    if (sec) {
      return NextResponse.json(
        {
          title: `${page.title} › ${sec.heading}`,
          image: sec.image,
          snippet: sec.snippet,
          imagePosition: sec.imagePosition,
        },
        { headers: { 'Cache-Control': 'private, max-age=300' } },
      )
    }
  }

  const { image, imagePosition, snippet } = buildPreview(page.html)

  return NextResponse.json(
    { title: page.title, image, snippet, imagePosition },
    { headers: { 'Cache-Control': 'private, max-age=300' } },
  )
}
