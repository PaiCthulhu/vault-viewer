import { describe, it, expect } from 'vitest'
import { resolveFamilies, type FamilyNote } from '../../builder/note-family'
import { groupComments, commentTime, toPageComment, sortThreads } from '../../builder/comments'
import type { CommentThread, PageComment } from '../../builder/types'

const nota = (path: string, frontmatter: Record<string, unknown> = {}): FamilyNote => ({
  path,
  title: path.split('/').pop()!,
  frontmatter,
})
const comentario = (path: string, parent: unknown): FamilyNote =>
  nota(path, { note_type: 'comment', parent })

describe('groupComments', () => {
  it('principal → nota; resposta → principal; resposta de resposta sobe ao principal', () => {
    const f = resolveFamilies([
      nota('Notas/M'),
      comentario('c/P', '[[Notas/M]]'),
      comentario('c/R1', '[[c/P]]'),
      comentario('c/R2', '[[c/R1]]'),
    ])
    const g = groupComments(f)
    expect([...g.keys()]).toEqual(['Notas/M'])
    const threads = g.get('Notas/M')!
    expect(threads).toHaveLength(1)
    expect(threads[0].principal).toBe('c/P')
    expect([...threads[0].replies].sort()).toEqual(['c/R1', 'c/R2'])
  })

  it('principal sem respostas também gera conversa', () => {
    const f = resolveFamilies([nota('Notas/M'), comentario('c/P', '[[Notas/M]]')])
    expect(groupComments(f)).toEqual(new Map([['Notas/M', [{ principal: 'c/P', replies: [] }]]]))
  })

  it('parent casa sem diferenciar caixa', () => {
    const f = resolveFamilies([nota('Notas/M'), comentario('c/P', '[[notas/m]]')])
    expect(groupComments(f).get('Notas/M')).toEqual([{ principal: 'c/P', replies: [] }])
  })

  it('órfãos: mãe inexistente, ciclo, resposta a órfão, mãe que é aba', () => {
    const f = resolveFamilies([
      nota('Notas/M'),
      nota('Abas/Aba', { note_type: 'tab', parent: '[[Notas/M]]' }),
      comentario('c/semMae', '[[Não Existe]]'),
      comentario('c/A', '[[c/B]]'),
      comentario('c/B', '[[c/A]]'),
      comentario('c/aOrfao', '[[c/semMae]]'),
      comentario('c/naAba', '[[Abas/Aba]]'),
      comentario('c/lista', ['Notas/M']),
    ])
    expect(groupComments(f).size).toBe(0)
  })
})

describe('groupComments — pasta _comments/', () => {
  it('comentário válido dentro da pasta continua anexado à mãe', () => {
    const f = resolveFamilies([nota('Notas/M'), comentario('_comments/Notas/M/c1', '[[Notas/M]]')])
    expect(groupComments(f)).toEqual(new Map([['Notas/M', [{ principal: '_comments/Notas/M/c1', replies: [] }]]]))
  })

  it('ignorado da pasta não vira conversa nem elo: quem responde a ele é órfão', () => {
    const f = resolveFamilies([
      nota('Notas/M'),
      // Ignorado: sem note_type, mas com parent para a nota comum.
      nota('_comments/Notas/M/quebrado', { parent: '[[Notas/M]]' }),
      comentario('_comments/Notas/M/resposta', '[[_comments/Notas/M/quebrado]]'),
      comentario('Fora/resposta', '[[_comments/Notas/M/quebrado]]'),
    ])
    expect(f.noPage.has('_comments/Notas/M/quebrado')).toBe(true)
    expect(f.comments.has('_comments/Notas/M/quebrado')).toBe(false)
    expect(groupComments(f).size).toBe(0)
  })

  it('o órfão por causa do ignorado não derruba as outras conversas da mãe', () => {
    const f = resolveFamilies([
      nota('Notas/M'),
      nota('_comments/Notas/M/quebrado', { parent: '[[Notas/M]]' }),
      comentario('_comments/Notas/M/resposta', '[[_comments/Notas/M/quebrado]]'),
      comentario('_comments/Notas/M/ok', '[[Notas/M]]'),
    ])
    expect(groupComments(f)).toEqual(new Map([['Notas/M', [{ principal: '_comments/Notas/M/ok', replies: [] }]]]))
  })
})

