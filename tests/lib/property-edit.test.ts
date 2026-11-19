import { describe, expect, it } from 'vitest'
import type { PageProperty, PropertyType, PropertyValue } from '@/builder/types'
import {
  initialChecked,
  initialItems,
  initialText,
  isEditable,
  isListType,
  listDraftValue,
  MAX_SUGGESTIONS,
  menuEntries,
  menuModel,
  enterPick,
  provisionalRow,
  sameValue,
  textDraftValue,
  visibleText,
} from '@/lib/property-edit'
import { propertyColor } from '@/lib/property-color'

function row(type: PropertyType, value: PropertyValue, extra: Partial<PageProperty> = {}): PageProperty {
  return { key: 'k', type, value, html: '', ...extra }
}

describe('isListType e isEditable', () => {
  it('reconhece os três tipos de lista', () => {
    expect(isListType('multitext')).toBe(true)
    expect(isListType('tags')).toBe(true)
    expect(isListType('aliases')).toBe(true)
    expect(isListType('text')).toBe(false)
    expect(isListType('checkbox')).toBe(false)
  })

  it('linha travada não é editável', () => {
    expect(isEditable(row('text', 'x'))).toBe(true)
    expect(isEditable(row('text', 'x', { locked: 'readonly' }))).toBe(false)
  })

  // O <input> de uma linha só tira as quebras: o texto chegaria achatado e seria gravado assim.
  it('texto com quebra de linha não é editável', () => {
    for (const br of ['\n', '\r', '\r\n', '\u0085', ' ', ' ']) {
      expect(isEditable(row('text', `line one${br}line two`))).toBe(false)
    }
    // o mesmo texto vindo de uma lista de um item só (mismatch), que o editor abriria igual
    expect(isEditable(row('text', ['line one\nline two'], { mismatch: true }))).toBe(false)
    expect(isEditable(row('text', ' todo '))).toBe(true)
    expect(isEditable(row('text', ['a', 'b'], { mismatch: true }))).toBe(true)
    // os outros tipos escalares não abrem o texto cru
    expect(isEditable(row('number', '1\n2', { mismatch: true }))).toBe(true)
  })

  // O campo da seleção múltipla também é um <input> de uma linha: um item com quebra seria
  // gravado de volta sem o usuário poder vê-lo nem corrigi-lo.
  it('lista com quebra de linha num item não é editável', () => {
    for (const type of ['multitext', 'tags', 'aliases'] as const) {
      for (const br of ['\n', '\r', '\u0085', ' ', ' ']) {
        expect(isEditable(row(type, ['ok', `a${br}b`]))).toBe(false)
      }
      expect(isEditable(row(type, ['RPG', 'Indie']))).toBe(true)
      expect(isEditable(row(type, []))).toBe(true)
    }
    // os itens que o editor abriria (`initialItems`): o valor solto de uma linha mismatch
    // conta, e a quebra que o trim tira das pontas não
    expect(isEditable(row('tags', 'a\nb', { mismatch: true }))).toBe(false)
    expect(isEditable(row('tags', 'a', { mismatch: true }))).toBe(true)
    expect(isEditable(row('multitext', ['a\n']))).toBe(true)
  })
})

