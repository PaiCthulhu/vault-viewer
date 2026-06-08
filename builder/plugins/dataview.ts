import vm from 'vm'
import type { PageMeta } from '../types'

// ─── DQL ─────────────────────────────────────────────────────────────────────

interface ParsedDQLCol {
  field: string
  label: string
}

interface ParsedDQL {
  type: 'TABLE' | 'LIST' | 'TASK' | 'UNKNOWN'
  columns: ParsedDQLCol[]
  from: string | null
  where: string | null
  sort: { field: string; direction: 'ASC' | 'DESC' } | null
  limit: number | null
}

function parseDQL(query: string): ParsedDQL {
  const typeMatch = /^\s*(TABLE|LIST|TASK)\b/i.exec(query)
  const type = (typeMatch?.[1]?.toUpperCase() ?? 'UNKNOWN') as ParsedDQL['type']

  const fromMatch = /\bFROM\s+"([^"]+)"/i.exec(query)
  const from = fromMatch?.[1] ?? null

  const whereMatch = /\bWHERE\s+([\s\S]+?)(?:\bSORT\b|\bLIMIT\b|$)/i.exec(query)
  const where = whereMatch?.[1]?.trim() ?? null

  const sortMatch = /\bSORT\s+(\S+)\s+(ASC|DESC)/i.exec(query)
  const sort = sortMatch
    ? { field: sortMatch[1], direction: sortMatch[2].toUpperCase() as 'ASC' | 'DESC' }
    : null

  const limitMatch = /\bLIMIT\s+(\d+)/i.exec(query)
  const limit = limitMatch ? parseInt(limitMatch[1], 10) : null

  // Parse TABLE columns: between TABLE and FROM
  let columns: ParsedDQLCol[] = []
  if (type === 'TABLE') {
    const colsRaw = query.replace(/^\s*TABLE\b/i, '').split(/\bFROM\b/i)[0].trim()
    if (colsRaw) {
      columns = colsRaw.split(',').map(c => {
        const asMatch = /(.+?)\s+AS\s+"([^"]+)"/i.exec(c.trim())
        if (asMatch) return { field: asMatch[1].trim(), label: asMatch[2] }
        const field = c.trim()
        return { field, label: field }
      })
    }
  }

  return { type, columns, from, where, sort, limit }
}

function evaluateWhere(page: PageMeta, clause: string): boolean {
  // Extract individual contains() predicates, ignoring AND/OR within quoted strings
  const predicateRx = /(!?)contains\s*\(\s*([^,]+?)\s*,\s*"([^"]+)"\s*\)/gi
  const predicates: Array<{ negated: boolean; field: string; value: string; op: 'AND' | 'OR' }> = []

  // Find all predicates and the operators between them
  let lastIdx = 0
  let m: RegExpExecArray | null
  predicateRx.lastIndex = 0
  while ((m = predicateRx.exec(clause)) !== null) {
    // Look for AND/OR between lastIdx and this match's start
    const between = clause.slice(lastIdx, m.index).trim().toUpperCase()
    const op: 'AND' | 'OR' = between.includes('OR') ? 'OR' : 'AND'
    predicates.push({ negated: m[1] === '!', field: m[2].trim(), value: m[3], op })
    lastIdx = m.index + m[0].length
  }

  if (predicates.length === 0) return true

  let result = false
  let initialized = false
  for (const pred of predicates) {
    const raw = page.allFields[pred.field] ?? page.frontmatter[pred.field] ?? page.tags
    const arr = Array.isArray(raw) ? raw.map(String) : [String(raw ?? '')]
    const found = arr.some(v => v.toLowerCase().includes(pred.value.toLowerCase()))
    const match = pred.negated ? !found : found

    if (!initialized) {
      result = match
      initialized = true
    } else {
      result = pred.op === 'OR' ? result || match : result && match
    }
  }
  return result
}

