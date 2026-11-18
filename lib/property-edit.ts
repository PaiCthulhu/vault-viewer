// Valores do editor de propriedades, no cliente: converte o que a linha traz para o que o
// campo mostra, valida o que o usuário digitou e monta a linha provisória exibida até o
// build confirmar. Tudo puro, sem React nem Node (roda no navegador).
import type { PageProperty, PropertyType, PropertyValue } from '@/builder/types'
import { propertyColor } from '@/lib/property-color'
import { decodeEntities } from '@/lib/preview'

export const MAX_PROPERTY_TEXT = 10_000

export type ScalarEditorType = 'text' | 'number' | 'date' | 'datetime'

export type DraftResult = { ok: true; value: PropertyValue } | { ok: false; errorKey: string }

const NUMBER_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/
const LINE_BREAK_RE = /[\r\n\u0085\u2028\u2029]/

export function isListType(type: PropertyType): boolean {
  return type === 'multitext' || type === 'tags' || type === 'aliases'
}

// Um texto com quebra de linha não abre editor: o <input> de uma linha só tira as quebras, e
// o valor seria gravado achatado sem o usuário ter mexido. Vale para o texto que o editor
// abriria (`initialText`), que inclui a lista de um item só de uma linha `mismatch`, e para
// os itens que a seleção múltipla abriria (`initialItems`): o campo dela também é de uma
// linha, e o item com quebra voltaria gravado sem o usuário poder vê-lo.
export function isEditable(p: PageProperty): boolean {
  if (p.locked) return false
  if (isListType(p.type)) return !initialItems(p).some(i => LINE_BREAK_RE.test(i))
  return !(p.type === 'text' && LINE_BREAK_RE.test(initialText(p)))
}

// O texto que o valor mostra na tela, para o nome acessível: o HTML do builder sem as tags,
// com as entidades decodificadas e os espaços juntados. Os chips de uma lista vêm colados no
// HTML; aqui saem separados por vírgula ("RPG, Indie", não "RPGIndie").
export function visibleText(html: string): string {
  return html
    .split(/(?=<span class="vault-prop-chip")/)
    .map(part => decodeEntities(part.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim())
    .filter(s => s !== '')
    .join(', ')
}

// Dia, mês e ano válidos: ida e volta por Date.UTC (2024-02-30 não passa).
function validDate(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d))
  // Date.UTC trata anos 0-99 como 1900-1999; o ano de 4 dígitos ainda precisa bater.
  t.setUTCFullYear(y)
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

function validDateText(s: string): boolean {
  const m = DATE_RE.exec(s)
  return m !== null && validDate(Number(m[1]), Number(m[2]), Number(m[3]))
}

function validTime(h: number, min: number): boolean {
  return h <= 23 && min <= 59
}

// A conversão não pode perder nada: quando perde, o editor abre vazio.
export function initialText(p: PageProperty): string {
  const v = p.value
  switch (p.type) {
    case 'number': {
      if (typeof v === 'number') return String(v)
      if (typeof v === 'string' && NUMBER_RE.test(v.trim())) return v.trim()
      return ''
    }
    case 'date':
      return typeof v === 'string' && validDateText(v) ? v : ''
    case 'datetime': {
      if (typeof v !== 'string') return ''
      const m = DATETIME_RE.exec(v)
      if (m && v.length === 16 && validDate(Number(m[1]), Number(m[2]), Number(m[3])) && validTime(Number(m[4]), Number(m[5]))) {
        return v
      }
      return validDateText(v) ? `${v}T00:00` : ''
    }
    default: {
      if (typeof v === 'string') return v
      if (typeof v === 'number' || typeof v === 'boolean') return String(v)
      if (Array.isArray(v) && v.length === 1 && typeof v[0] === 'string') return v[0]
      return ''
    }
  }
}

export function initialChecked(p: PageProperty): boolean {
  const v = p.value
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') return v.trim().toLowerCase() === 'true'
  return false
}

export function initialItems(p: PageProperty): string[] {
  const v = p.value
  if (Array.isArray(v)) {
    return v
      .map(i => (typeof i === 'string' ? i : typeof i === 'number' || typeof i === 'boolean' ? String(i) : ''))
      .map(i => i.trim())
      .filter(i => i !== '')
  }
  if (typeof v === 'string') return v.trim() === '' ? [] : [v.trim()]
  if (typeof v === 'number' || typeof v === 'boolean') return [String(v)]
  return []
}

// `text` chega aparado ou não: aqui apara. Vazio limpa o valor (`null`).
export function textDraftValue(type: ScalarEditorType, text: string): DraftResult {
  const s = text.trim()
  if (s === '') return { ok: true, value: null }
  switch (type) {
    case 'text':
      if (s.length > MAX_PROPERTY_TEXT) return { ok: false, errorKey: 'properties.error.tooLong' }
      if (LINE_BREAK_RE.test(s)) return { ok: false, errorKey: 'properties.error.invalid' }
      return { ok: true, value: s }
    case 'number': {
      const n = Number(s)
      if (!NUMBER_RE.test(s) || !Number.isFinite(n)) return { ok: false, errorKey: 'properties.error.number' }
      return { ok: true, value: n }
    }
    case 'date':
      return validDateText(s) ? { ok: true, value: s } : { ok: false, errorKey: 'properties.error.date' }
    case 'datetime': {
      const m = DATETIME_RE.exec(s)
      if (m && validDate(Number(m[1]), Number(m[2]), Number(m[3])) && validTime(Number(m[4]), Number(m[5]))) {
        return { ok: true, value: s.slice(0, 16) }
      }
      return { ok: false, errorKey: 'properties.error.date' }
    }
  }
}

export function listDraftValue(items: string[]): string[] {
  const out: string[] = []
  for (const raw of items) {
    const i = raw.trim()
    if (i !== '' && !out.includes(i)) out.push(i)
  }
  return out
}

// Igualdade JSON profunda (a ordem das chaves de um objeto não conta).
export function sameValue(a: PropertyValue, b: PropertyValue): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => sameValue(x, b[i]))
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    return ka.every(k => Object.hasOwn(b, k) && sameValue(a[k], b[k]))
  }
  return false
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatDate(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : escapeHtml(s)
}

function formatDateTime(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s)
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : escapeHtml(s)
}

function provisionalHtml(row: PageProperty, value: PropertyValue): string {
  if (value === null || (Array.isArray(value) && value.length === 0)) return ''
  if (Array.isArray(value)) {
    return value
      .map(i => String(i))
      .map(i => `<span class="vault-prop-chip" data-color="${propertyColor(row.key, i)}">${escapeHtml(i)}</span>`)
      .join('')
  }
  if (row.type === 'checkbox' && typeof value === 'boolean') {
    return `<input type="checkbox" class="vault-prop-checkbox"${value ? ' checked' : ''} disabled>`
  }
  if (typeof value === 'string') {
    if (row.type === 'date') return formatDate(value)
    if (row.type === 'datetime') return formatDateTime(value)
    return escapeHtml(value)
  }
  return escapeHtml(String(value))
}

// A linha que o editor mostra até o build confirmar. Não resolve link (a resposta da API
// traz o HTML certo) e nunca é `mismatch` nem travada.
export function provisionalRow(row: PageProperty, value: PropertyValue): PageProperty {
  return { key: row.key, type: row.type, value, html: provisionalHtml(row, value) }
}