describe('visibleText', () => {
  it('tira as tags e decodifica as entidades', () => {
    expect(visibleText('todo')).toBe('todo')
    expect(visibleText('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot; &#39;z&#39;')).toBe('<b>x</b> & "y" \'z\'')
    expect(visibleText('see <a href="/vault/my-vault/Notes/Other" class="internal-link">Other</a> now')).toBe('see Other now')
    expect(visibleText('&amp;lt;')).toBe('&lt;')
  })

  it('junta os espaços e apara', () => {
    expect(visibleText('  a \n  b  ')).toBe('a b')
    expect(visibleText('')).toBe('')
  })

  // Os chips de uma lista vêm colados no HTML; sem separador o nome sairia "RPGIndie".
  it('chips de lista saem separados por vírgula', () => {
    const chip = (s: string) => `<span class="vault-prop-chip" data-color="blue">${s}</span>`
    expect(visibleText(chip('RPG') + chip('Indie'))).toBe('RPG, Indie')
    expect(visibleText(chip('<a href="/vault/my-vault/Notes/Other" class="internal-link">Other</a>') + chip('a &amp; b')))
      .toBe('Other, a & b')
    expect(visibleText(chip('RPG'))).toBe('RPG')
  })

  // Numa relação, a nota sai como título (sem chip), também colada no HTML.
  it('títulos de nota de uma relação saem separados por vírgula, junto dos chips', () => {
    const chip = (s: string) => `<span class="vault-prop-chip" data-color="blue">${s}</span>`
    const note = (s: string) => `<span class="vault-prop-note">${s}</span>`
    expect(visibleText(
      note('<a href="/vault/my-vault/Games/Alpha">Alpha</a>') + note('<span class="vault-dead-link">Beta</span>') + chip('solto'),
    )).toBe('Alpha, Beta, solto')
    expect(visibleText(note('<span class="vault-prop-note-title">a &amp; b</span>') + note('<a href="/x">C</a>')))
      .toBe('a & b, C')
  })
})

describe('initialText', () => {
  it('number com string numérica (mismatch) mantém o texto; com lixo abre vazio', () => {
    expect(initialText(row('number', '12', { mismatch: true }))).toBe('12')
    expect(initialText(row('number', 'abc', { mismatch: true }))).toBe('')
    expect(initialText(row('number', 12.5))).toBe('12.5')
  })

  it('text com lista de um item vira o item; com mais de um abre vazio', () => {
    expect(initialText(row('text', ['a'], { mismatch: true }))).toBe('a')
    expect(initialText(row('text', ['a', 'b'], { mismatch: true }))).toBe('')
  })

  it('text converte número e booleano e esvazia o resto', () => {
    expect(initialText(row('text', 'olá'))).toBe('olá')
    expect(initialText(row('text', 5, { mismatch: true }))).toBe('5')
    expect(initialText(row('text', true, { mismatch: true }))).toBe('true')
    expect(initialText(row('text', null))).toBe('')
  })

  it('datetime com só data vira meia-noite', () => {
    expect(initialText(row('datetime', '2024-01-05', { mismatch: true }))).toBe('2024-01-05T00:00')
    expect(initialText(row('datetime', '2024-01-05T10:30'))).toBe('2024-01-05T10:30')
  })

  it('date inválida abre vazio', () => {
    expect(initialText(row('date', '2024-02-30', { mismatch: true }))).toBe('')
    expect(initialText(row('date', '2024-02-29'))).toBe('2024-02-29')
  })
})

describe('initialItems', () => {
  it('converte string, número, nulo e lista', () => {
    expect(initialItems(row('tags', 'a', { mismatch: true }))).toEqual(['a'])
    expect(initialItems(row('tags', 5, { mismatch: true }))).toEqual(['5'])
    expect(initialItems(row('tags', null))).toEqual([])
    expect(initialItems(row('tags', [' a ', '', 'b']))).toEqual(['a', 'b'])
  })
})

describe('initialChecked', () => {
  it('lê booleano e as strings true/false sem diferenciar caixa', () => {
    expect(initialChecked(row('checkbox', true))).toBe(true)
    expect(initialChecked(row('checkbox', 'TRUE', { mismatch: true }))).toBe(true)
    expect(initialChecked(row('checkbox', ' false ', { mismatch: true }))).toBe(false)
    expect(initialChecked(row('checkbox', 'yes', { mismatch: true }))).toBe(false)
  })
})