function filterPages(pages: PageMeta[], parsed: ParsedDQL): PageMeta[] {
  let result = [...pages]
  if (parsed.from) {
    result = result.filter(p => p.path.startsWith(parsed.from!))
  }
  if (parsed.where) {
    result = result.filter(p => evaluateWhere(p, parsed.where!))
  }
  if (parsed.sort) {
    const { field, direction } = parsed.sort
    result.sort((a, b) => {
      const av = String(a.allFields[field] ?? a.frontmatter[field] ?? '')
      const bv = String(b.allFields[field] ?? b.frontmatter[field] ?? '')
      return direction === 'ASC' ? av.localeCompare(bv, 'pt-BR') : bv.localeCompare(av, 'pt-BR')
    })
  }
  if (parsed.limit) result = result.slice(0, parsed.limit)
  return result
}

export function executeDQL(query: string, allPages: PageMeta[], vaultSlug: string): string {
  const parsed = parseDQL(query)
  const filtered = filterPages(allPages, parsed)

  if (parsed.type === 'TABLE') {
    const dataset = filtered.map(p => ({ ...p.allFields, title: p.title, path: p.path, tags: p.tags }))
    const encoded = Buffer.from(JSON.stringify(dataset)).toString('base64')
    const colLabels = parsed.columns.map(c => c.label)
    const colsEncoded = encodeURIComponent(JSON.stringify(colLabels))
    return `<div class="dataview-result" data-type="table" data-columns="${colsEncoded}" data-result="${encoded}" data-vault="${vaultSlug}"></div>`
  }

  if (parsed.type === 'LIST') {
    const dataset = filtered.map(p => ({ title: p.title, path: p.path }))
    const encoded = Buffer.from(JSON.stringify(dataset)).toString('base64')
    return `<div class="dataview-result" data-type="list" data-result="${encoded}" data-vault="${vaultSlug}"></div>`
  }

  return `<div class="dataview-result" data-type="task" data-vault="${vaultSlug}"><p class="text-muted">TASK queries não implementadas</p></div>`
}

// ─── DataviewJS ───────────────────────────────────────────────────────────────

type DvArray<T> = Omit<T[], 'sort' | 'values'> & {
  where(fn: (x: T) => boolean): DvArray<T>
  sort(keyFn: (x: T) => unknown, dir?: 'asc' | 'desc'): DvArray<T>
  limit(n: number): DvArray<T>
  array(): T[]
  values: T[]
}

function makeDvArray<T>(arr: T[]): DvArray<T> {
  const base = [...arr] as unknown as DvArray<T>
  base.where = function (fn: (x: T) => boolean): DvArray<T> {
    return makeDvArray(arr.filter(fn))
  }
  base.sort = function (keyFn: (x: T) => unknown, dir: 'asc' | 'desc' = 'asc'): DvArray<T> {
    return makeDvArray([...arr].sort((a, b) => {
      const av = String(keyFn(a) ?? '')
      const bv = String(keyFn(b) ?? '')
      return dir === 'asc' ? av.localeCompare(bv, 'pt-BR') : bv.localeCompare(av, 'pt-BR')
    }))
  }
  base.limit = function (n: number): DvArray<T> {
    return makeDvArray(arr.slice(0, n))
  }
  // Dataview's DataArray.array() returns a plain JS array copy (no DvArray methods).
  base.array = function (): T[] {
    return [...arr]
  }
  // `.values` is an alias for the underlying plain array.
  Object.defineProperty(base, 'values', {
    get() {
      return [...arr]
    },
    enumerable: false,
    configurable: true,
  })
  return base
}

function pageToProxy(p: PageMeta, vaultSlug: string): Record<string, unknown> {
  const lastSlash = p.path.lastIndexOf('/')
  const folder = lastSlash === -1 ? '' : p.path.slice(0, lastSlash)
  return {
    file: {
      name: p.title,
      path: p.path,
      folder,
      ext: 'md',
      link: `<a href="/vault/${vaultSlug}/${encodeURIComponent(p.path).replace(/%2F/gi, '/')}">${p.title}</a>`,
      tags: p.tags,
    },
    ...p.allFields,
    tags: p.tags,
  }
}

