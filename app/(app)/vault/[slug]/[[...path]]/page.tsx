import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'
import { getVaultBySlug } from '@/lib/vault-config'
import { dbUserHasVaultAccess } from '@/lib/db'
import { getPageData, getPagesIndex, getGraphData, getVaultTree, findHomePage } from '@/lib/vault'
import { getFolderPage } from '@/lib/folder-page'
import { parseHtmlSegments } from '@/lib/parse-html-segments'
import { extractToc } from '@/lib/toc'
import { VaultViewer } from '@/components/viewer/VaultViewer'

interface Props {
  params: Promise<{ slug: string; path?: string[] }>
}

export default async function VaultPage({ params }: Props) {
  const { slug, path = [] } = await params

  // Auth check
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) notFound()
  const user = await verifyToken(token)
  if (!user) notFound()

  // Vault existence + access
  const vault = getVaultBySlug(slug)
  if (!vault) notFound()

  if (!user.isAdmin) {
    const hasAccess = dbUserHasVaultAccess(user.userId, slug)
    if (!hasAccess) notFound()
  }

  // Load data
  const pagesIndex = getPagesIndex(slug)
  const tree = getVaultTree(slug)
  const graphData = getGraphData(slug)

  if (!graphData || pagesIndex.length === 0) notFound()

  // Load current page
  let page = path.length > 0
    ? getPageData(slug, path)
    : findHomePage(slug, vault.homePage)

  // No real page at this path? If it names a folder (no folder note), serve an
  // auto-generated index page listing the folder's direct children.
  if (!page && path.length > 0) {
    const folderPath = path.map(decodeURIComponent).join('/')
    page = getFolderPage(slug, folderPath)
  }

  if (!page) notFound()

  // Parse HTML server-side
  const segments = parseHtmlSegments(page.html)
  const toc = extractToc(page.html)

  return (
    <VaultViewer
      vault={vault}
      page={page}
      segments={segments}
      toc={toc}
      pagesIndex={pagesIndex}
      tree={tree}
      graphData={graphData}
      username={user.username}
      isAdmin={user.isAdmin}
    />
  )
}