describe('commentTime', () => {
  it('Date e ISO viram UTC; o resto vira null', () => {
    expect(commentTime(new Date('2026-11-16T18:30:12Z'))).toBe('2026-11-16T18:30:12.000Z')
    expect(commentTime('2026-11-16T15:30:12-03:00')).toBe('2026-11-16T18:30:12.000Z')
    expect(commentTime(undefined)).toBeNull()
    expect(commentTime('ontem')).toBeNull()
    expect(commentTime(42)).toBeNull()
    expect(commentTime(new Date('x'))).toBeNull()
  })
})

describe('toPageComment', () => {
  const opts = { vaultSlug: 'v', resolveLink: () => undefined }

  it('lê autor, datas e render do frontmatter', () => {
    const c = toPageComment(
      {
        path: 'c/P',
        frontmatter: { author: 'ana', created_at: new Date('2026-11-16T18:30:12Z') },
        body: 'oi **x**',
      },
      opts,
    )
    expect(c).toEqual({
      path: 'c/P',
      author: 'ana',
      createdAt: '2026-11-16T18:30:12.000Z',
      updatedAt: null,
      body: 'oi **x**',
      html: '<p>oi <strong>x</strong></p>',
    })
    expect(toPageComment({ path: 'c/Q', frontmatter: {}, body: 'x' }, opts).author).toBe('')
  })

  it('autor numérico vira texto e updated_at vira ISO', () => {
    const c = toPageComment(
      { path: 'c/N', frontmatter: { author: 42, updated_at: '2026-11-17T09:00:00Z' }, body: 'x' },
      opts,
    )
    expect(c.author).toBe('42')
    expect(c.updatedAt).toBe('2026-11-17T09:00:00.000Z')
  })
})

describe('sortThreads', () => {
  const c = (path: string, createdAt: string | null, updatedAt: string | null = null): PageComment => ({
    path, author: '', createdAt, updatedAt, body: '', html: '',
  })

  it('sortThreads: última atividade desc, respostas cronológicas', () => {
    const t1: CommentThread = { comment: c('c/1', '2026-11-16T10:00:00.000Z'), replies: [] }
    // Resposta mais recente que tudo; respostas fora de ordem na entrada.
    const t2: CommentThread = {
      comment: c('c/2', '2026-11-16T09:00:00.000Z'),
      replies: [c('c/2b', '2026-11-16T20:00:00.000Z'), c('c/2a', '2026-11-16T09:30:00.000Z')],
    }
    // Editado depois: updatedAt recente.
    const t3: CommentThread = { comment: c('c/3', '2026-11-16T08:00:00.000Z', '2026-11-16T15:00:00.000Z'), replies: [] }
    const t4: CommentThread = { comment: c('c/4', null), replies: [] }
    const entrada = [t4, t1, t3, t2]
    const out = sortThreads(entrada)
    expect(out.map(t => t.comment.path)).toEqual(['c/2', 'c/3', 'c/1', 'c/4'])
    expect(out[0].replies.map(r => r.path)).toEqual(['c/2a', 'c/2b'])
    // Não muta a entrada.
    expect(entrada.map(t => t.comment.path)).toEqual(['c/4', 'c/1', 'c/3', 'c/2'])
    expect(t2.replies.map(r => r.path)).toEqual(['c/2b', 'c/2a'])
  })

  it('desempates: respostas por createdAt (null no fim) e path; conversas por path do principal', () => {
    const mesmo = '2026-11-16T10:00:00.000Z'
    const t: CommentThread = {
      comment: c('c/p', mesmo),
      replies: [c('c/r-sem', null), c('c/r-b', mesmo), c('c/r-a', mesmo)],
    }
    expect(sortThreads([t])[0].replies.map(r => r.path)).toEqual(['c/r-a', 'c/r-b', 'c/r-sem'])
    const x: CommentThread = { comment: c('c/x', mesmo), replies: [] }
    const y: CommentThread = { comment: c('c/y', mesmo), replies: [] }
    expect(sortThreads([y, x]).map(r => r.comment.path)).toEqual(['c/x', 'c/y'])
  })
})