describe('textDraftValue', () => {
  it('number devolve número de verdade', () => {
    const r = textDraftValue('number', '12.5')
    expect(r).toEqual({ ok: true, value: 12.5 })
    expect(typeof (r as { value: unknown }).value).toBe('number')
  })

  it('number inválido dá erro e vazio dá null', () => {
    expect(textDraftValue('number', 'abc')).toEqual({ ok: false, errorKey: 'properties.error.number' })
    expect(textDraftValue('number', '1e999')).toEqual({ ok: false, errorKey: 'properties.error.number' })
    expect(textDraftValue('number', '')).toEqual({ ok: true, value: null })
  })

  it('date valida a data', () => {
    expect(textDraftValue('date', '2024-01-05')).toEqual({ ok: true, value: '2024-01-05' })
    expect(textDraftValue('date', '2024-02-30')).toEqual({ ok: false, errorKey: 'properties.error.date' })
  })

  it('datetime corta segundos e valida', () => {
    expect(textDraftValue('datetime', '2024-01-05T10:00:30')).toEqual({ ok: true, value: '2024-01-05T10:00' })
    expect(textDraftValue('datetime', '2024-01-05T10:00:30.123')).toEqual({ ok: true, value: '2024-01-05T10:00' })
    expect(textDraftValue('datetime', '2024-01-05T25:00')).toEqual({ ok: false, errorKey: 'properties.error.date' })
    expect(textDraftValue('datetime', '2024-02-30T10:00')).toEqual({ ok: false, errorKey: 'properties.error.date' })
  })

  it('text apara, vazio dá null, e recusa longo e quebra de linha', () => {
    expect(textDraftValue('text', '  x  ')).toEqual({ ok: true, value: 'x' })
    expect(textDraftValue('text', '   ')).toEqual({ ok: true, value: null })
    expect(textDraftValue('text', 'a'.repeat(10_001))).toEqual({ ok: false, errorKey: 'properties.error.tooLong' })
    expect(textDraftValue('text', 'a'.repeat(10_000))).toEqual({ ok: true, value: 'a'.repeat(10_000) })
    for (const ch of ['\n', '\r', '\u0085', '\u2028', '\u2029']) {
      expect(textDraftValue('text', `a${ch}b`)).toEqual({ ok: false, errorKey: 'properties.error.invalid' })
    }
    // espaço comum no meio é permitido
    expect(textDraftValue('text', 'a b')).toEqual({ ok: true, value: 'a b' })
  })
})

describe('listDraftValue', () => {
  it('apara, tira vazios e repetidos mantendo o primeiro', () => {
    expect(listDraftValue([' a ', '', 'a', 'b'])).toEqual(['a', 'b'])
  })
})

describe('provisionalRow', () => {
  it('escapa o texto', () => {
    const r = provisionalRow(row('text', ''), `<b>&"'`)
    expect(r.html).toBe('&lt;b&gt;&amp;&quot;&#39;')
    expect(r.value).toBe(`<b>&"'`)
  })

  it('lista vira chips com a cor da propriedade', () => {
    const r = provisionalRow(row('tags', []), ['a', '<x>'])
    expect(r.html).toBe(
      `<span class="vault-prop-chip" data-color="${propertyColor('k', 'a')}">a</span>` +
        `<span class="vault-prop-chip" data-color="${propertyColor('k', '<x>')}">&lt;x&gt;</span>`,
    )
  })

  it('item wikilink aparece pelo nome, com a cor do valor cru, e o valor segue cru', () => {
    const r = provisionalRow(row('multitext', []), ['[[Notes/Other|Apelido]]', 'a'])
    expect(r.html).toBe(
      `<span class="vault-prop-chip" data-color="${propertyColor('k', '[[Notes/Other|Apelido]]')}">Apelido</span>` +
        `<span class="vault-prop-chip" data-color="${propertyColor('k', 'a')}">a</span>`,
    )
    expect(r.value).toEqual(['[[Notes/Other|Apelido]]', 'a'])
  })

  it('date e datetime saem em dd/MM/aaaa', () => {
    expect(provisionalRow(row('date', null), '2024-01-05').html).toBe('05/01/2024')
    expect(provisionalRow(row('datetime', null), '2024-01-05T10:30').html).toBe('05/01/2024 10:30')
  })

  it('checkbox sai marcado ou não', () => {
    expect(provisionalRow(row('checkbox', null), true).html).toBe(
      '<input type="checkbox" class="vault-prop-checkbox" checked disabled>',
    )
    expect(provisionalRow(row('checkbox', null), false).html).toBe(
      '<input type="checkbox" class="vault-prop-checkbox" disabled>',
    )
  })

  it('número vira texto; vazio e lista vazia dão html vazio', () => {
    expect(provisionalRow(row('number', null), 3.5).html).toBe('3.5')
    expect(provisionalRow(row('number', 1), null).html).toBe('')
    expect(provisionalRow(row('tags', ['a']), []).html).toBe('')
  })

  it('some com mismatch e locked, e mantém chave e tipo', () => {
    const r = provisionalRow(row('number', '12', { mismatch: true, locked: 'readonly' }), 12)
    expect(r).toEqual({ key: 'k', type: 'number', value: 12, html: '12' })
    expect('mismatch' in r).toBe(false)
    expect('locked' in r).toBe(false)
  })
})

