// Regras puras do editor de relação (lista cujas opções são as notas de uma pasta): quais
// itens já resolvem para qual nota, quando o texto digitado pode virar uma nota nova e quais
// dicas distinguem dois chips de mesmo nome. Sem React nem Node (roda no navegador).
import type { RelationEntry } from '@/builder/types'
import { enterPick, type MenuEntry } from '@/lib/property-edit'
import { itemLabel, wikilinkTarget } from '@/lib/wikilink-label'

/** O caminho da nota que o item cita, ou null quando o índice não a conhece. */
export function candidateOf(item: string, rel: RelationEntry): string | null {
  const key = item.trim()
  if (Object.hasOwn(rel.resolved, key)) return rel.resolved[key]
  return rel.candidates.find(c => c.link === key)?.path ?? null
}

const FORBIDDEN_NAME = /[[\]|#^/\\]/
const FORBIDDEN_FILE_CHARS = /[<>:"?*\x00-\x1f\u0085\u2028\u2029]/
export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif)$/i
const MAX_NAME_BYTES = 255

/** `name` já aparado: um nome que o Obsidian e o Windows aceitam como nota e que a API aceita como item. */
export function isValidNoteName(name: string): boolean {
  if (name === '') return false
  if (FORBIDDEN_NAME.test(name) || FORBIDDEN_FILE_CHARS.test(name)) return false
  if (name.startsWith('.') || name.endsWith('.')) return false
  if (new TextEncoder().encode(name).length > MAX_NAME_BYTES) return false
  // A API recusaria o item: um link que termina em imagem vira o vault image.
  return !IMAGE_EXT.test(name)
}

/** O item `[[texto]]` do "Criar nota", ou null quando o nome é inválido ou já existe (nota ou item). */
export function relationCreate(
  text: string, rel: RelationEntry | null, items: readonly string[],
): string | null {
  const name = text.trim()
  if (!isValidNoteName(name)) return null
  const low = name.toLowerCase()
  // O nome não tem `/` e todo candidato está numa pasta: só o nome do arquivo pode coincidir, sem caixa.
  for (const c of rel?.candidates ?? []) {
    const file = c.path.slice(c.path.lastIndexOf('/') + 1)
    if (file.toLowerCase() === low) return null
  }
  if (items.some(i => wikilinkTarget(i)?.toLowerCase() === low)) return null
  return `[[${name}]]`
}

/** Os `link` dos candidatos que algum item já cita (saem do menu). */
export function relationExclude(rel: RelationEntry | null, items: readonly string[]): string[] {
  if (!rel) return []
  const used = new Set<string>()
  for (const item of items) {
    const p = candidateOf(item, rel)
    if (p !== null) used.add(p)
  }
  return rel.candidates.filter(c => used.has(c.path)).map(c => c.link)
}

/**
 * O que o Enter sem opção ativa faz na relação: `{ value }` adiciona o item; `{ chosen: true }`
 * é uma nota que já está entre os itens (nada entra e o campo limpa, como na lista comum);
 * null é um texto que não serve (nada entra e o texto fica).
 */
export function relationEnterPick(
  entries: readonly MenuEntry[], text: string, items: readonly string[], rel: RelationEntry | null,
): { value: string } | { chosen: true } | null {
  const p = enterPick(entries, text, items)
  if (p.chosen) return { chosen: true }
  if (entries.some(e => e.value === p.value)) {
    const path = rel ? candidateOf(p.value, rel) : null
    if (rel && path !== null && items.some(i => candidateOf(i, rel) === path)) return { chosen: true }
    return { value: p.value }
  }
  const name = text.trim().toLowerCase()
  if (items.some(i => wikilinkTarget(i)?.toLowerCase() === name)) return { chosen: true }
  const created = relationCreate(text, rel, items)
  return created === null ? null : { value: created }
}

/**
 * Dica para o `aria-label` do ×: null para o item de nome único; para os de nome repetido,
 * `hintOf(item)`; se dois do mesmo grupo dão a mesma dica, eles usam o item cru.
 */
export function removeHints(
  items: readonly string[], hintOf: (item: string) => string,
): (string | null)[] {
  const groups = new Map<string, number[]>()
  items.forEach((item, i) => {
    const label = itemLabel(item)
    const g = groups.get(label)
    if (g) g.push(i)
    else groups.set(label, [i])
  })
  const out: (string | null)[] = items.map(() => null)
  for (const idx of groups.values()) {
    if (idx.length < 2) continue
    const hints = idx.map(i => hintOf(items[i]))
    idx.forEach((i, n) => {
      out[i] = hints.filter(h => h === hints[n]).length > 1 ? items[i] : hints[n]
    })
  }
  return out
}
