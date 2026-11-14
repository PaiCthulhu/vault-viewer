// A gallery that is the whole body of a collapsible group — a <details> callout,
// with Obsidian's `.callout-content` (what a DataviewJS view emits) or the
// builder's `.vault-callout-content` — belongs to that group: the filter bar
// hides the group with the gallery and is inserted above the group, never
// inside it. Returns that <details>, or null when the gallery stands alone.
export function galleryGroup(gallery: Element): HTMLElement | null {
  const body = gallery.parentElement
  const group = body?.parentElement
  if (!body || !group || group.tagName !== 'DETAILS') return null
  if (body.childElementCount !== 1) return null
  if (!body.classList.contains('callout-content') && !body.classList.contains('vault-callout-content')) return null
  return group
}
