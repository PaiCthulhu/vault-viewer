import fs from 'node:fs'
import path from 'node:path'
import type { PropertyJson, PropertyType, PropertyValue } from './types'

// Tipos de propriedade do frontmatter: configuração do vault, inferência e
// normalização do valor. Tudo aqui é puro e determinístico, exceto o loader.

export const PROPERTY_TYPES: readonly PropertyType[] = [
  'text',
  'multitext',
  'number',
  'checkbox',
  'date',
  'datetime',
  'tags',
  'aliases',
]

export const LIST_PROPERTY_TYPES: ReadonlySet<PropertyType> = new Set<PropertyType>([
  'multitext',
  'tags',
  'aliases',
])

export interface PropertyConfig {
  types: Map<string, PropertyType>
  readonly: Set<string>
}

export const EMPTY_PROPERTY_CONFIG: PropertyConfig = {
  types: new Map(),
  readonly: new Set(),
}

const OBSIDIAN_TYPES_FILE = '.obsidian/types.json'
const VAULTWRIGHT_FILE = '.vaultwright/properties.json'

function isPlainRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x) && !(x instanceof Date)
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    return undefined
  }
}

/** Lê o `.obsidian/types.json`. null = ilegível ou formato errado. */
export function parseObsidianTypes(text: string): Map<string, PropertyType> | null {
  const json = parseJson(text)
  if (!isPlainRecord(json) || !isPlainRecord(json.types)) return null
  const out = new Map<string, PropertyType>()
  for (const [key, value] of Object.entries(json.types)) {
    if (typeof value === 'string' && (PROPERTY_TYPES as readonly string[]).includes(value)) {
      out.set(key, value as PropertyType)
    }
  }
  return out
}

/** Lê o `.vaultwright/properties.json`: as chaves com `readonly: true`. null = ilegível. */
export function parseVaultwrightProperties(text: string): Set<string> | null {
  const json = parseJson(text)
  if (!isPlainRecord(json) || json.version !== 1 || !isPlainRecord(json.properties)) return null
  const out = new Set<string>()
  for (const [key, settings] of Object.entries(json.properties)) {
    if (isPlainRecord(settings) && settings.readonly === true) out.add(key)
  }
  return out
}

function readOptional(
  vaultPath: string,
  rel: string,
  warn: (msg: string) => void,
): string | null {
  try {
    return fs.readFileSync(path.join(vaultPath, rel), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      warn(`${rel}: não foi possível ler (${(err as Error)?.message ?? String(err)}); ignorado`)
    }
    return null
  }
}

/** Carrega a configuração de propriedades do vault. Nunca lança. */
export function loadPropertyConfig(
  vaultPath: string,
  warn: (msg: string) => void = console.warn,
): PropertyConfig {
  const config: PropertyConfig = { types: new Map(), readonly: new Set() }

  const typesText = readOptional(vaultPath, OBSIDIAN_TYPES_FILE, warn)
  if (typesText !== null) {
    const types = parseObsidianTypes(typesText)
    if (types) config.types = types
    else warn(`${OBSIDIAN_TYPES_FILE}: JSON inválido ou formato inesperado; ignorado`)
  }

  const vwText = readOptional(vaultPath, VAULTWRIGHT_FILE, warn)
  if (vwText !== null) {
    const ro = parseVaultwrightProperties(vwText)
    if (ro) config.readonly = ro
    else warn(`${VAULTWRIGHT_FILE}: JSON inválido, versão ou formato inesperado; ignorado`)
  }

  return config
}

function lookupKey<T>(map: Map<string, T>, key: string): T | undefined {
  const exact = map.get(key)
  if (exact !== undefined) return exact
  const lower = key.toLowerCase()
  for (const [k, v] of map) if (k.toLowerCase() === lower) return v
  return undefined
}

export function lookupPropertyType(config: PropertyConfig, key: string): PropertyType | undefined {
  return lookupKey(config.types, key)
}

export function isReadonlyProperty(config: PropertyConfig, key: string): boolean {
  if (config.readonly.has(key)) return true
  const lower = key.toLowerCase()
  for (const k of config.readonly) if (k.toLowerCase() === lower) return true
  return false
}

// ---- datas ----

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/

function validParts(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): boolean {
  if (h > 23 || mi > 59 || s > 59) return false
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, s))
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d &&
    dt.getUTCHours() === h &&
    dt.getUTCMinutes() === mi &&
    dt.getUTCSeconds() === s
  )
}

/** `AAAA-MM-DD` válido (com trim) → a própria data; senão null. */
function parseDateString(s: string): string | null {
  const m = DATE_RE.exec(s.trim())
  if (!m || !validParts(+m[1], +m[2], +m[3])) return null
  return `${m[1]}-${m[2]}-${m[3]}`
}

/** `AAAA-MM-DD[T ]HH:mm(:ss)?` válido (com trim) → `AAAA-MM-DDTHH:mm`; senão null. */
function parseDateTimeString(s: string): string | null {
  const m = DATETIME_RE.exec(s.trim())
  if (!m || !validParts(+m[1], +m[2], +m[3], +m[4], +m[5], m[6] ? +m[6] : 0)) return null
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`
}

const p2 = (n: number) => String(n).padStart(2, '0')

function dateHasTime(d: Date): boolean {
  return d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0 || d.getUTCMilliseconds() !== 0
}

function formatDate(d: Date): string {
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`
}