// Rewrites <a class="...internal-link...">'s href (a raw vault path emitted by
// dataviewjs card builders) into a real viewer URL. Hrefs already starting with
// '/' or 'http' are left untouched.
// Decodes the HTML entities the El serializer emits in attribute values, so the
// raw vault path is recovered before URL-encoding. `&amp;` is decoded LAST to
// avoid double-decoding (e.g. `&amp;lt;` must not become `<`).
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function rewriteInternalLinks(html: string, vaultSlug: string): string {
  return html.replace(/<a\b[^>]*>/gi, (tag) => {
    const classMatch = /\bclass="([^"]*)"/i.exec(tag)
    if (!classMatch || !/\binternal-link\b/.test(classMatch[1])) return tag
    // Match a standalone `href` attribute (preceded by whitespace), not
    // `data-href` which also ends in "href".
    return tag.replace(/(\s)href="([^"]*)"/i, (full, ws: string, href: string) => {
      if (!href || href.startsWith('/') || /^https?:/i.test(href)) return full
      // The href arrives HTML-escaped (e.g. `&amp;` for `&`); decode entities
      // first so encodeURIComponent sees the real path characters.
      const decoded = decodeHtmlEntities(href)
      const encoded = decoded.split('/').map(encodeURIComponent).join('/')
      return `${ws}href="/vault/${vaultSlug}/${encoded}"`
    })
  })
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(renderCell).join(', ')
  return String(value)
}

// ─── Card filter-prop stamping ─────────────────────────────────────────────────

// Keys never useful for Notion-style filtering (cover art, ids, timestamps, etc.).
const EXCLUDED_PROP_KEYS = /^(cover|cover_y|banner_height|notion-id|ID|Created|cssclasses|Galeria|Ilustração|URL)$/i

// Strips wikilink syntax from a single scalar value and returns a trimmed string.
// `[[Path/To/X]]` -> `X` (last path segment); `[[X|Alias]]` -> `Alias`.
function normalizePropValue(value: string | number | boolean): string {
  let s = typeof value === 'string' ? value : String(value)
  const wiki = /^\[\[([\s\S]+?)\]\]$/.exec(s.trim())
  if (wiki) {
    const inner = wiki[1]
    const pipeIdx = inner.indexOf('|')
    if (pipeIdx !== -1) {
      s = inner.slice(pipeIdx + 1)
    } else {
      const target = inner.split('#')[0]
      const seg = target.split('/')
      s = seg[seg.length - 1]
    }
  }
  return s.trim()
}

function isScalar(v: unknown): v is string | number | boolean {
  const t = typeof v
  return t === 'string' || t === 'number' || t === 'boolean'
}

// Returns true when a scalar should be included (non-empty string ≤ 60 chars,
// any number, any boolean).
function scalarIncludable(v: string | number | boolean): boolean {
  if (typeof v === 'string') return v.length > 0 && v.length <= 60
  return true
}

// Builds the compact filterable-prop map for a page: each kept field becomes an
// array of normalized strings. Includes `Tags` from page.tags.
export function filterableProps(page: PageMeta): Record<string, string[]> {
  const source: Record<string, unknown> = { ...page.allFields, Tags: page.tags }
  const out: Record<string, string[]> = {}

  for (const [key, raw] of Object.entries(source)) {
    if (EXCLUDED_PROP_KEYS.test(key)) continue

    let values: string[] | null = null
    if (Array.isArray(raw)) {
      if (raw.length === 0 || raw.length > 10) continue
      const kept: string[] = []
      for (const item of raw) {
        if (!isScalar(item) || !scalarIncludable(item)) continue
        const norm = normalizePropValue(item)
        if (norm) kept.push(norm)
      }
      if (kept.length > 0) values = kept
    } else if (isScalar(raw)) {
      if (!scalarIncludable(raw)) continue
      const norm = normalizePropValue(raw)
      if (norm) values = [norm]
    }

    if (values && values.length > 0) out[key] = values
  }

  // Final safety cap: if the JSON is too large, drop the largest fields until
  // it fits under ~2000 chars.
  const CAP = 2000
  while (JSON.stringify(out).length > CAP) {
    let largestKey: string | null = null
    let largestLen = -1
    for (const [k, v] of Object.entries(out)) {
      const len = JSON.stringify(v).length
      if (len > largestLen) {
        largestLen = len
        largestKey = k
      }
    }
    if (!largestKey) break
    delete out[largestKey]
  }

  return out
}

