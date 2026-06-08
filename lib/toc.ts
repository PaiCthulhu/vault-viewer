export interface TocEntry {
  level: number
  id: string
  text: string
}

// Matches an opening heading tag, its attributes, and the inner HTML up to the
// matching closing tag of the same level. Non-greedy inner capture; headings do
// not nest in well-formed rehype output, so this is safe.
const HEADING_RE = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi

const ID_RE = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
const CLASS_RE = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i

const SKIP_CLASSES = ['vault-page-title', 'vault-banner-title']

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
}

function attrValue(match: RegExpMatchArray | null): string | null {
  if (!match) return null
  return match[1] ?? match[2] ?? match[3] ?? null
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, m => ENTITY_MAP[m])
}

function extractText(innerHtml: string): string {
  const stripped = innerHtml.replace(/<[^>]*>/g, '')
  return decodeEntities(stripped).replace(/\s+/g, ' ').trim()
}

export function extractToc(html: string): TocEntry[] {
  const entries: TocEntry[] = []
  if (!html) return entries

  for (const match of html.matchAll(HEADING_RE)) {
    const level = Number(match[1])
    const attrs = match[2] ?? ''
    const inner = match[3] ?? ''

    // Skip the page/banner title headings.
    const className = attrValue(CLASS_RE.exec(attrs)) ?? ''
    const classes = className.split(/\s+/)
    if (SKIP_CLASSES.some(c => classes.includes(c))) continue

    // Only anchorable headings (those with an id) qualify.
    const id = attrValue(ID_RE.exec(attrs))
    if (!id) continue

    const text = extractText(inner)
    if (!text) continue

    entries.push({ level, id, text })
  }

  return entries
}
