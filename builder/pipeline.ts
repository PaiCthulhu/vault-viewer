import fs from 'fs'
import path from 'path'
import type { VaultConfig } from '@/types'
import type { PageMeta, PageComment, CommentThread } from './types'
import { scanVault, scanCanvases, scanImages, countFolders, noteTime } from './scanner'
import { loadVaultIgnore } from './vault-ignore'
import { extractFrontmatter, extractTags } from './frontmatter'
import { LinkResolver } from './link-resolver'
import { ImageHandler } from './image-handler'
import { renderBanner } from './plugins/banners'
import { renderColumns } from './plugins/columns'
import { renderCaptions } from './plugins/captions'
import { renderCallouts } from './plugins/callouts'
import { applyObsidianCompat } from './plugins/obsidian-compat'
import { renderCanvas, canvasTextSources } from './plugins/canvas'
import { renderProperties } from './plugins/properties'
import { executeDQL, executeDataviewJS } from './plugins/dataview'
import { renderMarkdown } from './markdown'
import { buildGraph } from './graph-builder'
import { writeOutput, writePage, writeSummaries, writeAssets, toSummaries } from './writer'
import { readPrevScanMs, selectFirstPages } from './first-pages'
import { resolveFamilies, noteFamilyFields, isInCommentsFolder } from './note-family'
import { COMMENTS_MARKER, groupComments, sortThreads, toPageComment } from './comments'

// Normalize a rendered <h1>'s text (or a plain title) for a tolerant comparison:
// strip tags, decode common entities, unify dash/quote variants, collapse
// whitespace, lowercase. So "START HERE — Projeto" matches "Start Here - Projeto".
function htmlToText(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/gi, "'")
    .replace(/[‐-―−]/g, '-') // hyphen/dash/minus variants → '-'
    .replace(/[‘’]/g, "'") // curly single quotes → '
    .replace(/[“”]/g, '"') // curly double quotes → "
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// String.replace com substituto assíncrono. Os matches rodam em sequência, na
// ordem do texto, para o CSS capturado sair na mesma ordem dos blocos.
export async function replaceAsync(
  s: string,
  re: RegExp,
  fn: (match: string, ...groups: string[]) => Promise<string>,
): Promise<string> {
  let out = ''
  let last = 0
  for (const m of s.matchAll(re)) {
    out += s.slice(last, m.index) + await fn(m[0], ...m.slice(1))
    last = m.index + m[0].length
  }
  return out + s.slice(last)
}

// Resolve a page's display title from the configured frontmatter property.
// When `titleProperty` is a non-empty string and the frontmatter has a
// non-empty value for it, use that; otherwise fall back to the filename title.
export function resolveTitle(
  frontmatter: Record<string, unknown>,
  filenameTitle: string,
  titleProperty?: string | null,
): string {
  if (typeof titleProperty === 'string' && titleProperty.trim() !== '') {
    const raw = frontmatter[titleProperty]
    if (raw != null) {
      const value = String(raw).trim()
      if (value !== '') return value
    }
  }
  return filenameTitle
}

function isEnoent(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'ENOENT'
}

