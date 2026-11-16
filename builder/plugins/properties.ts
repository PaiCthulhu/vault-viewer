// Renders a page's frontmatter as a collapsible "Propriedades" block (key on the
// left, value on the right), Obsidian-style. Wikilink values become real links,
// http(s) URL values become external links, and image-valued wikilinks/paths
// become clickable lightbox thumbnails.

// Presentation/internal keys that shouldn't appear in the properties list.
// `tab_label` is the mother note's label in the tab bar (see builder/note-family.ts).
const HIDDEN_PROP_KEYS = /^(cover|cover_y|banner|banner_height|cssclasses|notion-id|tab_label)$/i
// Child-note format fields: hidden only on a note whose `note_type` is recognized
// (tab or comment). On any other note they are ordinary properties.
const FAMILY_PROP_KEYS = new Set(['parent', 'note_type', 'order'])

// Matches an image wikilink `[[path/to/img.png]]` or `[[img.png|alias]]`.
const IMAGE_WIKILINK_RE = /^\[\[(.+\.(?:png|jpe?g|gif|webp|svg|avif))(?:\|[^\]]*)?\]\]$/i
// Matches a bare image path (no brackets) ending in an image extension.
const IMAGE_PATH_RE = /^.+\.(?:png|jpe?g|gif|webp|svg|avif)$/i

// A value that is, as a whole, an http(s) URL. Obsidian has no "URL" property
// type: a text property whose value is a URL is simply shown as a clickable link.
const URL_RE = /^https?:\/\/\S+$/

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;')
}

// Formats a date value (Date object from YAML, or an ISO-ish string) as pt-BR
// `dd/MM/yyyy HH:mm` (date + time, no timezone). Returns null when not a date.
// Uses the literal/UTC components so a YAML timestamp like 2024-01-12T23:27:00
// shows exactly 12/01/2024 23:27 regardless of the build machine's timezone.
function formatDate(v: unknown): string | null {
  const pad = (n: number) => String(n).padStart(2, '0')
  if (v instanceof Date && !isNaN(v.getTime())) {
    const date = `${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`
    const hasTime = v.getUTCHours() || v.getUTCMinutes() || v.getUTCSeconds()
    return hasTime ? `${date} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}` : date
  }
  if (typeof v === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(v.trim())
    if (m) {
      const [, y, mo, da, h, mi] = m
      return h != null ? `${da}/${mo}/${y} ${h}:${mi}` : `${da}/${mo}/${y}`
    }
  }
  return null
}

// Renders a single scalar value: image wikilinks/paths become lightbox thumbnail
// `<img>` elements; non-image wikilinks (`[[X]]`, `[[X|Alias]]`) are resolved to
// links; plain text is HTML-escaped. Vault content is trusted.
function renderScalar(
  v: unknown,
  replaceWikilinks: (s: string) => string,
  resolveImage: (p: string) => string,
): string {
  if (v == null) return ''
  // Unquoted YAML true/false — Obsidian's Checkbox type. Read-only, same markup
  // as a rendered task list item.
  if (typeof v === 'boolean') {
    return `<input type="checkbox" class="vault-prop-checkbox"${v ? ' checked' : ''} disabled>`
  }
  const dateStr = formatDate(v)
  if (dateStr) return escapeHtml(dateStr)
  const s = String(v).trim()
  if (s === '') return ''

  // URL → external link (before the image checks: a URL ending in .png is not a
  // vault image). The viewer opens http(s) links in a new tab.
  if (URL_RE.test(s)) {
    const url = escapeAttr(s)
    return `<a href="${url}">${url}</a>`
  }

  // Image wikilink: extract the inner path (before any `|alias`) → thumbnail.
  const wl = IMAGE_WIKILINK_RE.exec(s)
  if (wl) {
    const url = resolveImage(wl[1])
    return `<img class="vault-prop-thumb" src="${encodeURI(url)}" alt="" />`
  }
  // Bare image path (no brackets) → thumbnail.
  if (!s.includes('[[') && IMAGE_PATH_RE.test(s)) {
    const url = resolveImage(s)
    return `<img class="vault-prop-thumb" src="${encodeURI(url)}" alt="" />`
  }

  return s.includes('[[') ? replaceWikilinks(s) : escapeHtml(s)
}

function renderValue(
  raw: unknown,
  replaceWikilinks: (s: string) => string,
  resolveImage: (p: string) => string,
): string {
  if (Array.isArray(raw)) {
    const items = raw.map(v => renderScalar(v, replaceWikilinks, resolveImage)).filter(Boolean)
    if (items.length === 0) return ''
    // All-thumbnail value → gallery strip (no separator); otherwise comma join.
    const allThumbs = items.every(i => i.startsWith('<img ') && i.includes('class="vault-prop-thumb"'))
    return items.join(allThumbs ? '' : ', ')
  }
  return renderScalar(raw, replaceWikilinks, resolveImage)
}

export function renderProperties(
  frontmatter: Record<string, unknown>,
  replaceWikilinks: (s: string) => string,
  resolveImage: (p: string) => string,
  opts: { familyNote?: boolean } = {},
): string {
  const rows: string[] = []
  for (const [key, raw] of Object.entries(frontmatter)) {
    if (HIDDEN_PROP_KEYS.test(key)) continue
    if (opts.familyNote && FAMILY_PROP_KEYS.has(key)) continue
    const valHtml = renderValue(raw, replaceWikilinks, resolveImage)
    if (!valHtml) continue
    rows.push(
      `<div class="vault-prop">` +
        `<span class="vault-prop-key">${escapeHtml(key)}</span>` +
        `<span class="vault-prop-val">${valHtml}</span>` +
        `</div>`,
    )
  }
  if (rows.length === 0) return ''
  return (
    `<details class="vault-properties">` +
    `<summary class="vault-properties-summary">` +
    `<span class="vault-properties-chevron">▸</span>` +
    // Built statically here; the viewer re-labels [data-i18n] nodes client-side
    // per the user's locale (default English is the in-HTML fallback).
    `<span data-i18n="properties.title">Properties</span>` +
    `</summary>` +
    `<div class="vault-properties-body">${rows.join('')}</div>` +
    `</details>`
  )
}
