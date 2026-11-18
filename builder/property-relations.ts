// Índice das listas de relação (`relation` no `.vaultwright`): para cada chave usada, as
// notas da pasta que o editor oferece e o que cada item já usado resolve.
import type { LinkResolver } from './link-resolver'
import { compareText } from './plugins/properties'
import { lookupRelationFolder, type PropertyConfig } from './property-types'
import type { PageMeta, RelationCandidate, RelationEntry } from './types'
import { wikilinkLabel, wikilinkTarget } from '../lib/wikilink-label'

type NoteRef = { path: string; title: string }
type Resolver = Pick<LinkResolver, 'resolve'>

// O link só vale se, lido de volta, leva à própria nota.
function linkTo(note: NoteRef, resolver: Resolver): string | null {
  for (const name of [note.title, note.path]) {
    const link = `[[${name}]]`
    if (wikilinkTarget(link) === name && resolver.resolve(name) === note.path) return link
  }
  return null
}

/** Notas listadas da pasta (subpastas incluídas, caixa ignorada), em ordem pt-BR do nome mostrado. */
export function relationCandidates(
  notes: readonly NoteRef[],
  folder: string,
  resolver: Resolver,
  warn: (msg: string) => void,
): RelationCandidate[] {
  const prefix = folder.toLowerCase() + '/'
  const out: RelationCandidate[] = []
  for (const note of notes) {
    if (!note.path.toLowerCase().startsWith(prefix)) continue
    const link = linkTo(note, resolver)
    if (!link) {
      warn(`.vaultwright/properties.json: nenhum link leva à nota "${note.path}"; fora da relation`)
      continue
    }
    out.push({ link, label: wikilinkLabel(link) ?? note.title, path: note.path })
  }
  return out.sort((a, b) => compareText(a.label, b.label) || compareText(a.path, b.path))
}

export function collectPropertyRelations(
  pages: Pick<PageMeta, 'properties'>[],
  notes: readonly NoteRef[],
  config: PropertyConfig,
  resolver: Resolver,
  warn: (msg: string) => void = console.warn,
): Record<string, RelationEntry> {
  // Uma vez por pasta: várias chaves podem apontar para a mesma.
  const cache = new Map<string, RelationCandidate[]>()
  const candidatesOf = (folder: string) => {
    let c = cache.get(folder)
    if (!c) cache.set(folder, (c = relationCandidates(notes, folder, resolver, warn)))
    return c
  }

  for (const [key, folder] of config.relation) {
    if (candidatesOf(folder).length === 0) {
      warn(`.vaultwright/properties.json: "${key}": nenhuma nota na pasta "${folder}"`)
    }
  }

  const used = new Map<string, Set<string>>()
  for (const page of pages) {
    for (const row of page.properties ?? []) {
      if (!row.relation || row.locked) continue
      let items = used.get(row.key)
      if (!items) used.set(row.key, (items = new Set()))
      if (Array.isArray(row.value)) for (const item of row.value) if (typeof item === 'string') items.add(item)
    }
  }

  const out: Record<string, RelationEntry> = {}
  for (const key of [...used.keys()].sort(compareText)) {
    const folder = lookupRelationFolder(config, key)
    if (folder === undefined) continue
    const candidates = candidatesOf(folder)
    const paths = new Set(candidates.map(c => c.path))
    const pairs: [string, string][] = []
    for (const item of [...(used.get(key) as Set<string>)].sort(compareText)) {
      const target = wikilinkTarget(item)
      const resolved = target === null ? undefined : resolver.resolve(target)
      if (resolved !== undefined && paths.has(resolved)) pairs.push([item, resolved])
    }
    // `defineProperty` na chave e `fromEntries` no `resolved`: `__proto__` é chave comum.
    Object.defineProperty(out, key, {
      value: { candidates, resolved: Object.fromEntries(pairs) },
      enumerable: true, writable: true, configurable: true,
    })
  }
  return out
}