function formatDateTime(d: Date): string {
  return `${formatDate(d)}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`
}

/** Texto de uma `Date` válida: só a data à meia-noite UTC, senão data e hora (sem segundos). */
function dateText(d: Date): string {
  return dateHasTime(d) ? formatDateTime(d) : formatDate(d)
}

const isValidDate = (x: unknown): x is Date => x instanceof Date && !Number.isNaN(x.getTime())

// ---- inferência ----

export function inferValueType(raw: unknown): PropertyType {
  if (typeof raw === 'boolean') return 'checkbox'
  if (typeof raw === 'number') return Number.isFinite(raw) ? 'number' : 'text'
  if (Array.isArray(raw)) return 'multitext'
  if (isValidDate(raw)) return dateHasTime(raw) ? 'datetime' : 'date'
  if (typeof raw === 'string') {
    if (parseDateString(raw) !== null) return 'date'
    if (parseDateTimeString(raw) !== null) return 'datetime'
  }
  return 'text'
}

export function inferPropertyType(key: string, raw: unknown): PropertyType {
  const lower = key.toLowerCase()
  if (lower === 'tags') return 'tags'
  if (lower === 'aliases') return 'aliases'
  return inferValueType(raw)
}

export function resolvePropertyType(key: string, raw: unknown, config: PropertyConfig): PropertyType {
  return lookupPropertyType(config, key) ?? inferPropertyType(key, raw)
}

// ---- objetos ----

export function isNestedObject(raw: unknown): boolean {
  if (Array.isArray(raw)) {
    return raw.some((item) => Array.isArray(item) || isPlainRecord(item))
  }
  return isPlainRecord(raw)
}

export function toJsonSafe(raw: unknown): PropertyJson {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string' || typeof raw === 'boolean') return raw
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : String(raw)
  if (raw instanceof Date) return isValidDate(raw) ? raw.toISOString() : null
  if (Array.isArray(raw)) return raw.map(toJsonSafe)
  if (typeof raw === 'object') {
    // fromEntries define chaves próprias: `__proto__` não mexe em protótipo.
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, toJsonSafe(v)]))
  }
  return String(raw)
}

// ---- normalização ----

type Result = { value: PropertyValue; mismatch: boolean }

function isEmptyRaw(raw: unknown): boolean {
  return (
    raw === null ||
    raw === undefined ||
    (typeof raw === 'string' && raw.trim() === '') ||
    (Array.isArray(raw) && raw.length === 0)
  )
}

/** Converte um item escalar de lista em texto; undefined = item vazio (sai); null = não cabe. */
function listItem(item: unknown): string | undefined | null {
  if (item === null || item === undefined) return undefined
  if (typeof item === 'string') {
    const t = item.trim()
    return t === '' ? undefined : t
  }
  if (typeof item === 'number' || typeof item === 'boolean') return String(item)
  if (item instanceof Date) return isValidDate(item) ? dateText(item) : undefined
  return null
}

function normalizeAs(type: PropertyType, raw: unknown): Result {
  const isList = LIST_PROPERTY_TYPES.has(type)
  if (isEmptyRaw(raw)) return { value: isList ? [] : null, mismatch: false }

  switch (type) {
    case 'text':
      if (typeof raw === 'string') return { value: raw, mismatch: false }
      if (typeof raw === 'number' || typeof raw === 'boolean') return { value: String(raw), mismatch: false }
      if (raw instanceof Date) {
        // Date inválida não traz informação: conta como vazia.
        return { value: isValidDate(raw) ? dateText(raw) : null, mismatch: false }
      }
      return { value: null, mismatch: true }
    case 'number':
      return typeof raw === 'number' && Number.isFinite(raw)
        ? { value: raw, mismatch: false }
        : { value: null, mismatch: true }
    case 'checkbox':
      return typeof raw === 'boolean' ? { value: raw, mismatch: false } : { value: null, mismatch: true }
    case 'date': {
      if (isValidDate(raw) && !dateHasTime(raw)) return { value: formatDate(raw), mismatch: false }
      if (typeof raw === 'string') {
        const s = parseDateString(raw)
        if (s !== null) return { value: s, mismatch: false }
      }
      return { value: null, mismatch: true }
    }
    case 'datetime': {
      if (isValidDate(raw)) return { value: formatDateTime(raw), mismatch: false }
      if (typeof raw === 'string') {
        const dt = parseDateTimeString(raw)
        if (dt !== null) return { value: dt, mismatch: false }
        const d = parseDateString(raw)
        if (d !== null) return { value: `${d}T00:00`, mismatch: false }
      }
      return { value: null, mismatch: true }
    }
    case 'multitext':
    case 'tags':
    case 'aliases': {
      if (!Array.isArray(raw)) return { value: null, mismatch: true }
      const out: string[] = []
      for (const item of raw) {
        const t = listItem(item)
        if (t === null) return { value: null, mismatch: true }
        if (t !== undefined) out.push(t)
      }
      return { value: out, mismatch: false }
    }
  }
}

export function normalizePropertyValue(type: PropertyType, raw: unknown): Result {
  const r = normalizeAs(type, raw)
  if (!r.mismatch) return r
  // Com mismatch, o valor é o do tipo inferido do próprio valor; se nem esse
  // cabe (objeto aninhado), a cópia JSON-safe.
  const inferred = normalizeAs(inferValueType(raw), raw)
  return { value: inferred.mismatch ? toJsonSafe(raw) : inferred.value, mismatch: true }
}
