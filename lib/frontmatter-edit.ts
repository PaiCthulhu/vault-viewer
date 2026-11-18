// Edição cirúrgica de uma propriedade no frontmatter de uma nota, e a validação do valor
// novo. Só as linhas da chave mudam: o resto do arquivo (as outras chaves, comentários YAML,
// ordem, aspas, CRLF, BOM e corpo) fica byte a byte. Quando o módulo não consegue garantir
// isso, recusa com o motivo; nunca reescreve "o melhor possível". Puro: não toca em disco.
import { parseYamlFrontmatter } from '@/builder/frontmatter'
import { LIST_PROPERTY_TYPES, normalizePropertyValue } from '@/builder/property-types'
import type { PropertyType, PropertyValue } from '@/builder/types'

// Texto entre aspas JSON, que o YAML lê como texto entre aspas duplas. O JSON já escapa
// aspas, barra invertida e controles C0; os demais caracteres que o YAML trata como quebra
// de linha ou não imprimível saem como `\uXXXX`.
const BACKSLASH = String.fromCharCode(92)

export function yamlString(s: string): string {
  let out = ''
  for (const ch of JSON.stringify(s)) {
    const code = ch.charCodeAt(0)
    const escape = (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 || code === 0xfeff
    out += escape ? `${BACKSLASH}u${code.toString(16).padStart(4, '0')}` : ch
  }
  return out
}

// ─── Validação do valor novo ──────────────────────────────────────────────────

export const MAX_PROPERTY_TEXT = 10_000

// Quebras recusadas num texto ou item: as do YAML e as que o Unicode trata como quebra.
const LINE_BREAK = /[\r\n\u0085\u2028\u2029]/

export type EditValidation = { ok: true; value: PropertyValue } | { ok: false; error: string }

const invalid = (error: string): EditValidation => ({ ok: false, error })

function validateList(raw: unknown): EditValidation {
  if (!Array.isArray(raw) || !raw.every((item) => typeof item === 'string')) {
    return invalid('O valor tem de ser uma lista de textos')
  }
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw as string[]) {
    if (LINE_BREAK.test(item)) return invalid('Um item da lista não pode ter quebra de linha')
    const t = item.trim()
    if (t === '') return invalid('A lista não pode ter item vazio')
    if (t.length > MAX_PROPERTY_TEXT) return invalid('Um item da lista passa de 10.000 caracteres')
    if (seen.has(t)) return invalid('A lista não pode ter item repetido')
    seen.add(t)
    out.push(t)
  }
  return { ok: true, value: out }
}

/**
 * Confere o valor que o cliente mandou para uma propriedade do tipo `type` e devolve o
 * valor a gravar. `null` apaga o valor (a chave fica), exceto em lista, que se esvazia com `[]`.
 */
export function validateEditValue(type: PropertyType, raw: unknown): EditValidation {
  if (LIST_PROPERTY_TYPES.has(type)) return validateList(raw)
  if (raw === null) return { ok: true, value: null }
  if (type === 'text') {
    if (typeof raw !== 'string') return invalid('O valor tem de ser um texto')
    if (LINE_BREAK.test(raw)) return invalid('O texto não pode ter quebra de linha')
    if (raw.length > MAX_PROPERTY_TEXT) return invalid('O texto passa de 10.000 caracteres')
    return { ok: true, value: raw.trim() === '' ? null : raw }
  }
  if (type === 'number') {
    return typeof raw === 'number' && Number.isFinite(raw) ? { ok: true, value: raw } : invalid('O valor tem de ser um número')
  }
  if (type === 'checkbox') {
    return typeof raw === 'boolean' ? { ok: true, value: raw } : invalid('O valor tem de ser verdadeiro ou falso')
  }
  // date e datetime: só o texto que o builder lê igual, sem mismatch e sem normalizar nada.
  if (typeof raw === 'string') {
    const r = normalizePropertyValue(type, raw)
    if (!r.mismatch && r.value === raw) return { ok: true, value: raw }
  }
  return invalid(type === 'date' ? 'A data tem de ser AAAA-MM-DD' : 'A data e hora têm de ser AAAA-MM-DDTHH:mm')
}

// ─── Leitura do frontmatter ───────────────────────────────────────────────────

const BOM = '\uFEFF'

export type FrontmatterRead =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; reason: 'no-frontmatter' | 'unreadable' | 'duplicate-key' | 'not-a-map' }

function isPlainMap(x: unknown): x is Record<string, unknown> {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false
  const proto: unknown = Object.getPrototypeOf(x)
  return proto === Object.prototype || proto === null
}

