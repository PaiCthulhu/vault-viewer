// Nota-filha: uma nota com `note_type` reconhecido e `parent: "[[caminho/da/mãe]]"`.
// A filiação é só pelo `parent` (caminho a partir da raiz do vault, casado sem
// diferenciar caixa); a pasta do arquivo não importa.
//   - `tab`: página própria, fora da árvore/busca/grafo, mostrada na barra de abas
//     da mãe. Uma aba cujo `parent` não resolve, aponta para ela mesma ou para outra
//     filha (aba de aba, ciclo) é nota comum: nada some em silêncio.
//   - `comment`: com `parent` (resolva ou não, e mesmo fora do formato, como lista ou
//     número), não gera página nem aparece em lugar nenhum: corpo de comentário nunca
//     passa pelo render completo (que roda dataviewjs). Sem `parent`, é nota comum.
import type { PageTab } from './types'

export type { PageTab }

export const FAMILY_NOTE_TYPES = ['comment', 'tab'] as const
export type FamilyNoteType = (typeof FAMILY_NOTE_TYPES)[number]

export interface FamilyFields {
  noteType: FamilyNoteType | null
  parent: string | null
  order: number | null
  tabLabel: string | null
}

export interface FamilyNote {
  path: string
  title: string
  frontmatter: Record<string, unknown>
}

export interface NoteFamilies {
  // Fora da árvore, da busca e do grafo: abas válidas e comentários com `parent`.
  hidden: Set<string>
  // Não geram `pages/<caminho>.json`: comentários com `parent`.
  noPage: Set<string>
  // Barra de abas, para a mãe e para cada aba dela (a mesma lista).
  tabsOf: Map<string, PageTab[]>
}

// Alvo do `parent`, normalizado: aceita com e sem colchetes, descarta apelido e
// heading (filiação é de nota), tira `.md` e a barra inicial. Só texto: sem aspas,
// o YAML lê `[[X]]` como lista, e aí não há `parent`.
export function parentRef(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  const m = /^\[\[([^\]|#]*)(?:[|#][^\]]*)?\]\]$/.exec(s)
  const target = (m ? m[1] : s).trim().replace(/\.md$/i, '').replace(/^\/+/, '').trim()
  return target || null
}

// `parent` presente com algum valor (texto não vazio, lista não vazia, número...).
function hasParentValue(v: unknown): boolean {
  if (v === undefined || v === null) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (Array.isArray(v)) return v.length > 0
  return true
}

export function noteFamilyFields(fm: Record<string, unknown>): FamilyFields {
  const t = fm.note_type
  const noteType = (FAMILY_NOTE_TYPES as readonly unknown[]).includes(t) ? (t as FamilyNoteType) : null
  const order = Number.isInteger(fm.order) ? (fm.order as number) : null
  const rawLabel = fm.tab_label
  const label = typeof rawLabel === 'string' || typeof rawLabel === 'number' ? String(rawLabel).trim() : ''
  return { noteType, parent: parentRef(fm.parent), order, tabLabel: label || null }
}

// Ordem das abas depois da mãe: `order` crescente, sem `order` no fim; empate por
// título e depois por caminho.
function compareTabs(
  a: { path: string; title: string; order: number | null },
  b: { path: string; title: string; order: number | null },
): number {
  if (a.order !== b.order) {
    if (a.order === null) return 1
    if (b.order === null) return -1
    return a.order - b.order
  }
  const byTitle = a.title.localeCompare(b.title, 'pt-BR')
  if (byTitle !== 0) return byTitle
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
}

export function resolveFamilies(notes: FamilyNote[]): NoteFamilies {
  // Caminho exato primeiro; sem diferenciar caixa só se não houver o exato (num disco
  // que diferencia caixa podem existir `P/M` e `P/m`).
  const byPath = new Map<string, FamilyNote>()
  const byLower = new Map<string, FamilyNote>()
  for (const n of notes) {
    byPath.set(n.path, n)
    byLower.set(n.path.toLowerCase(), n)
  }

  const fields = new Map<string, FamilyFields>()
  for (const n of notes) fields.set(n.path, noteFamilyFields(n.frontmatter))

  // Mãe de cada nota: o `parent` resolvido para OUTRA nota existente.
  const parentOf = new Map<string, FamilyNote>()
  for (const n of notes) {
    const ref = fields.get(n.path)!.parent
    if (!ref) continue
    const p = byPath.get(ref) ?? byLower.get(ref.toLowerCase())
    if (p && p.path !== n.path) parentOf.set(n.path, p)
  }

  const hidden = new Set<string>()
  const noPage = new Set<string>()
  for (const n of notes) {
    const f = fields.get(n.path)!
    if (f.noteType === 'comment' && hasParentValue(n.frontmatter.parent)) {
      hidden.add(n.path)
      noPage.add(n.path)
    }
  }

  // Mãe principal: não é comentário escondido nem aba com mãe resolvida. A checagem
  // é de um passo só, então ciclos e cadeias (aba de aba) caem em nota comum.
  const isPrincipal = (m: FamilyNote): boolean =>
    !noPage.has(m.path) && !(fields.get(m.path)!.noteType === 'tab' && parentOf.has(m.path))

  const children = new Map<string, FamilyNote[]>()
  for (const n of notes) {
    if (fields.get(n.path)!.noteType !== 'tab') continue
    const m = parentOf.get(n.path)
    if (!m || !isPrincipal(m)) continue
    hidden.add(n.path)
    const list = children.get(m.path) ?? []
    list.push(n)
    children.set(m.path, list)
  }

  const tabsOf = new Map<string, PageTab[]>()
  for (const [motherPath, kids] of children) {
    const mother = byPath.get(motherPath)!
    const sorted = kids
      .map(k => ({ path: k.path, title: k.title, order: fields.get(k.path)!.order }))
      .sort(compareTabs)
    const tabs: PageTab[] = [
      { path: mother.path, label: fields.get(mother.path)!.tabLabel ?? mother.title },
      ...sorted.map(k => ({ path: k.path, label: k.title })),
    ]
    for (const t of tabs) tabsOf.set(t.path, tabs)
  }

  return { hidden, noPage, tabsOf }
}
