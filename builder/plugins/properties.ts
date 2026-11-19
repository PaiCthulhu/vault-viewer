// Propriedades do frontmatter, no estilo do Obsidian.
//
// `buildPageProperties` transforma o frontmatter em linhas estruturadas
// (`PageProperty[]`), cada uma com o tipo, o valor normalizado, o HTML de exibição
// já escapado, a trava e o mismatch; o viewer monta o bloco onde a página tem
// `PROPERTIES_MARKER`. `collectPropertyValues` junta os valores das propriedades
// de lista e de seleção única do vault inteiro.

import { escapeHtml as esc } from '../link-resolver'
import {
  inferValueType,
  isNestedObject,
  EMPTY_PROPERTY_CONFIG,
  isReadonlyProperty,
  LIST_PROPERTY_TYPES,
  lookupChosenColors,
  lookupRelationFolder,
  lookupSelectOptions,
  normalizePropertyValue,
  resolvePropertyType,
  toJsonSafe,
  type PropertyConfig,
} from '../property-types'
import type { PageMeta, PageProperty, PropertyJson, PropertyLock, PropertyType, PropertyValue } from '../types'
import { chipColor, type ChosenColors } from '@/lib/property-color'
import { isNoteItem } from '@/lib/wikilink-label'

// Wikilink de imagem: `[[pasta/img.png]]` ou `[[img.png|alias]]`.
const IMAGE_WIKILINK_RE = /^\[\[(.+\.(?:png|jpe?g|gif|webp|svg|avif))(?:\|[^\]]*)?\]\]$/i
// Caminho de imagem solto (sem colchetes), terminado numa extensão de imagem.
export const IMAGE_PATH_RE = /^.+\.(?:png|jpe?g|gif|webp|svg|avif)$/i

// Valor que é, inteiro, uma URL http(s). O Obsidian não tem tipo "URL": uma
// propriedade de texto cujo valor é uma URL só aparece como link clicável.
const URL_RE = /^https?:\/\/\S+$/

/** Lugar do bloco Propriedades no HTML da página: o viewer monta o bloco ali. */
export const PROPERTIES_MARKER = '<div class="vault-properties-slot"></div>'

// Chaves de apresentação ou internas, escondidas em toda nota. `note_type` só
// classifica a nota (aba, comentário, personagem...) e não é dado para exibir.
const HIDDEN_PROPERTY_KEYS = /^(cover|cover_y|banner|banner_height|cssclasses|notion-id|tab_label|note_type)$/i
// Campos do formato de nota-filha: escondidos só numa aba ou num comentário,
// e só com o nome exato (minúsculo).
const FAMILY_ONLY_KEYS = new Set(['parent', 'order'])

// Data e data-hora já normalizadas (ver normalizePropertyValue).
const DATE_VALUE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DATETIME_VALUE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

// Quebra de linha que um campo de uma linha não guarda (a mesma lista da API de edição).
const LINE_BREAK_RE = /[\r\n\u0085\u2028\u2029]/

export interface PropertyRenderContext {
  /** Troca os wikilinks do texto por links; o texto, o display e o href saem escapados. */
  renderWikilinks: (text: string) => string
  /** Registra a imagem como asset da página e devolve a URL dela (`/vault-assets/...`). */
  resolveImage: (p: string) => string
  config: PropertyConfig
}

export function isHiddenProperty(key: string, familyNote: boolean): boolean {
  return HIDDEN_PROPERTY_KEYS.test(key) || (familyNote && FAMILY_ONLY_KEYS.has(key))
}

/**
 * Caminho da imagem do vault que o valor cita, ou null. Uma URL nunca é imagem do vault.
 * Também decide o que conta como capa do banner (`banners.ts`).
 */
export function imageTarget(value: string): string | null {
  const s = value.trim()
  if (URL_RE.test(s)) return null
  const wl = IMAGE_WIKILINK_RE.exec(s)
  if (wl) return wl[1]
  return !s.includes('[[') && IMAGE_PATH_RE.test(s) ? s : null
}

