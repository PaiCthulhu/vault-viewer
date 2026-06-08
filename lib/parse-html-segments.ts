export type HtmlSegment =
  | { type: 'html'; html: string }
  | { type: 'banner'; html: string }
  | { type: 'dataview-table'; columns: string[]; rows: unknown[][]; vault: string }
  | { type: 'dataview-list'; items: unknown[]; vault: string }

const DV_REGEX = /<div[^>]+class="dataview-result"([^>]*)><\/div>/g

function attr(s: string, name: string): string {
  return (new RegExp(`data-${name}="([^"]*)"`).exec(s) ?? [])[1] ?? ''
}

export function parseHtmlSegments(html: string): HtmlSegment[] {
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

  return segments
}