// True when `className` contains `cls` as a whitespace-delimited token (so
// `dv-card` does NOT match `dv-card-name`).
function hasClass(className: string, cls: string): boolean {
  return className.split(/\s+/).includes(cls)
}

// Stamps `data-props` on a single .dv-card element (resolved via a descendant
// internal-link's raw vault path) and recurses into all of its descendants. Safe
// to call on any node — non-card nodes are simply walked through.
function stampCards(el: El, pagesByPath: Map<string, PageMeta>): void {
  if (hasClass(el.className, 'dv-card')) {
    const rawPath = findInternalLinkHref(el)
    if (rawPath) {
      const page = pagesByPath.get(rawPath)
      if (page) {
        const props = filterableProps(page)
        if (Object.keys(props).length > 0) {
          el.attrs['data-props'] = encodeURIComponent(JSON.stringify(props))
        }
      }
    }
  }
  for (const child of el.children) stampCards(child, pagesByPath)
}

// Finds the first descendant whose className includes `internal-link` and
// returns its raw vault path (data-href preferred, then href). Returns null when
// none is found.
function findInternalLinkHref(el: El): string | null {
  const stack: El[] = [...el.children]
  while (stack.length > 0) {
    const node = stack.shift()!
    if (hasClass(node.className, 'internal-link')) {
      const raw = node.attrs['data-href'] ?? node.attrs['href']
      if (raw) return decodeHtmlEntities(raw)
    }
    stack.push(...node.children)
  }
  return null
}

// ─── DOM-ish element shim ──────────────────────────────────────────────────────

const VOID_ELEMENTS = new Set(['img', 'br', 'hr', 'input'])

interface ElOpts {
  cls?: string
  text?: string
  attr?: Record<string, string | number | boolean>
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

class El {
  tagName: string
  id = ''
  className = ''
  textContent = ''
  innerHTML = ''
  children: El[] = []
  attrs: Record<string, string> = {}

  constructor(tag: string) {
    this.tagName = tag
  }

  createEl(tag: string, opts?: ElOpts): El {
    const el = new El(tag)
    if (opts?.cls) el.className = opts.cls
    if (opts?.text) el.textContent = opts.text
    if (opts?.attr) {
      for (const [k, v] of Object.entries(opts.attr)) el.attrs[k] = String(v)
    }
    this.children.push(el)
    return el
  }

  createDiv(opts?: ElOpts): El {
    return this.createEl('div', opts)
  }

  createSpan(opts?: ElOpts): El {
    return this.createEl('span', opts)
  }

  appendChild(el: El): El {
    this.children.push(el)
    return el
  }

  setAttribute(name: string, value: string | number | boolean): void {
    this.attrs[name] = String(value)
  }

  // Obsidian HTMLElement helpers used by gallery scripts.
  empty(): void {
    this.children = []
    this.textContent = ''
    this.innerHTML = ''
  }

  setText(text: string): void {
    this.textContent = text
    this.children = []
    this.innerHTML = ''
  }

  // No-op DOM event API: build-time HTML has no runtime listeners, but many
  // gallery scripts call addEventListener on created cards. Swallow it.
  addEventListener(): void {}
  removeEventListener(): void {}

