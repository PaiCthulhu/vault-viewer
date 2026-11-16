import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PageMeta, PageComment } from '@/builder/types'

const dbGetDisplayNames = vi.fn()
vi.mock('@/lib/db', () => ({ dbGetDisplayNames: (...a: unknown[]) => dbGetDisplayNames(...a) }))

import { commentUsernames, pageDisplayNames } from '@/lib/comment-authors'

function c(author: string): PageComment {
  return { path: `c-${author}`, author, createdAt: null, updatedAt: null, body: 'x', html: '<p>x</p>' }
}

function page(extra: Partial<PageMeta> = {}): PageMeta {
  return {
    path: 'Notas/Minha Nota',
    title: 'Minha Nota',
    html: '',
    ...extra,
  } as PageMeta
}

beforeEach(() => {
  dbGetDisplayNames.mockReset()
  dbGetDisplayNames.mockReturnValue({ ana: 'Ana Souza' })
})

describe('commentUsernames', () => {
  it('junta autores de principais e respostas mais o viewer, sem vazios e sem repetição', () => {
    const p = page({
      commentable: true,
      comments: [
        { comment: c('ana'), replies: [c('bob'), c(''), c('ana')] },
        { comment: c(''), replies: [] },
        { comment: c('bob'), replies: [] },
      ],
    })
    const r = commentUsernames(p, 'bia')
    expect([...r].sort()).toEqual(['ana', 'bia', 'bob'])
    expect(new Set(r).size).toBe(r.length)
  })

  it('sem comentários devolve só o viewer; viewer vazio é ignorado', () => {
    expect(commentUsernames(page({ commentable: true }), 'bia')).toEqual(['bia'])
    expect(commentUsernames(page({ commentable: true }), '')).toEqual([])
  })
})

describe('pageDisplayNames', () => {
  it('devolve {} sem consultar o banco quando a página não é comentável', () => {
    const p = page({ comments: [{ comment: c('ana'), replies: [] }] })
    expect(pageDisplayNames(p, 'bia')).toEqual({})
    expect(dbGetDisplayNames).not.toHaveBeenCalled()
  })

  it('devolve o resultado do banco quando a página é comentável', () => {
    const p = page({ commentable: true, comments: [{ comment: c('ana'), replies: [] }] })
    expect(pageDisplayNames(p, 'bia')).toEqual({ ana: 'Ana Souza' })
    expect(dbGetDisplayNames).toHaveBeenCalledTimes(1)
    expect([...(dbGetDisplayNames.mock.calls[0][0] as string[])].sort()).toEqual(['ana', 'bia'])
  })
})
