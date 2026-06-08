import fs from 'fs'
import path from 'path'
import type { VaultConfig } from '@/types'
import type { PageMeta } from './types'
import { scanVault, scanCanvases, scanImages, countFolders } from './scanner'
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
import { writeOutput } from './writer'

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

export async function buildVault(vault: VaultConfig): Promise<void> {
  const publicAssetsDir = path.join(process.cwd(), 'public', 'vault-assets')

  console.log(`\n[${vault.slug}] Iniciando build de "${vault.name}"`)
  console.log(`[${vault.slug}] Vault path: ${vault.path}`)

  // ── Passe 1: Scan + frontmatter (sem renderização) ──────────────────────────
  // `.viewerignore` (sintaxe gitignore) na raiz do vault esconde arquivos/pastas.
  const ig = loadVaultIgnore(vault.path)
  const files = scanVault(vault.path, ig)
  const canvasFiles = scanCanvases(vault.path, ig)
  const imageIndex = scanImages(vault.path, ig)
  const folderCount = countFolders(vault.path, ig)
  // Canvas files entram no resolver para [[Página Inicial]] resolver, mas NÃO nos stubs.
  const linkResolver = new LinkResolver([...files, ...canvasFiles])
  const imageHandler = new ImageHandler(vault.path, vault.slug, publicAssetsDir, imageIndex)

  // Garante que a imagem de capa do vault seja copiada para public/vault-assets.
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
      md = md.replace(/^```dataviewjs[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm, (_, code) => {
        const { html, css: cssText } = executeDataviewJS(code, stubs, currentStub, vault.slug, p => imageHandler.resolve(p))
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

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const stub = stubs[i]
    process.stdout.write(`\r[${vault.slug}] Processando ${i + 1}/${files.length}: ${file.title.slice(0, 40).padEnd(40)}`)

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
    const propsHtml = renderProperties(stub.frontmatter, s => linkResolver.replaceWikilinks(s, vault.slug), p => imageHandler.resolve(p))

    const fullHtml = banner + `<article class="vault-content">${titleHtml}${propsHtml}${bodyHtml}</article>`

    pages.push({ ...stub, html: fullHtml, css: pageCss.join('\n') })
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
  const graph = buildGraph(pages)
  const builtAt = new Date().toISOString()
  writeOutput(vault.slug, pages, graph, { pageCount: pages.length, folderCount, builtAt })

  console.log(`[${vault.slug}] Build concluído: ${pages.length} páginas, ${graph.edges.length} edges`)
}