  toHTML(): string {
    const tag = this.tagName
    const attrParts: string[] = []
    if (this.id) attrParts.push(`id="${escapeAttr(this.id)}"`)
    if (this.className) attrParts.push(`class="${escapeAttr(this.className)}"`)
    for (const [k, v] of Object.entries(this.attrs)) {
      attrParts.push(`${k}="${escapeAttr(v)}"`)
    }
    const attrStr = attrParts.length ? ' ' + attrParts.join(' ') : ''

    if (VOID_ELEMENTS.has(tag)) {
      return `<${tag}${attrStr}>`
    }

    let content: string
    if (this.innerHTML) {
      content = this.innerHTML
    } else {
      content = (this.textContent ? escapeHtml(this.textContent) : '') +
        this.children.map(c => c.toHTML()).join('')
    }
    return `<${tag}${attrStr}>${content}</${tag}>`
  }

  childrenHTML(): string {
    return this.children.map(c => c.toHTML()).join('')
  }
}

interface DvApp {
  metadataCache: {
    getFirstLinkpathDest(linkpath: string, sourcePath: string): { path: string; name: string } | null
  }
  vault: {
    adapter: { getResourcePath(filePath: string): string }
    getResourcePath(file: { path: string }): string
    getFileByPath(filePath: string): { path: string; name: string } | null
  }
  workspace: { openLinkText(linktext: string, sourcePath: string): void }
}

function createDvContext(
  allPages: PageMeta[],
  current: PageMeta,
  vaultSlug: string,
  resolveImage: (p: string) => string,
) {
  const capturedCss: string[] = []

  // Single ordered output sink: every dv.* call appends to `container` in call
  // order, exactly like Obsidian (where dv.header/dv.el/container.createEl all
  // attach to the same block element). Using a separate buffer for dv.el/header
  // vs dv.container would scramble order when a script interleaves them — e.g.
  // `dv.el(sectionTitle)` then `dv.container.createEl(gallery)` would render all
  // titles first, then all galleries.
  const container = new El('div')
  const body = new El('body')

  const dv = {
    container,
    pages(query?: string) {
      let filtered = allPages
      if (query) {
        const q = query.trim()
        if (q.startsWith('"') && q.endsWith('"')) {
          const folder = q.slice(1, -1)
          filtered = allPages.filter(p => p.path.startsWith(folder))
        } else if (q.startsWith('#')) {
          const tag = q.slice(1)
          filtered = allPages.filter(p => p.tags.includes(tag))
        }
      }
      return makeDvArray(filtered.map(p => pageToProxy(p, vaultSlug)))
    },
    current() { return pageToProxy(current, vaultSlug) },
    table(cols: string[], rows: unknown[][]) {
      // Emite o MESMO placeholder que executeDQL usa, para o componente cliente
      // interativo (DataviewTable: filtro + ordenação) hidratar. Cada célula é
      // normalizada via renderCell e tem os internal-links reescritos ANTES do
      // base64 — o rewrite final de executeDataviewJS NÃO cobre o payload base64.
      const normRows = rows.map(r =>
        (Array.isArray(r) ? r : [r]).map(c => rewriteInternalLinks(renderCell(c), vaultSlug)),
      )
      const encoded = Buffer.from(JSON.stringify(normRows)).toString('base64')
      const colsEncoded = encodeURIComponent(JSON.stringify(cols))
      const el = container.createEl('div', { cls: 'dataview-result' })
      el.attrs['data-type'] = 'table'
      el.attrs['data-columns'] = colsEncoded
      el.attrs['data-result'] = encoded
      el.attrs['data-vault'] = vaultSlug
    },
    list(items: unknown[]) {
      // Mesmo placeholder (data-type="list"). O componente cliente DataviewList
      // renderiza cada item via dangerouslySetInnerHTML, então emitimos strings
      // já renderizadas (com internal-links reescritos antes do base64).
      const normItems = items.map(i => rewriteInternalLinks(renderCell(i), vaultSlug))
      const encoded = Buffer.from(JSON.stringify(normItems)).toString('base64')
      const el = container.createEl('div', { cls: 'dataview-result' })
      el.attrs['data-type'] = 'list'
      el.attrs['data-result'] = encoded
      el.attrs['data-vault'] = vaultSlug
    },
    header(level: number, text: string) {
      const h = container.createEl(`h${level}`, { cls: 'dataview-header' })
      h.innerHTML = text
    },
    paragraph(text: string) {
      const p = container.createEl('p')
      p.innerHTML = text
    },
    // Returns the created element (like Obsidian's dv.el) so scripts can keep
    // mutating it — e.g. `.empty()`, `.createEl(...)`, `.setText(...)`.
    el(tag: string, content: string, opts?: { cls?: string }): El {
      const el = container.createEl(tag, { cls: opts?.cls })
      if (content) el.textContent = content
      return el
    },
    span(text: string) {
      const s = container.createEl('span')
      s.innerHTML = text
    },
  }

  // Tracks elements that should be discoverable via getElementById:
  // head children + any element created with an id.
  const head = new El('head')
  const trackedById = new Map<string, El>()

  const document = {
    createElement(tag: string): El {
      return new El(tag)
    },
    getElementById(id: string): El | null {
      return trackedById.get(id) ?? null
    },
    head: {
      appendChild(el: El): El {
        head.children.push(el)
        if (el.id) trackedById.set(el.id, el)
        if (el.tagName === 'style') {
          capturedCss.push(String(el.innerHTML || el.textContent || ''))
        }
        return el
      },
    },
    body,
  }

  const app: DvApp = {
    metadataCache: {
      getFirstLinkpathDest(linkpath: string, _sourcePath: string) {
        const cleaned = linkpath
          .replace(/^\[\[/, '')
          .replace(/\]\]$/, '')
          .split('|')[0]
          .split('#')[0]
          .trim()
        if (!cleaned) return null
        return { path: cleaned, name: cleaned.split('/').pop() as string }
      },
    },
    vault: {
      adapter: {
        getResourcePath(filePath: string) {
          return resolveImage(filePath)
        },
      },
      getResourcePath(file: { path: string }) {
        return resolveImage(file.path)
      },
      getFileByPath(filePath: string) {
        const cleaned = String(filePath ?? '').trim()
        if (!cleaned) return null
        return { path: cleaned, name: cleaned.split('/').pop() as string }
      },
    },
    workspace: {
      // No-op at build time: navigation happens client-side via rendered links.
      openLinkText() {},
    },
  }

  // Build a path→page lookup once per execution for card prop stamping.
  const pagesByPath = new Map<string, PageMeta>()
  for (const p of allPages) pagesByPath.set(p.path, p)

  return {
    dv,
    document,
    app,
    getOutput: () => {
      // Everything (dv.el/header/paragraph/span/table/list + container.createEl)
      // lives in `container` in call order, so serialize it directly. `body` is
      // appended after for the few scripts that touch document.body.
      stampCards(container, pagesByPath)
      stampCards(body, pagesByPath)
      const parts: string[] = []
      const containerHtml = container.childrenHTML()
      if (containerHtml) parts.push(containerHtml)
      const bodyHtml = body.childrenHTML()
      if (bodyHtml) parts.push(bodyHtml)
      return parts.join('\n')
    },
    getCss: () => capturedCss.join('\n'),
  }
}

export function executeDataviewJS(
  code: string,
  allPages: PageMeta[],
  current: PageMeta,
  vaultSlug: string,
  resolveImage: (p: string) => string,
): { html: string; css: string } {
  const { dv, document, app, getOutput, getCss } = createDvContext(
    allPages,
    current,
    vaultSlug,
    resolveImage,
  )
  try {
    vm.runInNewContext(code, {
      dv,
      document,
      app,
      console,
      Math,
      JSON,
      Array,
      Object,
      String,
      Number,
      Set,
      Map,
      RegExp,
    })
  } catch (err) {
    return { html: `<div class="dataview-error">DataviewJS error: ${err}</div>`, css: '' }
  }
  return { html: rewriteInternalLinks(getOutput(), vaultSlug), css: getCss() }
}