describe('sameValue', () => {
  it('compara em profundidade', () => {
    expect(sameValue([1, 2], [1, 2])).toBe(true)
    expect(sameValue([1, 2], [2, 1])).toBe(false)
    expect(sameValue({ a: 1, b: [2] }, { b: [2], a: 1 })).toBe(true)
    expect(sameValue(null, '')).toBe(false)
    expect(sameValue(1, '1')).toBe(false)
    expect(sameValue(null, null)).toBe(true)
  })
})

describe('provisionalRow com cor escolhida e seleção única', () => {
  it('lista: o chip usa a cor escolhida, e `colors` é copiado', () => {
    const base = row('multitext', ['RPG'], { key: 'genres', colors: { RPG: 'green' } })
    const out = provisionalRow(base, ['RPG', 'Indie'])
    expect(out.html).toContain('data-color="green">RPG</span>')
    expect(out.html).toContain(`data-color="${propertyColor('genres', 'Indie')}">Indie</span>`)
    expect(out.colors).toEqual({ RPG: 'green' })
    expect(out.select).toBeUndefined()
  })

  it('sem select nem colors a linha sai como antes (chaves e ordem)', () => {
    const out = provisionalRow(row('text', 'x'), 'y')
    expect(Object.keys(out)).toEqual(['key', 'type', 'value', 'html'])
  })

  it('select: um chip do valor aparado, select e colors copiados, sem mismatch nem locked', () => {
    const base = row('text', 'todo', { key: 'status', select: true, colors: { done: 'red' }, mismatch: true, locked: 'readonly' })
    const out = provisionalRow(base, '  done  ')
    expect(out.html).toBe('<span class="vault-prop-chip" data-color="red">done</span>')
    expect(out.select).toBe(true)
    expect(out.colors).toEqual({ done: 'red' })
    expect(out.mismatch).toBeUndefined()
    expect(out.locked).toBeUndefined()
    expect(Object.keys(out)).toEqual(['key', 'type', 'value', 'html', 'select', 'colors'])
  })

  it('select com valor nulo ou em branco: html vazio', () => {
    const base = row('text', 'todo', { key: 'status', select: true })
    expect(provisionalRow(base, null).html).toBe('')
    expect(provisionalRow(base, '   ').html).toBe('')
  })
})

describe('menuModel', () => {
  const entries = menuEntries(['RPG Tático', 'RPG', 'Ação', 'Indie'])
  const none = { exclude: [], taken: [] }

  it('texto vazio lista tudo e não cria', () => {
    const m = menuModel(entries, '', none)
    expect(m.suggested).toEqual(['RPG Tático', 'RPG', 'Ação', 'Indie'])
    expect(m.hidden).toBe(0)
    expect(m.create).toBeNull()
  })

  it('filtra por cru e nome, ignorando caixa e acento; o igual ao digitado vem primeiro', () => {
    expect(menuModel(entries, 'rpg', none).suggested).toEqual(['RPG', 'RPG Tático'])
    expect(menuModel(entries, 'acao', none).suggested).toEqual(['Ação'])
    const links = menuEntries(['[[Nota A]]'])
    expect(menuModel(links, 'nota a', none).suggested).toEqual(['[[Nota A]]'])
  })

  it('`create` é o texto aparado, salvo se já existe nas entries ou em taken', () => {
    expect(menuModel(entries, '  Novo ', none).create).toBe('Novo')
    expect(menuModel(entries, 'RPG', none).create).toBeNull()
    expect(menuModel(entries, 'Novo', { exclude: [], taken: ['Novo'] }).create).toBeNull()
  })

  it('exclude some do menu; taken só barra o Criar', () => {
    const m = menuModel(entries, '', { exclude: ['RPG'], taken: [] })
    expect(m.suggested).not.toContain('RPG')
    expect(menuModel(entries, 'RPG', { exclude: ['RPG'], taken: [] }).create).toBeNull()
    expect(menuModel(entries, '', { exclude: [], taken: ['RPG'] }).suggested).toContain('RPG')
  })

  it('corta em MAX_SUGGESTIONS e conta o resto; o igual ao digitado não fica de fora', () => {
    const many = menuEntries([...Array.from({ length: 70 }, (_, i) => `item ${i}`), 'item'])
    const m = menuModel(many, 'item', none)
    expect(m.suggested).toHaveLength(MAX_SUGGESTIONS)
    expect(m.suggested[0]).toBe('item')
    expect(m.hidden).toBe(71 - MAX_SUGGESTIONS)
  })
})

