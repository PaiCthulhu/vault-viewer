import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'
import { getVaultBySlug } from '@/lib/vault-config'
import { dbUserHasVaultAccess } from '@/lib/db'
import { getPageData, getPagesIndex, getGraphData, getVaultTree, findHomePage, pageJsonMtimeMs } from '@/lib/vault'
import { isPending, provisionalPage } from '@/lib/pending-page'
import { getFolderPage } from '@/lib/folder-page'
import { pageVersion } from '@/lib/page-version'
import { parseHtmlSegments } from '@/lib/parse-html-segments'
import { extractToc } from '@/lib/toc'
import { pageDisplayNames } from '@/lib/comment-authors'
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
  let isFolderPage = false
  let pending: { mode: 'generating' | 'updating'; path: string } | null = null
  let decodedPath = ''
  if (!page && path.length > 0) {
    try {
      decodedPath = path.map(decodeURIComponent).join('/')
    } catch {
      notFound()
    }
    page = getFolderPage(slug, decodedPath)
    isFolderPage = page !== null

    // Nota que o builder ainda não gerou: mostra "aguarde" no lugar do 404.
    if (!page && isPending(vault, decodedPath, { trigger: true })) {
      page = provisionalPage(decodedPath)
      pending = { mode: 'generating', path: decodedPath }
    }
  }

  if (!page) notFound()

  // Página real cuja nota mudou depois do último build: serve como está, com a faixa.
  if (!pending && !isFolderPage) {
    const mtime = pageJsonMtimeMs(slug, page.path)
    if (isPending(vault, page.path, { trigger: true, pageJsonMtimeMs: mtime })) {
      pending = { mode: 'updating', path: page.path }
    }
  }

  // Parse HTML server-side
  // A faixa de comentários só existe com a flag do vault ligada e em página comentável.
  // O bloco Propriedades só é cortado quando a página traz as linhas dele (formato novo).
  const segments = parseHtmlSegments(page.html, {
    comments: vault.comments === true && page.commentable === true,
    properties: Array.isArray(page.properties),
  })
  const toc = extractToc(page.html)

  // Nomes dos autores dos comentários: à parte, nunca dentro do `page` (a versão é o hash do JSON do disco).
  const displayNames = vault.comments === true ? pageDisplayNames(page, user.username) : {}

  // A versão é o hash do `PageMeta` do disco (o mesmo do `currentPageVersion`). Só depois, e só
  // no que vai ao navegador, a flag desligada esvazia os comentários: esconder a faixa não basta.
  const version = pending ? null : pageVersion(page)
  const clientPage = vault.comments !== true && page.comments !== undefined ? { ...page, comments: [] } : page

  return (
    <VaultViewer
      vault={vault}
      page={clientPage}
      segments={segments}
      toc={toc}
      pagesIndex={pagesIndex}
      tree={tree}
      graphData={graphData}
      username={user.username}
      isAdmin={user.isAdmin}
      pending={pending}
      pageVersion={version}
      displayNames={displayNames}
    />
  )
}
