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
