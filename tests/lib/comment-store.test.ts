import { describe, it, expect } from 'vitest'
import { extractFrontmatter } from '@/builder/frontmatter'
import { parentRef } from '@/builder/note-family'
import { commentTime } from '@/builder/comments'
import {
  CommentError, commentFileName, isoWithOffset, normalizeBody, serializeComment,
} from '@/lib/comment-store'

const cc = (...codes: number[]) => String.fromCharCode(...codes)

describe('serializeComment', () => {
  const when = new Date(2026, 10, 16, 15, 30, 12)

  it('gera o frontmatter do desenho, com updated_at só quando existe', () => {
    const base = { parent: 'Notas/Minha Nota', author: 'ana', createdAt: when, updatedAt: null }
    const off = isoWithOffset(when).slice(19)
    expect(serializeComment(base, 'oi')).toBe(
      `---\nnote_type: comment\nparent: "[[Notas/Minha Nota]]"\nauthor: "ana"\ncreated_at: 2026-11-16T15:30:12${off}\n---\noi\n`,
    )
    expect(serializeComment({ ...base, updatedAt: when }, 'oi')).toContain(`\nupdated_at: 2026-11-16T15:30:12${off}\n---\n`)
    expect(serializeComment({ ...base, createdAt: null }, 'oi')).not.toContain('created_at')
  })

  it.each([
    ['dois-pontos e quebra de linha', 'a: b\nnote_type: tab'],
    ['aspas, barra invertida e cerquilha', `"x" 'y' \ # z`],
    ['controles e separadores de linha do Unicode', `a${cc(0, 7, 0x1b, 0x7f, 0x85, 0x2028, 0x2029, 0xfeff)}b`],
    ['indicadores do YAML', '- [x] {y} *z &w !t |> %d @e `f`'],
    ['parece outro tipo', 'true'],
    ['número', '123'],
    ['acentos e emoji', 'José Ação ' + cc(0xd83d, 0xde00)],
    ['fecha o frontmatter', '---'],
  ])('author hostil volta igual: %s', (_, author) => {
    const raw = serializeComment({ parent: 'Notas/Minha Nota', author, createdAt: when, updatedAt: when }, 'corpo')
    const { frontmatter, body } = extractFrontmatter(raw, 'x')
    expect(frontmatter.author).toBe(author)
    expect(frontmatter.note_type).toBe('comment')
    expect(parentRef(frontmatter.parent)).toBe('Notas/Minha Nota')
    expect(commentTime(frontmatter.created_at)).toBe(when.toISOString())
    expect(commentTime(frontmatter.updated_at)).toBe(when.toISOString())
    expect(Object.keys(frontmatter).sort()).toEqual(['author', 'created_at', 'note_type', 'parent', 'updated_at'])
    expect(body).toBe('corpo')
    // Os caracteres que o YAML trata como quebra de linha nunca vão crus para o arquivo.
    expect(raw.split('\n---\n')[0]).not.toMatch(new RegExp(`[${cc(0x85, 0x2028, 0x2029, 0xfeff)}]`))
  })

  it.each([
    'Notas/Minha Nota',
    'Notas/C# e [x]',
    'Notas/a]b',
    'Notas/x: y',
    "Notas/aspas ' e acento é",
  ])('o parent volta igual pelo parentRef: %s', parent => {
    const raw = serializeComment({ parent, author: 'ana', createdAt: when, updatedAt: null }, 'corpo')
    expect(parentRef(extractFrontmatter(raw, 'x').frontmatter.parent)).toBe(parent)
  })

  it('recusa um parent que o builder não conseguiria ler de volta', () => {
    const f = { author: 'ana', createdAt: when, updatedAt: null }
    expect(() => serializeComment({ ...f, parent: 'Notas/Nota.md' }, 'x')).toThrow(CommentError)
    expect(() => serializeComment({ ...f, parent: ' Notas/x' }, 'x')).toThrow(CommentError)
  })

  it.each([
    '---\nnote_type: tab\n---\ntexto',
    '---',
    'texto\n---\nauthor: root\n---',
    '```dataviewjs\nx\n```',
    '# título\n\n- item',
  ])('o corpo volta igual e não mexe no frontmatter: %j', body => {
    const raw = serializeComment({ parent: 'Notas/Minha Nota', author: 'ana', createdAt: when, updatedAt: null }, body)
    const parsed = extractFrontmatter(raw, 'x')
    expect(parsed.body).toBe(body)
    expect(parsed.frontmatter.note_type).toBe('comment')
    expect(parsed.frontmatter.author).toBe('ana')
  })
})

describe('isoWithOffset', () => {
  it('é a hora local com o offset, e representa o mesmo instante', () => {
    const d = new Date(2026, 0, 5, 3, 4, 5, 678)
    const iso = isoWithOffset(d)
    expect(iso).toMatch(/^2026-01-05T03:04:05[+-]\d\d:\d\d$/)
    expect(new Date(iso).getTime()).toBe(d.getTime() - 678)
  })
})

describe('commentFileName', () => {
  it('corta o username por caractere, sem partir um emoji no meio', () => {
    const emoji = String.fromCodePoint(0x1f600)
    const name = commentFileName(new Date(2026, 10, 6, 5, 3, 2), 'x'.repeat(39) + emoji + 'resto', 'k3f9')
    expect(name).toBe(`2026-11-06 050302 ${'x'.repeat(39)}${emoji}-k3f9`)
  })

  const when = new Date(2026, 10, 6, 5, 3, 2)
  it('segue o formato do desenho', () => {
    expect(commentFileName(when, 'ana', 'k3f9')).toBe('2026-11-06 050302 ana-k3f9')
  })
  it.each([
    ['../../x', '__.._x'],
    [`a/b${cc(92)}c:d*e?f"g<h>i|j`, 'a_b_c_d_e_f_g_h_i_j'],
    ['.oculto', '_oculto'],
    ['', 'user'],
    ['   ', 'user'],
    ['x'.repeat(100), 'x'.repeat(40)],
    ['José da Silva', 'José da Silva'],
  ])('username %j vira %j', (username, expected) => {
    expect(commentFileName(when, username, 'k3f9')).toBe(`2026-11-06 050302 ${expected}-k3f9`)
  })
})

describe('normalizeBody', () => {
  it('normaliza as quebras de linha e tira as pontas', () => {
    expect(normalizeBody(' \r\na\r\nb\rc\n ')).toBe('a\nb\nc')
  })
  it('null para o que não é texto', () => {
    for (const v of [undefined, null, 5, {}, ['a']]) expect(normalizeBody(v)).toBeNull()
  })
})