/** Lê o frontmatter como o builder (só YAML). O BOM sai pelo gray-matter. */
export function readFrontmatterData(text: string): FrontmatterRead {
  const lf = text.replace(/\r\n/g, '\n')
  const bare = lf.startsWith(BOM) ? lf.slice(1) : lf
  if (!bare.startsWith('---') || bare.startsWith('----')) return { ok: false, reason: 'no-frontmatter' }
  let data: unknown
  try {
    data = parseYamlFrontmatter(lf).data
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: message.includes('duplicated mapping key') ? 'duplicate-key' : 'unreadable' }
  }
  return isPlainMap(data) ? { ok: true, data } : { ok: false, reason: 'not-a-map' }
}

// ─── Modelo de linhas ─────────────────────────────────────────────────────────

const LINE = /[^\n]*\n|[^\n]+$/g
const content = (line: string): string => line.replace(/\r?\n$/, '')
const wsOrEnd = (line: string, i: number): boolean => i >= line.length || line[i] === ' ' || line[i] === '\t'

type LineKind = 'blank' | 'comment' | 'continuation' | 'key'

function classify(line: string): LineKind {
  if (/^[ \t]*$/.test(line)) return 'blank'
  if (line[0] === '#') return 'comment'
  if (line[0] === ' ' || line[0] === '\t' || (line[0] === '-' && wsOrEnd(line, 1))) return 'continuation'
  return 'key'
}

// Primeiro caractere que não abre chave simples: indicadores do YAML (pergunta, âncora,
// alias, etiqueta, bloco, diretiva, reservados e flow).
const NOT_PLAIN_KEY_START = new Set('?&*!|>%@`[]{},')

// A chave como o js-yaml a lê, ou null quando o token não é uma chave só.
function decodeKey(token: string): string | null {
  try {
    const data: unknown = parseYamlFrontmatter(`---\n${token}: 0\n---\n`).data
    if (!isPlainMap(data)) return null
    const keys = Object.keys(data)
    return keys.length === 1 ? keys[0] : null
  } catch {
    return null
  }
}

interface KeyToken {
  key: string
  prefix: string // o texto da linha da coluna 0 até o `:` separador, inclusive
}

// Lê a chave de uma linha de chave. null = não é uma chave que se saiba reescrever.
function readKeyToken(line: string): KeyToken | null {
  let tokenEnd: number
  let colon: number
  const q = line[0]
  if (q === '"' || q === "'") {
    let i = 1
    for (; i < line.length; i++) {
      if (q === '"' && line[i] === '\\') i++
      else if (line[i] === q) {
        if (q === "'" && line[i + 1] === "'") i++
        else break
      }
    }
    if (i >= line.length) return null
    tokenEnd = i + 1
    colon = tokenEnd
    while (line[colon] === ' ' || line[colon] === '\t') colon++
    if (line[colon] !== ':' || !wsOrEnd(line, colon + 1)) return null
  } else {
    if (line === '...' || NOT_PLAIN_KEY_START.has(q)) return null
    colon = -1
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '#' && i > 0 && (line[i - 1] === ' ' || line[i - 1] === '\t')) return null
      if (line[i] === ':' && wsOrEnd(line, i + 1)) {
        colon = i
        break
      }
    }
    if (colon < 0 || line.slice(0, colon).trim() === '') return null
    tokenEnd = colon
  }
  const key = decodeKey(line.slice(0, tokenEnd))
  return key === null ? null : { key, prefix: line.slice(0, colon + 1) }
}

// Fim de nome de âncora ou alias.
const ANCHOR_NAME_STOP = ' \t[]{},'
const FLOW_INDICATORS = ',[]{}'

