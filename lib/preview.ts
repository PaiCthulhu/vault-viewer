// Pure helpers for building lightweight link previews from page HTML.
// Kept separate from the route handler so they can be unit-tested without
// pulling in Next.js server / DB modules.

const BG_URL_RE = /url\(['"]?([^'")]+)['"]?\)/
const BG_POSITION_RE = /background-position:\s*([^;"]+)/
const BANNER_END = '</h1></div>'

// Named entities decoded before numeric ones. `&amp;` is intentionally NOT
// here — it is decoded LAST (see decodeEntities) so that an input like
// `&amp;#8211;` doesn't get turned into a real `&#8211;` and then decoded.
const NAMED_ENTITIES: Record<string, string> = {
  '&ndash;': '–',
  '&mdash;': '—',
  '&hellip;': '…',
  '&nbsp;': ' ',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&rdquo;': '”',
  '&ldquo;': '“',
  '&laquo;': '«',
  '&raquo;': '»',
  '&eacute;': 'é',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&trade;': '™',
  '&copy;': '©',
  '&reg;': '®',
  '&middot;': '·',
  '&bull;': '•',
}

export function decodeEntities(s: string): string {
  let out = s
  // Named entities (excluding &amp;).
  for (const [entity, replacement] of Object.entries(NAMED_ENTITIES)) {
    out = out.split(entity).join(replacement)
  }
  // Numeric hex: &#xHHHH;
  out = out.replace(/&#[xX]([0-9a-fA-F]+);/g, (m, hex) => {
    try {
      return String.fromCodePoint(parseInt(hex, 16))
    } catch {
      return m
    }
  })
  // Numeric decimal: &#NNNN;
  out = out.replace(/&#(\d+);/g, (m, dec) => {
    try {
      return String.fromCodePoint(parseInt(dec, 10))
    } catch {
      return m
    }
  })
  // Decode &amp; LAST.
  out = out.split('&amp;').join('&')
  return out
}

export interface PreviewPayload {
  image: string | null
  imagePosition: string | null
  snippet: string
}

export function buildPreview(html: string): PreviewPayload {
  let image: string | null = null
  let imagePosition: string | null = null
  let bodyHtml = html

  // Banner background-image takes priority for the image.
  if (html.startsWith('<div class="vault-banner"')) {
    const bg = BG_URL_RE.exec(html)
    if (bg) image = bg[1]
    const pos = BG_POSITION_RE.exec(html)
    if (pos) imagePosition = pos[1].trim()
    const end = html.indexOf(BANNER_END)
    if (end !== -1) bodyHtml = html.slice(end + BANNER_END.length)
  }

  // Else: first vault-asset image in the page.
  if (!image) {
    const imgMatch = /<img[^>]+src="(\/vault-assets\/[^"]+)"/.exec(html)
    if (imgMatch) image = imgMatch[1]
  }

  // Snippet: drop the title heading and the collapsible "Propriedades" block
  // (it's metadata, not the page's prose), then strip tags, decode, collapse.
  const cleaned = bodyHtml
    .replace(/<details[^>]*class="vault-properties"[^>]*>[\s\S]*?<\/details>/i, ' ')
    .replace(/<h1[^>]*class="vault-page-title"[^>]*>[\s\S]*?<\/h1>/i, ' ')
  const text = decodeEntities(cleaned.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

  let snippet = text
  if (snippet.length > 320) {
    const slice = snippet.slice(0, 320)
    const lastSpace = slice.lastIndexOf(' ')
    snippet = (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trimEnd() + '…'
  }

  return { image, imagePosition, snippet }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Extracts the HTML of the section that starts at the heading with `sectionId`,
// up to (but not including) the next heading of the same or a higher level.
// Returns the heading's plain text plus the section body HTML, or null if the
// heading isn't found. Used for previewing `[[Page#Heading]]` links.
export function extractSection(
  html: string,
  sectionId: string,
): { heading: string; html: string } | null {
  const headOpen = new RegExp(`<h([1-6])\\b[^>]*\\bid="${escapeRegExp(sectionId)}"[^>]*>`, 'i')
  const m = headOpen.exec(html)
  if (!m) return null
  const level = Number(m[1])
  const openEnd = m.index + m[0].length

  // Heading text runs until its matching </hN>.
  const close = new RegExp(`</h${m[1]}>`, 'i').exec(html.slice(openEnd))
  const heading = decodeEntities(
    (close ? html.slice(openEnd, openEnd + close.index) : '').replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
  const bodyStart = close ? openEnd + close.index + close[0].length : openEnd

  // Section ends at the next heading whose level is <= this one's.
  const nextHead = /<h([1-6])\b/gi
  nextHead.lastIndex = bodyStart
  let end = html.length
  let nm: RegExpExecArray | null
  while ((nm = nextHead.exec(html)) !== null) {
    if (Number(nm[1]) <= level) {
      end = nm.index
      break
    }
  }

  return { heading, html: html.slice(bodyStart, end) }
}

// Like buildPreview but scoped to a single section (a `#heading` target). Returns
// null when the section heading doesn't exist, so callers can fall back to the
// whole-page preview.
export function buildSectionPreview(
  html: string,
  sectionId: string,
): (PreviewPayload & { heading: string }) | null {
  const section = extractSection(html, sectionId)
  if (!section) return null
  return { ...buildPreview(section.html), heading: section.heading }
}
