export type HtmlSegment =
  | { type: 'html'; html: string }
  | { type: 'banner'; html: string }
  | { type: 'dataview-table'; columns: string[]; rows: unknown[][]; vault: string }
  | { type: 'dataview-list'; items: unknown[]; vault: string }
  // Onde o viewer monta a faixa de comentários (o marcador que o builder deixa).
  | { type: 'comments' }

export interface ParseOptions {
  // Corta o HTML no marcador da faixa de comentários. Só o chamador sabe se a página é
  // comentável e se o vault tem comentários ligados; sem isso o marcador fica como está
  // (um div vazio).
  comments?: boolean
}

const DV_REGEX = /<div[^>]+class="dataview-result"([^>]*)><\/div>/g

// O mesmo texto de `COMMENTS_MARKER` (builder/comments.ts), repetido aqui porque aquele
// módulo carrega o render de markdown; um teste garante que os dois são iguais.
export const COMMENTS_SLOT = '<div class="vault-comments-slot"></div>'

const ARTICLE_OPEN = '<article class="vault-content">'
const PROPS_CLOSE = '</details>'

function attr(s: string, name: string): string {
  return (new RegExp(`data-${name}="([^"]*)"`).exec(s) ?? [])[1] ?? ''
}

// Posição do marcador da faixa, ou -1. O builder o escreve colado no fim do bloco de
// Propriedades, antes do corpo, então vale a primeira ocorrência nesse formato: a mesma
// string escrita no corpo de uma nota nunca é a escolhida.
function commentsSlotIndex(html: string): number {
  const article = html.indexOf(ARTICLE_OPEN)
  if (article === -1) return -1
  const anchor = html.indexOf(PROPS_CLOSE + COMMENTS_SLOT, article + ARTICLE_OPEN.length)
  return anchor === -1 ? -1 : anchor + PROPS_CLOSE.length
}

function pushDataviewSplit(segments: HtmlSegment[], html: string): void {
  let lastIndex = 0
  let match: RegExpExecArray | null

  DV_REGEX.lastIndex = 0
  while ((match = DV_REGEX.exec(html)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'html', html: html.slice(lastIndex, match.index) })
    }

    const full = match[0]
    const type = attr(full, 'type')
    const colsEnc = attr(full, 'columns')
    const resultB64 = attr(full, 'result')
    const vault = attr(full, 'vault')

    let columns: string[] = []
    let data: unknown = []
    try {
      columns = colsEnc ? JSON.parse(decodeURIComponent(colsEnc)) : []
      const decoded = resultB64
        ? Buffer.from(resultB64, 'base64').toString('utf-8')
        : '[]'
      data = JSON.parse(decoded)
    } catch {
      // Malformed dataview block — skip it
      lastIndex = match.index + match[0].length
      continue
    }

    if (type === 'table') {
      segments.push({ type: 'dataview-table', columns, rows: data as unknown[][], vault })
    } else {
      segments.push({ type: 'dataview-list', items: data as unknown[], vault })
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < html.length) {
    segments.push({ type: 'html', html: html.slice(lastIndex) })
  }
}

export function parseHtmlSegments(html: string, opts: ParseOptions = {}): HtmlSegment[] {
  const segments: HtmlSegment[] = []

  // The builder emits a fixed-shape banner at the very start of the page HTML:
  // <div class="vault-banner" style="…"><div class="vault-banner-gradient">
  // </div><h1 class="vault-banner-title">…</h1></div>. Extract it as its own
  // segment so it can render full-bleed, outside the constrained .vault-article.
  if (html.startsWith('<div class="vault-banner"')) {
    const end = html.indexOf('</h1></div>')
    if (end !== -1) {
      const close = end + '</h1></div>'.length
      segments.push({ type: 'banner', html: html.slice(0, close) })
      html = html.slice(close)
    }
  }

  const slot = opts.comments ? commentsSlotIndex(html) : -1
  if (slot === -1) {
    pushDataviewSplit(segments, html)
    return segments
  }

  pushDataviewSplit(segments, html.slice(0, slot))
  segments.push({ type: 'comments' })
  pushDataviewSplit(segments, html.slice(slot + COMMENTS_SLOT.length))
  return segments
}

// Os dois dão o mesmo resultado na tela? (O `ContentPanel` usa isto para não reaplicar o
// HTML num refresh que não mudou o conteúdo.)
export function sameSegments(a: HtmlSegment[], b: HtmlSegment[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((s, i) => {
    const o = b[i]
    if (s.type !== o.type) return false
    if (s.type === 'comments') return true
    if (s.type === 'html' || s.type === 'banner') return s.html === (o as typeof s).html
    return JSON.stringify(s) === JSON.stringify(o)
  })
}