// Varre o bloco da chave atrás de âncora ou alias em início de nó. `open-quote` = o bloco
// termina dentro de um texto entre aspas, ou seja, o valor continua além do que este modelo
// de linhas vê (uma linha de coluna 0 que é texto, não comentário nem chave).
function scanBlock(block: string[], valueStart: number): 'ok' | 'anchor' | 'open-quote' {
  let quote: string | null = null
  let depth = 0 // profundidade de flow: `[` e `{` abertos
  let scalarIndent = -1 // >= 0: dentro de um bloco `|`/`>`, cujas linhas têm recuo maior que este
  for (let n = 0; n < block.length; n++) {
    const line = block[n]
    const indent = /^[ \t]*/.exec(line)![0].length
    if (n > 0 && scalarIndent >= 0) {
      if (indent === line.length || indent > scalarIndent) continue
      scalarIndent = -1
    }
    // Começo de nó: logo depois do `:` da linha da chave, ou no conteúdo de uma continuação.
    let start = quote === null
    // Coluna do nó dono de um `|`/`>`: a do último `-` de item ou a da chave cujo `:` passou.
    // O conteúdo do bloco tem recuo maior que ela, não maior que o da linha (`- k: |`).
    let owner = n === 0 ? 0 : indent
    let token = owner // coluna onde começou o último nó
    let afterQuote = false // o último nó foi um texto entre aspas: `"k":v` é par em flow
    for (let i = n === 0 ? valueStart : indent; i < line.length; i++) {
      const c = line[i]
      if (quote !== null) {
        if (quote === '"' && c === '\\') i++
        else if (c === quote) {
          if (quote === "'" && line[i + 1] === "'") i++
          else {
            quote = null
            start = false
            afterQuote = true
          }
        }
        continue
      }
      if (c === ' ' || c === '\t') continue
      if (c === '#' && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) break
      if (start) {
        if ((c === '&' || c === '*') && i + 1 < line.length && !ANCHOR_NAME_STOP.includes(line[i + 1])) return 'anchor'
        if (c === '"' || c === "'") {
          quote = c
          token = i
          continue
        }
        if ((c === '|' || c === '>') && depth === 0) {
          scalarIndent = owner
          break
        }
        // Etiqueta (`!t`): a âncora pode vir depois dela, no mesmo nó.
        if (c === '!') {
          while (i + 1 < line.length && !wsOrEnd(line, i + 1)) i++
          continue
        }
        if ((c === '-' || c === '?') && wsOrEnd(line, i + 1)) {
          owner = i
          continue
        }
        token = i
      }
      const quoted = afterQuote
      afterQuote = false
      // `[`, `{` e `,` só abrem nó dentro de flow (ou `[`/`{` no começo de um): no meio de um
      // escalar simples em bloco são texto (`Livro, *edição*`).
      if ((c === '[' || c === '{') && (start || depth > 0)) {
        depth++
        start = true
      } else if ((c === ']' || c === '}') && depth > 0) {
        depth--
        start = false
      } else if (c === ',' && depth > 0) {
        start = true
      } else if (c === ':' && (wsOrEnd(line, i + 1) || (depth > 0 && (quoted || FLOW_INDICATORS.includes(line[i + 1]))))) {
        if (depth === 0) owner = token
        start = true
      } else {
        start = false
      }
    }
  }
  return quote === null ? 'ok' : 'open-quote'
}

// ─── Formato gravado ──────────────────────────────────────────────────────────

export interface EditNext {
  type: PropertyType
  value: PropertyValue
}

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

// As linhas novas da chave, sem a quebra. Lança se o valor não tem a forma do tipo: o valor
// chega já validado, e data sem aspas fora do formato poderia escrever outra chave.
function formatLines(prefix: string, { type, value }: EditNext): string[] {
  if (LIST_PROPERTY_TYPES.has(type)) {
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      return value.length === 0 ? [`${prefix} []`] : [prefix, ...value.map((item) => `  - ${yamlString(item as string)}`)]
    }
  } else if (value === null) {
    return [prefix]
  } else if (type === 'text' && typeof value === 'string') {
    return [`${prefix} ${yamlString(value)}`]
  } else if (type === 'number' && typeof value === 'number') {
    return [`${prefix} ${String(value)}`]
  } else if (type === 'checkbox' && typeof value === 'boolean') {
    return [`${prefix} ${value}`]
  } else if (
    typeof value === 'string' &&
    ((type === 'date' && DATE_SHAPE.test(value)) || (type === 'datetime' && DATETIME_SHAPE.test(value)))
  ) {
    return [`${prefix} ${value}`]
  }
  throw new TypeError(`valor fora da forma do tipo ${type}`)
}

// O valor que o YAML tem de devolver para o que `formatLines` escreveu.
function expectedValue({ type, value }: EditNext): unknown {
  if (type === 'date' && typeof value === 'string') {
    const [y, m, d] = value.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d))
  }
  return value
}

// ─── Conferência ──────────────────────────────────────────────────────────────

function sameYamlValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && Object.is(a.getTime(), b.getTime())
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameYamlValue(x, b[i]))
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    const ra = a as Record<string, unknown>
    const rb = b as Record<string, unknown>
    return sameList(ka, kb) && ka.every((k) => sameYamlValue(ra[k], rb[k]))
  }
  return a === b || (Number.isNaN(a) && Number.isNaN(b))
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i])