function thumbnail(p: string, ctx: PropertyRenderContext): string {
  let src: string
  try {
    // `#` e `?` também: o `encodeURI` os deixa, e no src eles viram fragmento e query.
    src = encodeURI(ctx.resolveImage(p)).replace(/[#?]/g, c => (c === '#' ? '%23' : '%3F'))
  } catch {
    // Um surrogate solto no caminho faz o encodeURI lançar URIError: sem isso, uma
    // propriedade derrubaria o build do vault inteiro. Fica o caminho como texto.
    return esc(p)
  }
  return `<img class="vault-prop-thumb" src="${esc(src)}" alt="" />`
}

/** Texto solto, nesta ordem: URL inteira, imagem do vault, wikilinks, texto escapado. */
function renderText(value: string, ctx: PropertyRenderContext): string {
  const s = value.trim()
  // URL antes da imagem: uma URL terminada em .png não é imagem do vault.
  if (URL_RE.test(s)) return `<a href="${esc(s)}">${esc(s)}</a>`
  const img = imageTarget(s)
  if (img !== null) return thumbnail(img, ctx)
  if (s.includes('[[')) return ctx.renderWikilinks(s)
  return esc(s)
}

/** Texto de um valor qualquer; só importa quando a forma do valor não bate com o tipo. */
function textOf(v: PropertyJson): string {
  if (v === null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

/** Itens de um valor de lista, como texto (um valor solto conta como um item). */
function listItems(value: PropertyValue): string[] {
  return (Array.isArray(value) ? value : [value]).map(textOf)
}

/**
 * Item de lista: imagem vira miniatura solta; numa relação, o item que é nota (inteiro, um
 * wikilink) vira o título dela, sem pílula nem cor, como na relação do Notion; o resto vira
 * chip colorido.
 */
function renderListItem(
  key: string, item: string, ctx: PropertyRenderContext, opts: { colors?: ChosenColors; relation?: boolean },
): string {
  if (item.trim() === '') return ''
  const img = imageTarget(item)
  if (img !== null) return thumbnail(img, ctx)
  if (opts.relation && isNoteItem(item)) return `<span class="vault-prop-note">${renderText(item, ctx)}</span>`
  return `<span class="vault-prop-chip" data-color="${chipColor(key, item.trim(), opts.colors)}">${renderText(item, ctx)}</span>`
}

/** HTML de exibição de um valor já normalizado, no tipo dado. Tudo sai escapado. */
export function renderPropertyValue(
  key: string,
  type: PropertyType,
  value: PropertyValue,
  ctx: PropertyRenderContext,
  opts: { select?: boolean; colors?: ChosenColors; relation?: boolean } = {},
): string {
  if (value === null || (Array.isArray(value) && value.length === 0)) return ''
  if (LIST_PROPERTY_TYPES.has(type)) {
    return listItems(value).map(item => renderListItem(key, item, ctx, opts)).join('')
  }
  // Seleção única: o valor de texto aparece como o chip de um item de lista.
  if (opts.select && type === 'text' && typeof value === 'string') {
    return renderListItem(key, value.trim(), ctx, { colors: opts.colors })
  }
  switch (type) {
    case 'checkbox':
      // Somente leitura, com a mesma marcação de um item de task list.
      if (typeof value === 'boolean') {
        return `<input type="checkbox" class="vault-prop-checkbox"${value ? ' checked' : ''} disabled>`
      }
      break
    case 'date': {
      const m = typeof value === 'string' ? DATE_VALUE_RE.exec(value) : null
      if (m) return `${m[3]}/${m[2]}/${m[1]}`
      break
    }
    case 'datetime': {
      const m = typeof value === 'string' ? DATETIME_VALUE_RE.exec(value) : null
      if (m) return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`
      break
    }
    case 'text':
      if (typeof value === 'string') return renderText(value, ctx)
      break
    case 'number':
      break
  }
  // Número, ou valor fora da forma do tipo: texto escapado, sem link nem imagem.
  return esc(textOf(value))
}

/** O valor mostrado no tipo dado cita alguma imagem do vault (texto ou item de lista). */
function citesImage(type: PropertyType, value: PropertyValue): boolean {
  if (value === null) return false
  if (LIST_PROPERTY_TYPES.has(type)) return listItems(value).some(item => imageTarget(item) !== null)
  return type === 'text' && typeof value === 'string' && imageTarget(value) !== null
}

/** Uma linha do bloco Propriedades. As chaves `locked` e `mismatch` só existem quando se aplicam. */
export function toPageProperty(key: string, raw: unknown, ctx: PropertyRenderContext): PageProperty {
  const type = resolvePropertyType(key, raw, ctx.config)
  const readonly = isReadonlyProperty(ctx.config, key)

  if (isNestedObject(raw)) {
    // Objeto aninhado não cabe em tipo nenhum: vai a cópia JSON-safe, mostrada como JSON.
    const value = toJsonSafe(raw)
    return { key, type, value, html: esc(JSON.stringify(value)), locked: readonly ? 'readonly' : 'object' }
  }

  const { value, mismatch } = normalizePropertyValue(type, raw)
  // Com mismatch, o valor vem na forma do tipo inferido, e é nesse tipo que se mostra.
  const shown = mismatch ? inferValueType(raw) : type
  // Seleção única: a chave tem `select` no config e o valor é um texto de uma linha (ou vazio).
  const select =
    !mismatch &&
    type === 'text' &&
    lookupSelectOptions(ctx.config, key) !== undefined &&
    (value === null || (typeof value === 'string' && !LINE_BREAK_RE.test(value)))
  // Lista que cita notas de uma pasta (`relation` no config): só em multitext sem mismatch.
  const relation = !mismatch && type === 'multitext' && lookupRelationFolder(ctx.config, key) !== undefined
  const chosenMap = select || LIST_PROPERTY_TYPES.has(type) ? lookupChosenColors(ctx.config, key) : undefined
  const chosen = chosenMap && Object.fromEntries(chosenMap)
  const row: PageProperty = {
    key, type, value,
    html: renderPropertyValue(key, shown, value, ctx, { select, colors: chosen, relation }),
  }
  const locked: PropertyLock | null = readonly ? 'readonly' : citesImage(shown, value) ? 'image' : null
  if (locked) row.locked = locked
  if (mismatch) row.mismatch = true
  if (select) row.select = true
  if (chosen) row.colors = chosen
  if (relation) row.relation = true
  return row
}

/** As linhas do bloco Propriedades, na ordem do frontmatter, vazias incluídas. */
export function buildPageProperties(
  frontmatter: Record<string, unknown>,
  ctx: PropertyRenderContext,
  opts: { familyNote: boolean },
): PageProperty[] {
  const rows: PageProperty[] = []
  for (const [key, raw] of Object.entries(frontmatter)) {
    if (isHiddenProperty(key, opts.familyNote)) continue
    rows.push(toPageProperty(key, raw, ctx))
  }
  return rows
}

// Ordem pt-BR; o desempate por unidade de código deixa a ordem total e estável
// (o localeCompare dá 0 para formas canônicas equivalentes, como NFC e NFD).
export function compareText(a: string, b: string): number {
  return a.localeCompare(b, 'pt-BR') || (a < b ? -1 : a > b ? 1 : 0)
}

/**
 * Índice dos valores das propriedades de lista e de seleção única: chave exata →
 * valores distintos, chaves e valores em ordem pt-BR. Uma chave de seleção única
 * entra mesmo com todos os valores vazios; suas opções vêm primeiro, na ordem do
 * arquivo (usadas ou não), e depois os valores usados fora da lista, em pt-BR.
 * Linha travada não entra; uma string solta com
 * mismatch numa propriedade de lista entra aparada, porque vai virar item de lista
 * (e os itens de lista já vêm aparados da normalização).
 */
export function collectPropertyValues(
  pages: Pick<PageMeta, 'properties'>[],
  config: PropertyConfig = EMPTY_PROPERTY_CONFIG,
): Record<string, string[]> {
  const byKey = new Map<string, Set<string>>()
  const add = (key: string, v: string) => {
    if (v === '') return
    const values = byKey.get(key)
    if (values) values.add(v)
    else byKey.set(key, new Set([v]))
  }
  for (const page of pages) {
    for (const row of page.properties ?? []) {
      if (row.locked) continue
      if (row.select) {
        // Seleção única: a chave existe mesmo sem valor usado (as opções entram no fim).
        if (!byKey.has(row.key)) byKey.set(row.key, new Set())
        if (typeof row.value === 'string') add(row.key, row.value.trim())
      } else if (Array.isArray(row.value)) {
        for (const item of row.value) if (typeof item === 'string') add(row.key, item)
      } else if (row.mismatch && LIST_PROPERTY_TYPES.has(row.type) && typeof row.value === 'string') {
        add(row.key, row.value.trim())
      }
    }
  }
  return Object.fromEntries(
    [...byKey]
      .sort(([a], [b]) => compareText(a, b))
      .map(([key, values]) => {
        const options = lookupSelectOptions(config, key)
        if (!options) return [key, [...values].sort(compareText)]
        // Opções na ordem do arquivo (usadas ou não), depois os usados fora delas.
        const extra = [...values].filter(v => !options.includes(v)).sort(compareText)
        return [key, [...options, ...extra]]
      }),
  )
}
