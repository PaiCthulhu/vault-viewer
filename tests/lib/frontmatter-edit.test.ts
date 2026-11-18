import { describe, it, expect } from 'vitest'
import {
  MAX_PROPERTY_TEXT,
  editFrontmatterValue,
  readFrontmatterData,
  validateEditValue,
  yamlString,
} from '@/lib/frontmatter-edit'
import type { PropertyType, PropertyValue } from '@/builder/types'

// ─── Auxiliares ───────────────────────────────────────────────────────────────

function edit(text: string, key: string, type: PropertyType, value: PropertyValue): string {
  const r = editFrontmatterValue(text, key, { type, value })
  if (!r.ok) throw new Error(`recusou: ${r.reason}`)
  return r.text
}

function dataOf(text: string): Record<string, unknown> {
  const r = readFrontmatterData(text)
  if (!r.ok) throw new Error(`ilegível: ${r.reason}`)
  return r.data
}

const LINES = /[^\n]*\n|[^\n]+$/g
const bare = (line: string) => line.replace(/\r?\n$/, '')
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Confere byte a byte o que fica fora do bloco da chave: o prefixo até a linha da chave e o
// sufixo a partir do fim do bloco (sem as brancas e os comentários de coluna 0 do fim dele).
// `key` é a chave como está escrita no começo da linha (com aspas, se tiver). Devolve o índice
// da primeira linha de `before` que fica depois do bloco.
function outside(before: string, after: string, key: string): number {
  const lines = before.match(LINES) ?? []
  const keyLine = new RegExp(`^${escapeRe(key)}[ \\t]*:([ \\t]|$)`)
  const start = lines.findIndex((l, i) => i > 0 && keyLine.test(bare(l)))
  expect(start).toBeGreaterThan(0)
  let end = start + 1
  while (end < lines.length) {
    const c = bare(lines[end])
    if (c.startsWith('---')) break
    if (c.trim() !== '' && !/^([ \t#]|-([ \t]|$))/.test(c)) break
    end++
  }
  while (end > start + 1 && (bare(lines[end - 1]).trim() === '' || bare(lines[end - 1]).startsWith('#'))) end--
  const prefix = lines.slice(0, start).join('')
  const suffix = lines.slice(end).join('')
  expect(after.slice(0, prefix.length)).toBe(prefix)
  expect(after.slice(after.length - suffix.length)).toBe(suffix)
  expect(after.length).toBeGreaterThanOrEqual(prefix.length + suffix.length)
  return end
}

// ─── Gravação por tipo ────────────────────────────────────────────────────────

describe('editFrontmatterValue: formato gravado', () => {
  const base = '---\nstatus: draft\nrating: 3\n---\nCorpo\n'

  it('texto: grava entre aspas JSON', () => {
    const after = edit(base, 'status', 'text', 'ok')
    expect(after).toBe('---\nstatus: "ok"\nrating: 3\n---\nCorpo\n')
    outside(base, after, 'status')
  })

  it('texto "123" e "true" continuam texto', () => {
    const a = edit(base, 'status', 'text', '123')
    expect(a).toBe('---\nstatus: "123"\nrating: 3\n---\nCorpo\n')
    expect(dataOf(a).status).toBe('123')
    const b = edit(base, 'status', 'text', 'true')
    expect(dataOf(b).status).toBe('true')
  })

  it('número', () => {
    expect(edit(base, 'rating', 'number', 4.5)).toBe('---\nstatus: draft\nrating: 4.5\n---\nCorpo\n')
    expect(edit(base, 'rating', 'number', -3)).toBe('---\nstatus: draft\nrating: -3\n---\nCorpo\n')
    const big = edit(base, 'rating', 'number', 1e21)
    expect(dataOf(big).rating).toBe(1e21)
    outside(base, big, 'rating')
  })

  it('checkbox', () => {
    const before = '---\ndone: false\n---\n'
    expect(edit(before, 'done', 'checkbox', true)).toBe('---\ndone: true\n---\n')
  })

  it('data sem aspas', () => {
    const before = '---\ndue: 2023-12-31\n---\n'
    const after = edit(before, 'due', 'date', '2024-01-02')
    expect(after).toBe('---\ndue: 2024-01-02\n---\n')
    const due = dataOf(after).due
    expect(due).toBeInstanceOf(Date)
    expect((due as Date).toISOString()).toBe('2024-01-02T00:00:00.000Z')
  })

  it('data-hora sem aspas', () => {
    const before = '---\nat: 2023-12-31T08:00\n---\n'
    const after = edit(before, 'at', 'datetime', '2024-01-02T10:30')
    expect(after).toBe('---\nat: 2024-01-02T10:30\n---\n')
    expect(dataOf(after).at).toBe('2024-01-02T10:30')
  })

  it('lista em bloco vira bloco', () => {
    const before = '---\ngenres:\n  - a\n  - b\nz: 1\n---\n'
    const after = edit(before, 'genres', 'multitext', ['c'])
    expect(after).toBe('---\ngenres:\n  - "c"\nz: 1\n---\n')
    outside(before, after, 'genres')
  })

  it('lista flow vira bloco ao ser editada', () => {
    const before = '---\ngenres: [a, b]\nz: 1\n---\n'
    const after = edit(before, 'genres', 'tags', ['a', 'b', 'c'])
    expect(after).toBe('---\ngenres:\n  - "a"\n  - "b"\n  - "c"\nz: 1\n---\n')
    expect(dataOf(after).genres).toEqual(['a', 'b', 'c'])
  })

  it('lista no mesmo recuo da chave', () => {
    const before = '---\ngenres:\n- a\n- b\nz: 1\n---\n'
    const after = edit(before, 'genres', 'aliases', ['x'])
    expect(after).toBe('---\ngenres:\n  - "x"\nz: 1\n---\n')
    outside(before, after, 'genres')
    const other = edit(before, 'z', 'number', 2)
    expect(other).toBe('---\ngenres:\n- a\n- b\nz: 2\n---\n')
  })

  it('lista vazia', () => {
    const before = '---\ngenres:\n  - a\nz: 1\n---\n'
    const after = edit(before, 'genres', 'multitext', [])
    expect(after).toBe('---\ngenres: []\nz: 1\n---\n')
    expect(dataOf(after).genres).toEqual([])
  })

  it('valor apagado mantém a chave', () => {
    const after = edit(base, 'status', 'text', null)
    expect(after).toBe('---\nstatus:\nrating: 3\n---\nCorpo\n')
    expect(dataOf(after)).toEqual({ status: null, rating: 3 })
    expect(edit(base, 'rating', 'number', null)).toBe('---\nstatus: draft\nrating:\n---\nCorpo\n')
    const dates = '---\ndue: 2024-01-02\nat: 2024-01-02T10:30\ndone: true\n---\n'
    expect(edit(dates, 'due', 'date', null)).toBe('---\ndue:\nat: 2024-01-02T10:30\ndone: true\n---\n')
    expect(edit(dates, 'at', 'datetime', null)).toBe('---\ndue: 2024-01-02\nat:\ndone: true\n---\n')
    expect(edit(dates, 'done', 'checkbox', null)).toBe('---\ndue: 2024-01-02\nat: 2024-01-02T10:30\ndone:\n---\n')
  })

  it('chave com aspas mantém a grafia', () => {
    const dq = '---\n"my key": x\n---\n'
    expect(edit(dq, 'my key', 'text', 'y')).toBe('---\n"my key": "y"\n---\n')
    const sq = "---\n'it''s': x\n---\n"
    const after = edit(sq, "it's", 'text', 'y')
    expect(after).toBe("---\n'it''s': \"y\"\n---\n")
    expect(dataOf(after)["it's"]).toBe('y')
  })

  it('chave com acento', () => {
    expect(edit('---\ngênero: x\n---\n', 'gênero', 'text', 'y')).toBe('---\ngênero: "y"\n---\n')
    const spaced = '---\nAvaliação  : 3\nz: 1\n---\n'
    const after = edit(spaced, 'Avaliação', 'number', 5)
    expect(after).toBe('---\nAvaliação  : 5\nz: 1\n---\n')
    outside(spaced, after, 'Avaliação')
  })

  it('CRLF', () => {
    const before = '---\r\nstatus: draft\r\ngenres:\r\n  - a\r\nrating: 3\r\n---\r\nCorpo\r\nfim\r\n'
    const a = edit(before, 'genres', 'multitext', ['x', 'y'])
    expect(a).toBe('---\r\nstatus: draft\r\ngenres:\r\n  - "x"\r\n  - "y"\r\nrating: 3\r\n---\r\nCorpo\r\nfim\r\n')
    outside(before, a, 'genres')
    const b = edit(before, 'status', 'text', 'ok')
    expect(b).toBe('---\r\nstatus: "ok"\r\ngenres:\r\n  - a\r\nrating: 3\r\n---\r\nCorpo\r\nfim\r\n')
    expect(dataOf(b)).toEqual({ status: 'ok', genres: ['a'], rating: 3 })
  })

  it('BOM', () => {
    const before = '\uFEFF---\nstatus: draft\n---\nCorpo\n'
    const after = edit(before, 'status', 'text', 'ok')
    expect(after).toBe('\uFEFF---\nstatus: "ok"\n---\nCorpo\n')
    expect(dataOf(after).status).toBe('ok')
  })

  it('comentário YAML entre chaves fica', () => {
    const before = '---\na: 1\n# sobre b\nb: 2\n---\n'
    const after = edit(before, 'a', 'number', 2)
    expect(after).toBe('---\na: 2\n# sobre b\nb: 2\n---\n')
    outside(before, after, 'a')
    const list = '---\ngenres:\n  - a\n  # sobre a lista\n  - b\nz: 1\n---\n'
    expect(edit(list, 'genres', 'multitext', ['c'])).toBe('---\ngenres:\n  - "c"\nz: 1\n---\n')
  })

  it('última chave antes do ---', () => {
    const before = '---\na: 1\nb: 2\n---\nCorpo\n'
    expect(edit(before, 'b', 'text', 'x')).toBe('---\na: 1\nb: "x"\n---\nCorpo\n')
    const trailing = '---\na: 1\nb: 2\n\n# fim\n---\nCorpo\n'
    const after = edit(trailing, 'b', 'text', 'x')
    expect(after).toBe('---\na: 1\nb: "x"\n\n# fim\n---\nCorpo\n')
    outside(trailing, after, 'b')
  })

  it('primeira chave logo depois do ---', () => {
    const before = '---\na: 1\nb: 2\n---\n'
    const after = edit(before, 'a', 'text', 'x')
    expect(after).toBe('---\na: "x"\nb: 2\n---\n')
    outside(before, after, 'a')
  })

  it('bloco | substituído inteiro', () => {
    const before = '---\nnotes: |\n  linha 1\n  # não é comentário\n  linha 3\nz: 1\n---\n'
    expect(dataOf(before).notes).toBe('linha 1\n# não é comentário\nlinha 3\n')
    const after = edit(before, 'notes', 'text', 'novo')
    expect(after).toBe('---\nnotes: "novo"\nz: 1\n---\n')
    outside(before, after, 'notes')
  })

  it('string multilinha indentada substituída inteira', () => {
    const dq = '---\ndesc: "linha 1\n  linha 2"\nz: 1\n---\n'
    expect(edit(dq, 'desc', 'text', 'x')).toBe('---\ndesc: "x"\nz: 1\n---\n')
    const plain = '---\ndesc: uma\n  duas\nz: 1\n---\n'
    expect(dataOf(plain).desc).toBe('uma duas')
    expect(edit(plain, 'desc', 'text', 'x')).toBe('---\ndesc: "x"\nz: 1\n---\n')
  })

  it('comentário no fim da linha da chave sai com o valor', () => {
    const before = '---\nstatus: draft # rascunho\nz: 1\n---\n'
    expect(edit(before, 'status', 'text', 'ok')).toBe('---\nstatus: "ok"\nz: 1\n---\n')
  })

  it('corpo intacto mesmo com --- e ---- no corpo', () => {
    const before = '---\nstatus: draft\n---\nCorpo\n---\n----\nstatus: x\n'
    expect(edit(before, 'status', 'text', 'ok')).toBe('---\nstatus: "ok"\n---\nCorpo\n---\n----\nstatus: x\n')
  })

  it('abertura ---yaml', () => {
    const before = '---yaml\nstatus: draft\n---\n'
    expect(edit(before, 'status', 'text', 'ok')).toBe('---yaml\nstatus: "ok"\n---\n')
  })
})

// ─── Recusas ──────────────────────────────────────────────────────────────────

describe('editFrontmatterValue: recusas', () => {
  const refused = (text: string, key: string, reason: string, type: PropertyType = 'text', value: PropertyValue = 'y') =>
    expect(editFrontmatterValue(text, key, { type, value })).toEqual({ ok: false, reason })

  it('missing-key e no-frontmatter', () => {
    refused('---\nstatus: x\n---\n', 'rating', 'missing-key')
    refused('---\n---\n', 'status', 'missing-key')
    refused('---\n# só\n# comentários\n---\n', 'status', 'missing-key')
    refused('Sem frontmatter\nstatus: x\n', 'status', 'no-frontmatter')
    refused('----\nstatus: x\n----\n', 'status', 'no-frontmatter')
    refused('\uFEFF\uFEFF---\nstatus: x\n---\n', 'status', 'no-frontmatter')
  })

  it('anchor: âncora ou alias no bloco-alvo', () => {
    const text = '---\na: &x 1\nb: *x\n---\n'
    refused(text, 'a', 'anchor')
    refused(text, 'b', 'anchor')
    refused('---\na:\n  - &x q\n---\n', 'a', 'anchor', 'multitext', ['r'])
    refused('---\na: [p, &x q]\n---\n', 'a', 'anchor')
    refused('---\na: {k: *x}\n---\n', 'a', 'unreadable')
  })

  it('âncora em outra chave não impede editar uma terceira', () => {
    const before = '---\na: &x 1\nb: *x\nc: 3\n---\n'
    const after = edit(before, 'c', 'text', 'y')
    expect(after).toBe('---\na: &x 1\nb: *x\nc: "y"\n---\n')
    expect(dataOf(after)).toEqual({ a: 1, b: 1, c: 'y' })
  })

  it('duplicate-key', () => {
    refused('---\na: 1\na: 2\n---\n', 'a', 'duplicate-key')
  })

  it('not-a-map', () => {
    refused('---\n- a\n---\n', 'a', 'not-a-map')
    refused('---\nsó texto\n---\n', 'a', 'not-a-map')
  })

  it('unreadable', () => {
    refused('---js\n{ a: 1 }\n---\n', 'a', 'unreadable')
    refused('---\na: [1\n---\n', 'a', 'unreadable')
    refused('---\na: b: c\n---\n', 'a', 'unreadable')
  })

  it('unsupported', () => {
    refused('---\na: 1\n', 'a', 'unsupported')
    refused('---\nbase: &b\n  x: 1\n<<: *b\n---\n', 'base', 'unsupported')
    refused('---\n? x\n: 1\n---\n', 'x', 'unsupported')
    refused('---\nk: "a\nb: c"\n---\n', 'k', 'unsupported')
  })
})

describe('editFrontmatterValue: texto que parece YAML', () => {
  it('& e * em texto não são âncora', () => {
    expect(edit('---\ntitle: AT&T e 2*3\n---\n', 'title', 'text', 'x')).toBe('---\ntitle: "x"\n---\n')
    expect(edit('---\ntitle: "&x"\n---\n', 'title', 'text', 'x')).toBe('---\ntitle: "x"\n---\n')
  })

  it('__proto__ e chaves numéricas', () => {
    const proto = '---\n__proto__: 1\nb: 2\n---\n'
    const a = edit(proto, '__proto__', 'text', 'x')
    expect(a).toBe('---\n__proto__: "x"\nb: 2\n---\n')
    const pd = dataOf(a)
    expect(Object.keys(pd)).toEqual(['__proto__', 'b'])
    expect(Object.getOwnPropertyDescriptor(pd, '__proto__')?.value).toBe('x')
    expect(Object.getPrototypeOf(pd)).toBe(Object.prototype)

    const nums = '---\nb: 0\n2: x\n1: y\n---\n'
    const n = edit(nums, '1', 'text', 'z')
    expect(n).toBe('---\nb: 0\n2: x\n1: "z"\n---\n')
    expect(Object.keys(dataOf(n))).toEqual(['1', '2', 'b'])
    expect(dataOf(n)).toEqual({ 1: 'z', 2: 'x', b: 0 })
  })

  const hostile = [
    'a: b',
    'x #y',
    `"q" 'r' \\ \``,
    '- [x] {y} *z &w !t |> %d @e',
    '---',
    'José 😀',
    'a\u2028b',
    '\u0085',
    '\uFEFF',
    '  espaço  ',
  ]
  it.each(hostile)('textos hostis voltam iguais: %j', (s) => {
    const before = '---\nstatus: draft\nz: 1\n---\nCorpo\n'
    const after = edit(before, 'status', 'text', s)
    expect(dataOf(after)).toEqual({ status: s, z: 1 })
    outside(before, after, 'status')
    expect(after.endsWith('z: 1\n---\nCorpo\n')).toBe(true)
  })
})

// ─── Tentativas de quebrar ────────────────────────────────────────────────────

// Casos montados para fazer a edição tocar um byte fora do bloco. Cada um tem de dar uma
// recusa ou uma reescrita exata.
describe('editFrontmatterValue: tentativas de quebrar', () => {
  const result = (text: string, key: string, type: PropertyType = 'text', value: PropertyValue = 'y') =>
    editFrontmatterValue(text, key, { type, value })

  it('# de coluna 0 dentro de aspas: recusa a chave, edita as outras', () => {
    for (const text of ['---\na: "x\n# y"\nb: 1\n---\n', "---\na: 'x\n# y'\nb: 1\n---\n"]) {
      expect(dataOf(text)).toEqual({ a: 'x # y', b: 1 })
      expect(result(text, 'a')).toEqual({ ok: false, reason: 'unsupported' })
      const after = edit(text, 'b', 'text', 'z')
      expect(after).toBe(text.replace('b: 1', 'b: "z"'))
      expect(dataOf(after)).toEqual({ a: 'x # y', b: 'z' })
    }
  })

  it('aspas com # e escapes no meio continuam um valor só', () => {
    const dq = '---\na: "a\\" # b"\nb: 1\n---\n'
    expect(edit(dq, 'a', 'text', 'y')).toBe('---\na: "y"\nb: 1\n---\n')
    expect(edit(dq, 'b', 'text', 'y')).toBe('---\na: "a\\" # b"\nb: "y"\n---\n')
    const sq = "---\na: 'a'' # b'\nb: 1\n---\n"
    expect(edit(sq, 'a', 'text', 'y')).toBe('---\na: "y"\nb: 1\n---\n')
  })

  it('formas que o modelo de linhas não acompanha dão unsupported', () => {
    expect(result('---\na: 1\rb: 2\n---\n', 'a')).toEqual({ ok: false, reason: 'unsupported' })
    expect(result('---\n\ta: 1\n---\n', 'a')).toEqual({ ok: false, reason: 'unsupported' })
    expect(result('---\na: 1\n...\n---\n', 'a')).toEqual({ ok: false, reason: 'unsupported' })
    expect(result('---\n{a: 1}\n---\n', 'a')).toEqual({ ok: false, reason: 'unsupported' })
    expect(result('---\n  a: 1\n---\n', 'a')).toEqual({ ok: false, reason: 'unsupported' })
  })

  it('|+ com branca no fim: a branca é parte do valor, então recusa', () => {
    const before = '---\na: |+\n  x\n\nb: 1\n---\n'
    expect(dataOf(before)).toEqual({ a: 'x\n\n', b: 1 })
    expect(result(before, 'a')).toEqual({ ok: false, reason: 'unsupported' })
    expect(edit('---\na: |+\n  x\nb: 1\n---\n', 'a', 'text', 'y')).toBe('---\na: "y"\nb: 1\n---\n')
    // com `|` a branca do fim não entra no valor: fica como está
    expect(edit('---\na: |\n  x\n\n# c\nb: 1\n---\n', 'a', 'text', 'y')).toBe('---\na: "y"\n\n# c\nb: 1\n---\n')
  })

  // O fim do bloco perde as brancas e os comentários de coluna 0. Quando um texto entre aspas
  // do valor ainda está aberto até uma dessas linhas, ela é parte do valor e não pode ficar.
  it.each([
    ['flow com chave entre aspas, aspas duplas', '---\na: {"k":"v\n# z"}\nb: 1\n---\n', 'text', 'y', { k: 'v # z' }],
    ['flow com chave entre aspas, aspas simples', "---\na: {'k':'v\n# z'}\nb: 1\n---\n", 'text', 'y', { k: 'v # z' }],
    ['par em lista flow', '---\na: ["k":"v\n# z"]\nb: 1\n---\n', 'text', 'y', [{ k: 'v # z' }]],
    ['irmão de um | em "- k:"', '---\na:\n  - k: |\n     x\n    m: "q\n# z"\nb: 1\n---\nCorpo\n', 'text', null, [{ k: 'x\n', m: 'q # z' }]],
    ['irmão de um | em "- -"', '---\na:\n  - - |\n      x\n    - "q\n# z"\nb: 1\n---\n', 'multitext', ['r'], [['x\n', 'q # z']]],
    ['irmão de um > com aspas simples', "---\na:\n  - k: >\n     x\n    m: 'q\n# z'\nb: 1\n---\n", 'text', null, [{ k: 'x\n', m: 'q # z' }]],
  ] as [string, string, PropertyType, PropertyValue, unknown][])(
    'aspas abertas até um comentário de coluna 0: %s',
    (_, text, type, value, a) => {
      expect(dataOf(text)).toEqual({ a, b: 1 })
      expect(result(text, 'a', type, value)).toEqual({ ok: false, reason: 'unsupported' })
    },
  )

  it('bloco com indicador de recuo e escalar simples em várias linhas', () => {
    expect(edit('---\na: |2\n    x\nb: 1\n---\n', 'a', 'text', 'y')).toBe('---\na: "y"\nb: 1\n---\n')
    expect(edit('---\na: x\n  continua\nb: 1\n---\n', 'a', 'text', 'y')).toBe('---\na: "y"\nb: 1\n---\n')
  })

  it('comentário de coluna 0 no meio de uma lista sai com ela', () => {
    const before = '---\na:\n  - p\n# c\n  - q\nb: 1\n---\n'
    expect(dataOf(before)).toEqual({ a: ['p', 'q'], b: 1 })
    expect(edit(before, 'a', 'multitext', ['r'])).toBe('---\na:\n  - "r"\nb: 1\n---\n')
  })

  it('comentário de coluna 0 entre duas linhas do bloco sai com ele', () => {
    const before = '---\ng:\n  - a\n# sobre b\n  - b\nz: 1\n---\n'
    expect(edit(before, 'g', 'multitext', ['c'])).toBe('---\ng:\n  - "c"\nz: 1\n---\n')
  })

  it('âncora atrás de etiqueta, de bloco escalar e aninhada', () => {
    expect(result('---\na: !!str &x 5\nb: *x\n---\n', 'a')).toEqual({ ok: false, reason: 'anchor' })
    const afterBlock = '---\na:\n  - |\n    t\n  - &x q\nb: *x\n---\n'
    expect(dataOf(afterBlock)).toEqual({ a: ['t\n', 'q'], b: 'q' })
    expect(result(afterBlock, 'a', 'multitext', ['r'])).toEqual({ ok: false, reason: 'anchor' })
    expect(result('---\na:\n  k:\n    - [p, &x q]\nb: *x\n---\n', 'a')).toEqual({ ok: false, reason: 'anchor' })
  })

  it('& dentro de um bloco escalar não é âncora', () => {
    const before = '---\na: |\n  &x q\n  *y\nb: 1\n---\n'
    expect(edit(before, 'a', 'text', 'y')).toBe('---\na: "y"\nb: 1\n---\n')
  })

  it('alias depois de chave entre aspas em flow e em irmão de um bloco escalar', () => {
    expect(result('---\np: &x 1\na: {"k":*x}\n---\n', 'a')).toEqual({ ok: false, reason: 'anchor' })
    const sibling = '---\np: &y 1\na:\n  - k: |\n     x\n    m: *y\n---\n'
    expect(dataOf(sibling)).toEqual({ p: 1, a: [{ k: 'x\n', m: 1 }] })
    expect(result(sibling, 'a')).toEqual({ ok: false, reason: 'anchor' })
  })

  it('[, { e , no meio de um escalar simples em bloco são texto, não começo de nó', () => {
    for (const [k, v] of [['a', 'x, &y'], ['description', 'Livro, *edição de bolso*'], ['title', 'notas [&rascunho]']]) {
      const before = `---\n${k}: ${v}\nz: 1\n---\n`
      expect(dataOf(before)).toEqual({ [k]: v, z: 1 })
      expect(edit(before, k, 'text', 'y')).toBe(`---\n${k}: "y"\nz: 1\n---\n`)
    }
    // dentro de flow de verdade continuam contando
    expect(result('---\na: [x, &y z]\n---\n', 'a')).toEqual({ ok: false, reason: 'anchor' })
    expect(result('---\na: {k: &y 1}\n---\n', 'a')).toEqual({ ok: false, reason: 'anchor' })
  })

  it('grafias de chave incomuns mantêm o prefixo', () => {
    expect(edit('---\n"a"\t: 1\n---\n', 'a', 'text', 'y')).toBe('---\n"a"\t: "y"\n---\n')
    expect(edit('---\n~: 1\n---\n', 'null', 'text', 'y')).toBe('---\n~: "y"\n---\n')
    expect(edit('---\na#b: 1\n---\n', 'a#b', 'text', 'y')).toBe('---\na#b: "y"\n---\n')
    expect(edit('---\n"<<": 1\n---\n', '<<', 'text', 'y')).toBe('---\n"<<": "y"\n---\n')
  })

  it('chaves que colidem depois de decodificadas: duplicate-key', () => {
    expect(result('---\n1: a\n1.0: b\n---\n', '1')).toEqual({ ok: false, reason: 'duplicate-key' })
  })

  it('caixa diferente e nomes do Object.prototype: missing-key', () => {
    expect(result('---\nStatus: x\n---\n', 'status')).toEqual({ ok: false, reason: 'missing-key' })
    expect(result('---\nStatus: x\n---\n', 'constructor')).toEqual({ ok: false, reason: 'missing-key' })
    expect(result('---\nStatus: x\n---\n', 'toString')).toEqual({ ok: false, reason: 'missing-key' })
  })

  it('lista flow em várias linhas: com recuo edita, na coluna 0 recusa', () => {
    expect(edit('---\na: [x,\n  y]\nb: 1\n---\n', 'a', 'multitext', ['z'])).toBe('---\na:\n  - "z"\nb: 1\n---\n')
    expect(result('---\na: [x,\ny]\nb: 1\n---\n', 'a', 'multitext', ['z'])).toEqual({ ok: false, reason: 'unsupported' })
  })

  it('brancas antes do fechamento e fechamento ---- ficam', () => {
    expect(edit('---\na: 1\n\n\n---\n', 'a', 'text', 'y')).toBe('---\na: "y"\n\n\n---\n')
    expect(edit('---\na: 1\n----\nCorpo\n', 'a', 'text', 'y')).toBe('---\na: "y"\n----\nCorpo\n')
  })

  it('abertura em CRLF num arquivo LF: as linhas novas seguem a abertura', () => {
    expect(edit('---\r\na: 1\nb: 2\n---\n', 'a', 'text', 'y')).toBe('---\r\na: "y"\r\nb: 2\n---\n')
  })

  it('número não finito passado direto não passa da conferência', () => {
    const base = '---\nrating: 3\n---\n'
    expect(result(base, 'rating', 'number', Number.NaN)).toEqual({ ok: false, reason: 'verify-failed' })
    expect(result(base, 'rating', 'number', Number.POSITIVE_INFINITY)).toEqual({ ok: false, reason: 'verify-failed' })
  })

  it('valor fora da forma do tipo lança em vez de gravar', () => {
    const base = '---\ndue: 2024-01-01\n---\n'
    expect(() => result(base, 'due', 'date', '2024-01-02\nx: 1')).toThrow(TypeError)
    expect(() => result(base, 'due', 'datetime', '2024-01-02 10:00')).toThrow(TypeError)
  })

  it('outras chaves com etiquetas e valores exóticos ficam iguais', () => {
    const before = [
      '---',
      's: !!set {p, q}',
      'bin: !!binary aGk=',
      'o: !!omap [{x: 1}]',
      'n: .nan',
      'd: 2024-02-30',
      'alvo: 1',
      '---',
      '',
    ].join('\n')
    const after = edit(before, 'alvo', 'text', 'y')
    expect(after).toBe(before.replace('alvo: 1', 'alvo: "y"'))
  })
})

// ─── Combinatório ─────────────────────────────────────────────────────────────

describe('editFrontmatterValue: combinatório de fragmentos', () => {
  const FRAGMENTS: { key: string | null; text: string }[] = [
    { key: 'fa', text: 'fa: valor simples\n' },
    { key: 'fb', text: 'fb: "entre: aspas # não é comentário"\n' },
    { key: 'fc', text: 'fc: [a, "b, c"]\n' },
    { key: 'fd', text: 'fd:\n  - um\n  - dois\n' },
    { key: 'fe', text: 'fe:\n- um\n- dois\n' },
    { key: 'ff', text: 'ff: |\n  linha 1\n  # não é comentário\n  linha 3\n' },
    { key: 'fg', text: 'fg: {"k":"v", "n": [1, 2]}\n' },
    { key: 'fh', text: 'fh:\n  - k: |\n     x\n    m: "q, &r"\n' },
    { key: 'fi', text: 'fi: Livro, *edição de bolso* [&rascunho]\n' },
    { key: null, text: '# comentário de coluna 0\n' },
    { key: null, text: '\n' },
  ]
  const EDITS: [PropertyType, PropertyValue][] = [
    ['text', 'novo: valor #1'],
    ['text', null],
    ['number', 42],
    ['checkbox', true],
    ['date', '2025-03-04'],
    ['datetime', '2025-03-04T05:06'],
    ['multitext', ['p', 'q']],
    ['tags', ['t']],
    ['aliases', []],
  ]
  const expected = (type: PropertyType, value: PropertyValue): unknown =>
    type === 'date' ? new Date(`${value as string}T00:00:00.000Z`) : value

  // Rotações da lista e do seu inverso: cada fragmento passa por vizinhos diferentes.
  const orders: (typeof FRAGMENTS)[] = []
  for (const list of [FRAGMENTS, [...FRAGMENTS].reverse()]) {
    for (let r = 0; r < list.length; r++) orders.push([...list.slice(r), ...list.slice(0, r)])
  }

  for (const eol of ['\n', '\r\n']) {
    it(`cada chave editada para cada tipo, sem mexer no resto (${JSON.stringify(eol)})`, () => {
      let count = 0
      for (const order of orders) {
        const frag = order.map((f) => ({ key: f.key, text: f.text.replace(/\n/g, eol) }))
        const open = `---${eol}`
        const close = `---${eol}Corpo${eol}`
        const text = open + frag.map((f) => f.text).join('') + close
        const before = dataOf(text)
        frag.forEach((f, i) => {
          if (f.key === null) return
          const prefix = open + frag.slice(0, i).map((g) => g.text).join('')
          const suffix = frag.slice(i + 1).map((g) => g.text).join('') + close
          for (const [type, value] of EDITS) {
            const r = editFrontmatterValue(text, f.key, { type, value })
            expect(r, `${f.key} ${type} ${JSON.stringify(value)} em ${JSON.stringify(text)}`).toMatchObject({ ok: true })
            if (!r.ok) continue
            expect(r.text.startsWith(prefix)).toBe(true)
            expect(r.text.endsWith(suffix)).toBe(true)
            const after = dataOf(r.text)
            expect(Object.keys(after)).toEqual(Object.keys(before))
            for (const k of Object.keys(before)) {
              expect(after[k]).toEqual(k === f.key ? expected(type, value) : before[k])
            }
            count++
          }
        })
      }
      expect(count).toBe(orders.length * FRAGMENTS.filter((f) => f.key !== null).length * EDITS.length)
    })
  }
})

// Fuzz com semente fixa: frontmatters sorteados de fragmentos comuns e hostis. Toda edição tem
// de dar recusa ou uma reescrita que deixa intacto o que está fora do bloco (`outside`), as
// outras chaves e o corpo. Nunca pode lançar.
describe('editFrontmatterValue: fuzz determinístico', () => {
  it('recusa ou reescreve exato, sem lançar', () => {
    let seed = 12345
    const rnd = (n: number) => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n)
    }
    const FRAGS: ((k: string) => string)[] = [
      (k) => `${k}: v`, (k) => `${k}: "q: #x"`, (k) => `${k}: 'it''s'`, (k) => `${k}: [a, b]`,
      (k) => `${k}: {x: 1}`, (k) => `${k}:\n  - a\n  - b`, (k) => `${k}:\n- a\n- b`,
      (k) => `${k}: |\n  x\n  # y`, (k) => `${k}: >-\n  a\n  b`, (k) => `${k}: 1 # c`, (k) => `${k}:`,
      (k) => `${k}: 2024-01-02`, (k) => `${k}: &A 1`, (k) => `${k}: *A`, (k) => `${k}: "multi\n  line"`,
      (k) => `${k}:\n  n: 1\n  m: [1, 2]`, (k) => `${k}: !!str 5`, (k) => `${k}:\n  - a\n# c\n  - b`,
      (k) => `${k}: |+\n  x\n`, (k) => `${k}: x\n  continua`, (k) => `${k}: [x,\n  y]`,
      (k) => `${k}: "a\nzz: c"`, (k) => `${k}: &M {p: 1}\n<<: *M`, (k) => `${k}: "x\n# y"`,
      (k) => `${k}: 1\r`, (k) => `${k}: [a,\nb]`, (k) => `${k}: 'x\n\n  y'`, (k) => `${k}: x, &y`,
      (k) => `${k}: "a\\" # b"`, (k) => `${k}: 'a'' # b'`, (k) => `${k}:   |2\n    x`,
      // aspas do valor abertas até um comentário de coluna 0, e as formas vizinhas editáveis
      (k) => `${k}: {"p":"v\n# z"}`, (k) => `${k}: {'p':'v\n# z'}`, (k) => `${k}: ["p":"v\n# z"]`,
      (k) => `${k}:\n  - p: |\n     x\n    m: "q\n# z"`, (k) => `${k}:\n  - - |\n      x\n    - "q\n# z"`,
      (k) => `${k}:\n  - p: >\n     x\n    m: 'q\n# z'`, (k) => `${k}: {"p":"v"}`, (k) => `${k}: {"p":*A}`,
      (k) => `${k}:\n  - p: |\n     x\n    m: "q"`, (k) => `${k}:\n  - p: |\n     x\n    m: *A`,
      (k) => `${k}: Livro, *edição de bolso*`, (k) => `${k}: notas [&rascunho]`, (k) => `${k}: |+\n  x\n\n# c`,
    ]
    const OTHER = ['# comentário', '', '   ', '  # indentado', '...', '? q', '  x: 1', '{z: 1}']
    const NAMES = ['a', '"b c"', "'d''e'", 'gênero', 'f  ', '1', '__proto__', 'g#h']
    // a chave decodificada de cada grafia, lida pelo próprio parser
    const decoded = new Map(NAMES.map((n) => [Object.keys(dataOf(`---\n${n}: 0\n---\n`))[0], n]))
    const EDITS: [PropertyType, PropertyValue][] = [
      ['text', 'novo'], ['text', null], ['number', 7], ['checkbox', false], ['date', '2020-05-06'],
      ['datetime', '2020-05-06T07:08'], ['multitext', ['x', 'y']], ['tags', []],
    ]
    const BOM = String.fromCharCode(0xfeff)

    let ok = 0
    let refused = 0
    for (let n = 0; n < 4000; n++) {
      const parts: string[] = []
      // linhas [início, fim) do fragmento de cada chave; a linha 0 é a abertura
      const spans = new Map<string, [number, number]>()
      let lineCount = 1
      const push = (part: string) => {
        parts.push(part)
        lineCount += part.split('\n').length
      }
      const count = 1 + rnd(6)
      for (let i = 0; i < count; i++) {
        if (rnd(3) === 0) {
          push(OTHER[rnd(OTHER.length)])
          continue
        }
        const name = NAMES[rnd(NAMES.length)]
        if (spans.has(name)) continue
        const first = lineCount
        push(FRAGS[rnd(FRAGS.length)](name))
        spans.set(name, [first, lineCount])
      }
      const eol = rnd(2) ? '\n' : '\r\n'
      const tail = ['---', 'Corpo', '---', 'x: 1', ''].join(eol)
      const text = (rnd(5) === 0 ? BOM : '') + ['---', ...parts, ''].join('\n').replace(/\n/g, eol) + tail
      const before = readFrontmatterData(text)
      if (!before.ok) continue
      for (const key of Object.keys(before.data)) {
        const [type, value] = EDITS[rnd(EDITS.length)]
        const r = editFrontmatterValue(text, key, { type, value })
        if (!r.ok) {
          refused++
          continue
        }
        ok++
        const raw = decoded.get(key)
        expect(raw, `editou ${JSON.stringify(key)}, que não é chave escrita, em ${JSON.stringify(text)}`).toBeDefined()
        const end = outside(text, r.text, raw as string)
        // Nenhuma linha do fragmento da chave fica depois do bloco, a não ser branca: um
        // comentário de coluna 0 que sobrou seria pedaço do valor antigo (aspas abertas).
        const lines = text.match(LINES) ?? []
        const [, fragEnd] = spans.get(raw as string) as [number, number]
        for (let j = end; j < fragEnd; j++) {
          expect(bare(lines[j]).trim(), `sobrou ${JSON.stringify(lines[j])} de ${JSON.stringify(text)} ${key}`).toBe('')
        }
        expect(r.text.endsWith(tail)).toBe(true)
        const after = dataOf(r.text)
        expect(Object.keys(after)).toEqual(Object.keys(before.data))
        for (const k of Object.keys(before.data)) if (k !== key) expect(after[k]).toEqual(before.data[k])
      }
    }
    // a amostra exercita os dois lados
    expect(ok).toBeGreaterThan(1000)
    expect(refused).toBeGreaterThan(1000)
  })
})

// ─── Leitura ──────────────────────────────────────────────────────────────────

describe('readFrontmatterData', () => {
  it('lê como o builder: CRLF, BOM e os motivos de recusa', () => {
    expect(readFrontmatterData('\uFEFF---\r\na: 1\r\nb:\r\n  - x\r\n---\r\nCorpo')).toEqual({
      ok: true,
      data: { a: 1, b: ['x'] },
    })
    expect(readFrontmatterData('---\n---\n')).toEqual({ ok: true, data: {} })
    expect(readFrontmatterData('Corpo')).toEqual({ ok: false, reason: 'no-frontmatter' })
    expect(readFrontmatterData('----\na: 1\n----\n')).toEqual({ ok: false, reason: 'no-frontmatter' })
    expect(readFrontmatterData('---\na: 1\na: 2\n---\n')).toEqual({ ok: false, reason: 'duplicate-key' })
    expect(readFrontmatterData('---\na: [\n---\n')).toEqual({ ok: false, reason: 'unreadable' })
    expect(readFrontmatterData('---json\n{"a": 1}\n---\n')).toEqual({ ok: false, reason: 'unreadable' })
    expect(readFrontmatterData('---\n- a\n---\n')).toEqual({ ok: false, reason: 'not-a-map' })
  })
})

// ─── Validação ────────────────────────────────────────────────────────────────

describe('validateEditValue', () => {
  const ERR = Symbol('erro')
  const cases: [PropertyType, unknown, PropertyValue | typeof ERR][] = [
    ['number', 12, 12],
    ['number', -0.5, -0.5],
    ['number', null, null],
    ['number', '12', ERR],
    ['number', Infinity, ERR],
    ['number', NaN, ERR],
    ['number', undefined, ERR],
    ['text', 'x', 'x'],
    ['text', '  espaço  ', '  espaço  '],
    ['text', '   ', null],
    ['text', null, null],
    ['text', 'x'.repeat(MAX_PROPERTY_TEXT), 'x'.repeat(MAX_PROPERTY_TEXT)],
    ['text', 'x'.repeat(10_001), ERR],
    ['text', 'a\nb', ERR],
    ['text', 'a\rb', ERR],
    ['text', 'a\u0085b', ERR],
    ['text', 'a\u2028b', ERR],
    ['text', 'a\u2029b', ERR],
    ['text', 3, ERR],
    ['text', undefined, ERR],
    ['date', '2024-01-02', '2024-01-02'],
    ['date', null, null],
    ['date', '2024-02-30', ERR],
    ['date', '2024-1-2', ERR],
    ['date', '0001-01-01', ERR],
    ['date', ' 2024-01-02', ERR],
    ['date', '2024-01-02T10:00', ERR],
    ['date', '', ERR],
    ['datetime', '2024-01-02T10:00', '2024-01-02T10:00'],
    ['datetime', null, null],
    ['datetime', '2024-01-02 10:00', ERR],
    ['datetime', '2024-01-02T10:00:00', ERR],
    ['datetime', '2024-01-02', ERR],
    ['datetime', '2024-01-02T24:00', ERR],
    ['multitext', [' a ', 'b'], ['a', 'b']],
    ['tags', [], []],
    ['aliases', ['x'], ['x']],
    ['multitext', ['a', 'a'], ERR],
    ['multitext', ['a', ' a'], ERR],
    ['multitext', [''], ERR],
    ['multitext', ['  '], ERR],
    ['multitext', ['a\nb'], ERR],
    ['tags', ['a\u2028b'], ERR],
    ['multitext', ['x'.repeat(10_001)], ERR],
    ['multitext', null, ERR],
    ['multitext', [1], ERR],
    ['aliases', 'a', ERR],
    ['checkbox', true, true],
    ['checkbox', false, false],
    ['checkbox', null, null],
    ['checkbox', 'true', ERR],
    ['checkbox', 1, ERR],
  ]
  it.each(cases)('%s %j', (type, raw, want) => {
    const r = validateEditValue(type, raw)
    if (want === ERR) {
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/\S/)
    } else {
      expect(r).toEqual({ ok: true, value: want })
    }
  })
})

describe('yamlString', () => {
  it('aspas JSON com as quebras e o BOM escapados', () => {
    expect(yamlString('a "b"')).toBe('"a \\"b\\""')
    expect(yamlString('a\u2028b\u0085\uFEFF')).toBe('"a\\u2028b\\u0085\\ufeff"')
  })
})
