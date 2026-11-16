// Nota-filha: uma nota com `note_type` reconhecido e `parent: "[[caminho/da/mãe]]"`.
// A filiação é só pelo `parent` (caminho a partir da raiz do vault, casado sem
// diferenciar caixa); a pasta do arquivo não importa.
//   - `tab`: página própria, fora da árvore/busca/grafo, mostrada na barra de abas
//     da mãe. Uma aba cujo `parent` não resolve, aponta para ela mesma ou para outra
//     filha (aba de aba, ciclo) é nota comum: nada some em silêncio.
//   - `comment`: com `parent` (resolva ou não, e mesmo fora do formato, como lista ou
//     número), não gera página nem aparece em lugar nenhum: corpo de comentário nunca
//     passa pelo render completo (que roda dataviewjs). Sem `parent`, é nota comum.
//     Quando a cadeia de `parent` chega a uma nota comum com Propriedades, o comentário
//     é anexado a ela como conversa (`builder/comments.ts`); senão é órfão e some.
//
// Rede de segurança da pasta `_comments/` na raiz do vault (onde o viewer grava os
// comentários; sem diferenciar caixa, em qualquer profundidade): um `.md` ali dentro que
// não é comentário válido (frontmatter malformado, gravação pela metade, `note_type`
// ausente ou diferente de `comment`, sem `parent`) é ignorado: sem página, sem render,
// fora da árvore, da busca, do grafo e das conversas, e não é mãe nem aba de ninguém.
// Sem isso, o `extractFrontmatter` engole o YAML quebrado e o arquivo vira nota comum,
// cujo corpo passa pelo render completo (que roda dataviewjs). O Dataview continua
// vendo esses arquivos.
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
  // Fora da árvore, da busca e do grafo: abas válidas, comentários válidos e os
  // ignorados de `_comments/`.
  hidden: Set<string>
  // Não geram `pages/<caminho>.json` nem passam pelo render: comentários válidos e os
  // ignorados de `_comments/`.
  noPage: Set<string>
  // Comentários válidos (`note_type: comment` com `parent`), resolva o `parent` ou não.
  // Só eles formam conversas; um ignorado de `_comments/` está em `noPage` mas não aqui.
  comments: Set<string>
  // Barra de abas, para a mãe e para cada aba dela (a mesma lista).
  tabsOf: Map<string, PageTab[]>
  // Filha → caminho da mãe, só quando o `parent` resolve para OUTRA nota existente.
  parentOf: Map<string, string>
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

// Caminho (relativo à raiz, com `/`, sem `.md`) dentro da pasta `_comments/` da raiz,
// sem diferenciar caixa e em qualquer profundidade. `_comments.md` na raiz e
// `Notas/_comments/x.md` ficam de fora.
export function isInCommentsFolder(path: string): boolean {
  const slash = path.indexOf('/')
  return slash > 0 && slash < path.length - 1 && path.slice(0, slash).toLowerCase() === '_comments'
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
  const comments = new Set<string>()
  for (const n of notes) {
    const f = fields.get(n.path)!
    if (f.noteType === 'comment' && hasParentValue(n.frontmatter.parent)) {
      comments.add(n.path)
      hidden.add(n.path)
      noPage.add(n.path)
    } else if (isInCommentsFolder(n.path)) {
      // Ignorado: dentro de `_comments/` e não é comentário válido.
      hidden.add(n.path)
      noPage.add(n.path)
    }
  }

  // Mãe principal: não é comentário nem ignorado (sem página), nem aba com mãe
  // resolvida. A checagem é de um passo só, então ciclos e cadeias (aba de aba) caem
  // em nota comum.
  const isPrincipal = (m: FamilyNote): boolean =>
    !noPage.has(m.path) && !(fields.get(m.path)!.noteType === 'tab' && parentOf.has(m.path))

  const children = new Map<string, FamilyNote[]>()
  for (const n of notes) {
    // Uma aba sem página (ignorada em `_comments/`) não entra na barra de ninguém.
    if (fields.get(n.path)!.noteType !== 'tab' || noPage.has(n.path)) continue
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

  const parentPaths = new Map<string, string>()
  for (const [child, mother] of parentOf) parentPaths.set(child, mother.path)

  return { hidden, noPage, comments, tabsOf, parentOf: parentPaths }
}