// A rede de segurança: relê o texto novo e confere que só a chave mudou, e para o valor certo.
function verifyEdit(before: string, after: string, data: Record<string, unknown>, key: string, next: EditNext): boolean {
  const reread = readFrontmatterData(after)
  if (!reread.ok) return false
  const keys = Object.keys(data)
  if (!sameList(keys, Object.keys(reread.data))) return false
  for (const k of keys) {
    if (!sameYamlValue(reread.data[k], k === key ? expectedValue(next) : data[k])) return false
  }
  try {
    return parseYamlFrontmatter(before).content === parseYamlFrontmatter(after).content
  } catch {
    return false
  }
}

// ─── Edição ───────────────────────────────────────────────────────────────────

export type EditRefusal =
  | 'no-frontmatter'
  | 'unreadable'
  | 'duplicate-key'
  | 'not-a-map'
  | 'missing-key'
  | 'anchor'
  | 'unsupported'
  | 'verify-failed'

export type EditResult = { ok: true; text: string } | { ok: false; reason: EditRefusal }

const refuse = (reason: EditRefusal): EditResult => ({ ok: false, reason })

/**
 * Troca o valor de `key` no frontmatter de `text` (o arquivo decodificado, com BOM e CRLF se
 * houver), reescrevendo só o bloco dessa chave. `next.value` vem de `validateEditValue`.
 *
 * @throws {TypeError} quando `next.value` não tem a forma de `next.type` (uma data fora de
 * `AAAA-MM-DD`, por exemplo). É erro de quem chama, fora do contrato de recusas.
 */
export function editFrontmatterValue(text: string, key: string, next: EditNext): EditResult {
  const read = readFrontmatterData(text)
  if (!read.ok) return refuse(read.reason)
  const { data } = read

  const bom = text.startsWith(BOM) ? BOM : ''
  const lines: string[] = text.slice(bom.length).match(LINE) ?? []
  // Fechamento: a primeira linha depois da abertura que começa com `---`, como no gray-matter.
  const close = lines.findIndex((line, i) => i > 0 && line.startsWith('---'))
  if (close < 0) return refuse('unsupported')

  // Um `\r` solto é quebra de linha para o js-yaml, mas não para este modelo de linhas.
  for (let i = 0; i < close; i++) if (content(lines[i]).includes('\r')) return refuse('unsupported')

  const keyLines: (KeyToken & { index: number })[] = []
  for (let i = 1; i < close; i++) {
    const line = content(lines[i])
    const kind = classify(line)
    if (kind === 'key') {
      const token = readKeyToken(line)
      if (token === null) return refuse('unsupported')
      keyLines.push({ ...token, index: i })
    } else if (kind === 'continuation' && keyLines.length === 0 && !/^[ \t]+#/.test(line)) {
      return refuse('unsupported')
    }
  }

  // As chaves que o modelo de linhas vê têm de ser as que o YAML leu: isso cobre merge e
  // continuação de valor sem recuo, que pareceriam linhas de chave.
  const names = keyLines.map((k) => k.key)
  if (new Set(names).size !== names.length) return refuse('duplicate-key')
  if (!sameList([...names].sort(), Object.keys(data).sort())) return refuse('unsupported')
  if (!Object.hasOwn(data, key)) return refuse('missing-key')

  // Bloco da chave: da linha dela até antes da próxima linha de chave ou do fechamento, sem
  // as brancas e os comentários de coluna 0 do fim, que ficam como estão.
  const at = names.indexOf(key)
  const start = keyLines[at].index
  const blockEnd = at + 1 < keyLines.length ? keyLines[at + 1].index : close
  let end = blockEnd
  while (end > start + 1 && classify(content(lines[end - 1])) !== 'continuation') end--

  const scan = scanBlock(lines.slice(start, end).map(content), keyLines[at].prefix.length)
  if (scan === 'anchor') return refuse('anchor')
  if (scan === 'open-quote') return refuse('unsupported')

  // As brancas e os comentários de coluna 0 que saíram do fim do bloco ficam no arquivo. Sem
  // confiar no modelo de aspas: o original sem essas linhas tem de ler igual, senão alguma
  // delas é parte de um valor (um texto entre aspas aberto até ali, a branca de um `|+`).
  if (end < blockEnd) {
    const probe = readFrontmatterData(bom + lines.slice(0, end).join('') + lines.slice(blockEnd).join(''))
    if (!probe.ok || !sameYamlValue(probe.data, data)) return refuse('unsupported')
  }

  const eol = lines[0].endsWith('\r\n') ? '\r\n' : '\n'
  const replacement = formatLines(keyLines[at].prefix, next).map((line) => line + eol).join('')
  const out = bom + lines.slice(0, start).join('') + replacement + lines.slice(end).join('')
  return verifyEdit(text, out, data, key, next) ? { ok: true, text: out } : refuse('verify-failed')
}
