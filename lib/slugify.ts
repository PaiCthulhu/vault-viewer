/**
 * Turn a human name into a URL/data-key-safe slug.
 * Lowercase, strip diacritics, replace non-alphanumeric runs with a single
 * hyphen, and trim leading/trailing hyphens.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Derive a slug from `name` that is unique among `existing` slugs.
 * If the base slug is taken, append `-2`, `-3`, … until free.
 * Falls back to `vault` when slugify yields an empty string.
 */
export function uniqueSlug(name: string, existing: Iterable<string>): string {
  const taken = new Set(existing)
  const base = slugify(name) || 'vault'
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}