describe('enterPick', () => {
  const entries = menuEntries(['RPG Tático', 'rpg', 'Ação', '[[Nota A]]'])

  it('os degraus: cru exato, nome exato, cru normalizado, nome normalizado', () => {
    expect(enterPick(entries, 'rpg', [])).toEqual({ value: 'rpg', chosen: false })
    expect(enterPick(entries, 'Nota A', [])).toEqual({ value: '[[Nota A]]', chosen: false })
    expect(enterPick(entries, 'acao', [])).toEqual({ value: 'Ação', chosen: false })
    expect(enterPick(entries, 'nota a', [])).toEqual({ value: '[[Nota A]]', chosen: false })
  })

  it('"RPG" não vira "RPG Tático"; sem correspondência entra o texto aparado', () => {
    expect(enterPick(menuEntries(['RPG Tático']), 'RPG', [])).toEqual({ value: 'RPG', chosen: false })
    expect(enterPick(entries, '  Novo ', [])).toEqual({ value: 'Novo', chosen: false })
  })

  it('já entre os escolhidos (cru ou nome, normalizados): chosen', () => {
    expect(enterPick(entries, 'ACAO', ['Ação'])).toEqual({ value: 'Ação', chosen: true })
    expect(enterPick(entries, 'nota a', ['[[Nota A]]'])).toEqual({ value: '[[Nota A]]', chosen: true })
  })
})

describe('provisionalRow numa relação', () => {
  const note = (s: string) => `<span class="vault-prop-note"><span class="vault-prop-note-title">${s}</span></span>`

  it('o item que é nota sai como título, sem chip; o texto solto continua chip; relation é copiado', () => {
    const base = row('multitext', [], { key: 'related', relation: true, colors: { solto: 'red', '[[Alpha]]': 'green' } })
    const out = provisionalRow(base, ['[[Alpha]]', '[[Games/B|a & <b>]]', '[[Missing]]', 'solto'])
    expect(out.html).toBe(
      note('Alpha') + note('a &amp; &lt;b&gt;') + note('Missing') +
        '<span class="vault-prop-chip" data-color="red">solto</span>',
    )
    expect(out.html).not.toContain('green')
    expect(out.relation).toBe(true)
    expect(Object.keys(out)).toEqual(['key', 'type', 'value', 'html', 'colors', 'relation'])
  })

  it('texto com link no meio e [[]] continuam chip', () => {
    const base = row('multitext', [], { key: 'related', relation: true })
    const out = provisionalRow(base, ['ver [[Alpha]]', '[[]]'])
    expect(out.html).toBe(
      `<span class="vault-prop-chip" data-color="${propertyColor('related', 'ver [[Alpha]]')}">ver [[Alpha]]</span>` +
        `<span class="vault-prop-chip" data-color="${propertyColor('related', '[[]]')}">[[]]</span>`,
    )
  })

  it('lista sem relation: chips como antes, sem a chave relation', () => {
    const out = provisionalRow(row('multitext', [], { key: 'related' }), ['[[Alpha]]'])
    expect(out.html).toBe(`<span class="vault-prop-chip" data-color="${propertyColor('related', '[[Alpha]]')}">Alpha</span>`)
    expect('relation' in out).toBe(false)
  })
})