export async function buildVault(vault: VaultConfig, opts: { first?: string[]; dataRoot?: string } = {}): Promise<void> {
  console.log(`\n[${vault.slug}] Iniciando build de "${vault.name}"`)
  console.log(`[${vault.slug}] Vault path: ${vault.path}`)

  // ── Passe 1: Scan + frontmatter (sem renderização) ──────────────────────────
  // `.viewerignore` (sintaxe gitignore) na raiz do vault esconde arquivos/pastas.
  const dataDir = path.join(opts.dataRoot ?? path.join(process.cwd(), 'data'), vault.slug)
  // Início da varredura do build anterior: lido antes de gravar qualquer coisa.
  const prevScanMs = readPrevScanMs(path.join(dataDir, 'index.json'))
  const startedAt = new Date().toISOString()
  const ig = loadVaultIgnore(vault.path)
  const files = scanVault(vault.path, ig)
  // Canvas dentro de `_comments/` fica fora de tudo (resolver, listas, grafo, render): o
  // texto dos nós passaria pelo `renderBody`, que roda dataviewjs.
  const canvasFiles = scanCanvases(vault.path, ig).filter(c => !isInCommentsFolder(c.relativePath))
  const imageIndex = scanImages(vault.path, ig)
  const folderCount = countFolders(vault.path, ig)
  // Canvas files entram no resolver para [[Página Inicial]] resolver, mas NÃO nos stubs.
  const linkResolver = new LinkResolver([...files, ...canvasFiles])
  const imageHandler = new ImageHandler(vault.path, vault.slug, imageIndex)

  // Garante que a imagem de capa do vault seja registrada na lista de assets (assets.json).
  if (vault.coverImage) imageHandler.resolve(vault.coverImage)

  console.log(`[${vault.slug}] Encontrados: ${files.length} páginas, ${canvasFiles.length} canvases, ${imageIndex.size} imagens, ${folderCount} pastas`)

  // Stubs para DataviewJS queries no passe 2
  const stubs: PageMeta[] = files.map(file => {
    const raw = fs.readFileSync(file.absolutePath, 'utf-8').replace(/\r\n/g, '\n')
    const { frontmatter, body } = extractFrontmatter(raw, file.title)
    const tags = extractTags(frontmatter)
    const outlinks = linkResolver.extractOutlinks(body)
    return {
      path: file.relativePath,
      title: resolveTitle(frontmatter, file.title, vault.titleProperty),
      frontmatter,
      allFields: { ...frontmatter },
      html: '',
      outlinks,
      tags,
      css: '',
    }
  })

  // Notas-filhas (`note_type` tab/comment + `parent`): as filhas saem da árvore, da
  // busca e do grafo; comentários nem geram página; mãe e abas ganham a barra de abas.
  // O Dataview continua vendo todas (os stubs não mudam).
  const families = resolveFamilies(stubs)
  // Conversas por mãe (caminhos); o conteúdo é lido do disco só ao renderizar a mãe.
  const threadRefs = groupComments(families)
  const fileIndex = new Map(files.map((f, i) => [f.relativePath, i]))

  // ── Passe 2: Renderização completa ──────────────────────────────────────────
  const pages: PageMeta[] = []

  // Fábrica do renderizador recursivo do corpo, fechando sobre o contexto da
  // página (`currentStub` para DataviewJS e `css` para coletar CSS capturado).
  // O processamento de dataview roda DENTRO da recursão para também alcançar
  // blocos ```dataview / ```dataviewjs aninhados em callouts/columns: estes só
  // perdem o prefixo `> ` (ou as cercas de coluna) APÓS o desempacotamento, e
  // só então as regexes ancoradas `^```...` casam.
  function makeRenderBody(currentStub: PageMeta, css: string[]) {
    // Renderizador recursivo do corpo: callouts e columns podem aninhar entre si.
    // A recursão termina porque callouts removem o prefixo `> ` e columns removem as cercas.
    async function renderBody(md: string): Promise<string> {
      // 1. DataviewJS (recursivo — também pega blocos desempacotados de callouts/columns)
      md = await replaceAsync(md, /^```dataviewjs[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm, async (_, code) => {
        const { html, css: cssText } = await executeDataviewJS(code, stubs, currentStub, vault.slug, p => imageHandler.resolve(p), { vaultRoot: vault.path })
        if (cssText) css.push(cssText)
        return html
      })

      // 2. DQL (dataview)
      md = md.replace(/^```dataview[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm, (_, query) => {
        return executeDQL(query.trim(), stubs, vault.slug)
      })

      // 3-6. Render recursivo do corpo (callouts/columns aninham entre si).
      // Cercas (````col / ```col-md) são limites mais fortes que blockquotes:
      // extrair colunas ANTES dos callouts impede que a continuação lazy do
      // callout engula a cerca de fechamento de uma coluna. As colunas internas a
      // um callout são `> `-prefixadas (a regex de topo `^````col` as ignora);
      // o callout remove o prefixo e a recursão de renderBody as processa.
      md = await renderColumns(md, renderBody)
      md = await renderCallouts(md, renderBody)
      md = applyObsidianCompat(md)
      md = renderCaptions(md, p => imageHandler.resolve(p))
      md = linkResolver.replaceWikilinks(md, vault.slug)
      return renderMarkdown(md)
    }
    return renderBody
  }

  // Renderiza a nota `i`. Só lê stubs/imageHandler, então a ordem de chamada não muda o resultado.
  async function renderPage(i: number): Promise<PageMeta> {
    const file = files[i]
    const stub = stubs[i]

    const raw = fs.readFileSync(file.absolutePath, 'utf-8').replace(/\r\n/g, '\n')
    const { body } = extractFrontmatter(raw, file.title)

    // Banner HTML a partir do frontmatter
    const bannerHtml = renderBanner(stub.frontmatter, stub.title, p => imageHandler.resolve(p), vault.coverProperty)

    const pageCss: string[] = []

    // O renderizador recursivo do corpo processa dataview (incl. blocos aninhados
    // em callouts/columns), columns, callouts, compat, captions, wikilinks e md.
    const renderBody = makeRenderBody(stub, pageCss)

    // `md` é apenas o corpo sem frontmatter — sem pré-processamento de dataview.
    let bodyHtml = await renderBody(body)

    // If the body starts with an <h1> whose content matches the page title, merge
    // it into the page/banner title: the displayed title inherits the h1's id (so
    // in-page anchors keep working) and the duplicate h1 is removed from the body.
    let titleId = ''
    {
      const m = /^\s*<h1\b([^>]*)>([\s\S]*?)<\/h1>\s*/.exec(bodyHtml)
      if (m && htmlToText(m[2]) === htmlToText(stub.title)) {
        const idMatch = /\bid="([^"]*)"/.exec(m[1])
        titleId = idMatch ? idMatch[1] : ''
        bodyHtml = bodyHtml.slice(m[0].length)
      }
    }

    // With a banner, the title lives in the banner's <h1>; inherit the id there.
    // Without a banner, emit the special vault-page-title h1 (with the id).
    let banner = bannerHtml
    if (banner && titleId) {
      banner = banner.replace(
        '<h1 class="vault-banner-title">',
        `<h1 class="vault-banner-title" id="${titleId}">`,
      )
    }

    const titleHtml = banner
      ? ''
      : `<h1 class="vault-page-title"${titleId ? ` id="${titleId}"` : ''}>${stub.title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</h1>`

    // Collapsible "Propriedades" block from the frontmatter, at the top of the
    // article (right after the title / below the banner).
    const propsHtml = renderProperties(
      stub.frontmatter,
      s => linkResolver.replaceWikilinks(s, vault.slug),
      p => imageHandler.resolve(p),
      { familyNote: noteFamilyFields(stub.frontmatter).noteType !== null },
    )

    // Comentável: nota com bloco de Propriedades que não é aba. O marcador marca onde
    // o viewer encaixa a área de comentários.
    const commentable = propsHtml !== '' && !families.hidden.has(stub.path)

    const fullHtml = banner + `<article class="vault-content">${titleHtml}${propsHtml}${commentable ? COMMENTS_MARKER : ''}${bodyHtml}</article>`

    // `tabs`, `commentable` e `comments` só existem quando se aplicam: as outras
    // páginas saem como antes.
    const tabs = families.tabsOf.get(stub.path)
    const page: PageMeta = { ...stub, html: fullHtml, css: pageCss.join('\n') }
    if (tabs) page.tabs = tabs
    if (commentable) {
      page.commentable = true
      const threads = loadThreads(stub.path)
      if (threads.length > 0) page.comments = threads
    }
    return page
  }

  // Conversas anexadas à nota `motherPath`, lidas do disco e já ordenadas. O corpo só
  // passa pelo render restrito de comentário, nunca pelo `renderBody` (dataviewjs).
  function loadThreads(motherPath: string): CommentThread[] {
    const refs = threadRefs.get(motherPath)
    if (!refs) return []
    const opts = { vaultSlug: vault.slug, resolveLink: (t: string) => linkResolver.resolve(t) }
    // Comentário que não dá para ler é pulado com um aviso: apagado entre a varredura e a
    // leitura (ENOENT) ou qualquer outro erro. Um arquivo de comentário nunca derruba o build.
    const load = (p: string): PageComment | null => {
      const file = files[fileIndex.get(p)!]
      let raw: string
      try {
        raw = fs.readFileSync(file.absolutePath, 'utf-8').replace(/\r\n/g, '\n')
      } catch (e) {
        console.warn(`[comments] ${p}: não consegui ler, fica de fora: ${(e as Error).message}`)
        return null
      }
      const { frontmatter, body } = extractFrontmatter(raw, file.title)
      return toPageComment({ path: p, frontmatter, body }, opts)
    }
    const threads: CommentThread[] = []
    for (const r of refs) {
      // Sem o principal, as respostas não têm onde aparecer: a conversa inteira sai.
      const comment = load(r.principal)
      if (!comment) continue
      const replies = r.replies.map(load).filter((c): c is PageComment => c !== null)
      threads.push({ comment, replies })
    }
    return sortThreads(threads)
  }

  // ── Frente: notas pedidas (--first) e alteradas desde o último build ────────
  // Comentário não gera página: não entra na frente, nem pedido, nem alterado. Mas o
  // tempo da mãe é o maior entre o dela e o dos comentários das conversas dela, para um
  // comentário alterado pôr a mãe na frente.
  // Comentário que sumiu (ENOENT) não conta; outro erro lança.
  const timeOf = (p: string): number => {
    try {
      return noteTime(fs.statSync(files[fileIndex.get(p)!].absolutePath))
    } catch (e) {
      if (isEnoent(e)) return 0
      throw e
    }
  }
  const noteTimes = files
    .filter(f => !families.noPage.has(f.relativePath))
    .map(f => {
      let t = noteTime(fs.statSync(f.absolutePath))
      for (const r of threadRefs.get(f.relativePath) ?? []) {
        for (const c of [r.principal, ...r.replies]) t = Math.max(t, timeOf(c))
      }
      return { path: f.relativePath, t }
    })
  const front = selectFirstPages(opts.first ?? [], noteTimes, prevScanMs)
  const rendered = new Map<number, PageMeta>()
  const alreadyWritten: string[] = []

  if (front.length > 0) {
    console.log(`[${vault.slug}] Na frente: ${front.length} páginas`)
    const summaries = toSummaries([
      ...stubs.filter(s => !families.hidden.has(s.path)),
      ...canvasFiles.map(c => ({ path: c.relativePath, title: c.title, tags: [] as string[] })),
    ])
    let prevAssets: string[] = []
    try {
      const prev: unknown = JSON.parse(fs.readFileSync(path.join(dataDir, 'assets.json'), 'utf-8'))
      if (Array.isArray(prev)) prevAssets = prev.filter((a): a is string => typeof a === 'string')
    } catch { /* sem assets.json anterior */ }

    for (let n = 0; n < front.length; n++) {
      const i = fileIndex.get(front[n])!
      const page = await renderPage(i)
      rendered.set(i, page)
      // assets.json antes da página: as imagens novas dela têm de abrir assim que ela aparecer.
      writeAssets(dataDir, [...new Set([...prevAssets, ...imageHandler.assets()])].sort())
      alreadyWritten.push(writePage(dataDir, page))
      if (n === 0) writeSummaries(dataDir, summaries)
    }
  }

  // Páginas de notas-filhas, pelo objeto: um canvas com o mesmo caminho de uma filha
  // (`X.md` e `X.canvas`) continua listado.
  const hiddenPages = new Set<PageMeta>()
  for (let i = 0; i < files.length; i++) {
    if (families.noPage.has(files[i].relativePath)) continue
    process.stdout.write(`\r[${vault.slug}] Processando ${i + 1}/${files.length}: ${files[i].title.slice(0, 40).padEnd(40)}`)
    const page = rendered.get(i) ?? await renderPage(i)
    if (families.hidden.has(page.path)) hiddenPages.add(page)
    pages.push(page)
  }

  process.stdout.write('\n')

  // ── Render dos canvases ─────────────────────────────────────────────────────
  for (const canvasFile of canvasFiles) {
    const jsonRaw = fs.readFileSync(canvasFile.absolutePath, 'utf-8')

    // Contexto neutro para o canvas: stub sintético + coletor de CSS próprio.
    const canvasCss: string[] = []
    const canvasStub: PageMeta = {
      path: canvasFile.relativePath,
      title: canvasFile.title,
      frontmatter: {},
      allFields: {},
      html: '',
      outlinks: [],
      tags: [],
      css: '',
    }
    const canvasRenderBody = makeRenderBody(canvasStub, canvasCss)

    const canvasHtml = await renderCanvas(
      jsonRaw,
      canvasRenderBody,
      p => imageHandler.resolve(p),
      linkResolver,
      vault.slug,
    )

    // Outlinks: texto dos nós + arquivos .md referenciados
    const { texts, mdFiles } = canvasTextSources(jsonRaw)
    const outlinkSet = new Set<string>()
    for (const t of texts) {
      for (const o of linkResolver.extractOutlinks(t)) outlinkSet.add(o)
    }
    for (const mdFile of mdFiles) {
      const title = mdFile.replace(/\.md$/i, '').split('/').pop() ?? mdFile
      const resolved = linkResolver.resolve(title)
      if (resolved) outlinkSet.add(resolved)
    }

    pages.push({
      path: canvasFile.relativePath,
      title: canvasFile.title,
      frontmatter: { cssclasses: 'wide-page' },
      allFields: {},
      html: '<article class="vault-content">' + canvasHtml + '</article>',
      outlinks: [...outlinkSet],
      tags: [],
      css: canvasCss.join('\n'),
    })
  }

  // ── Graph + Write ─────────────────────────────────────────────────────────
  // Árvore, busca e grafo só com as páginas listadas (sem as notas-filhas).
  const listed = pages.filter(p => !hiddenPages.has(p))
  const graph = buildGraph(listed)
  const builtAt = new Date().toISOString()
  writeOutput(
    vault.slug, pages, graph,
    { pageCount: pages.length, folderCount, builtAt, startedAt },
    opts.dataRoot,
    { assets: imageHandler.assets(), alreadyWritten, summaries: toSummaries(listed) },
  )

  console.log(`[${vault.slug}] Build concluído: ${pages.length} páginas, ${graph.edges.length} edges`)
}
