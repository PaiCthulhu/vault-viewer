import { describe, it, expect } from 'vitest'
import type { CommentThread, PageComment } from '../../builder/types'
import { sortThreads as builderSort } from '../../builder/comments'
import { commentVersion } from '../../lib/comment-version'
import {
  NO_LOCAL, authorLabel, findComment, localAdd, localDelete, localEdit, mergeThreads, pruneLocal, sortThreads,
} from '../../lib/comment-threads'

const c = (path: string, createdAt: string | null, extra: Partial<PageComment> = {}): PageComment => ({
  path, author: 'ana', createdAt, updatedAt: null, body: path, html: `<p>${path}</p>`, ...extra,
})
const t = (comment: PageComment, ...replies: PageComment[]): CommentThread => ({ comment, replies })
const paths = (threads: CommentThread[]) => threads.map(x => [x.comment.path, ...x.replies.map(r => r.path)])

const D = (n: number) => `2026-11-${String(n).padStart(2, '0')}T12:00:00.000Z`

describe('sortThreads (cliente)', () => {
  it('dá a mesma ordem que o build', () => {
    const threads = [
      t(c('_comments/N/a', D(1)), c('_comments/N/a2', D(9)), c('_comments/N/a1', D(3))),
      t(c('_comments/N/b', D(5))),
      t(c('_comments/N/sem-data', null)),
      t(c('_comments/N/d', D(2), { updatedAt: D(10) })),
      t(c('_comments/N/e', D(5))),
      t(c('_comments/N/f', D(1)), c('_comments/N/f1', null), c('_comments/N/f0', D(2))),
    ]
    expect(sortThreads(threads)).toEqual(builderSort(threads))
    expect(paths(sortThreads(threads))[0]).toEqual(['_comments/N/d'])
  })

  it('não muta a entrada', () => {
    const threads = [t(c('a', D(1)), c('a2', D(3)), c('a1', D(2))), t(c('b', D(5)))]
    const before = JSON.stringify(threads)
    sortThreads(threads)
    expect(JSON.stringify(threads)).toBe(before)
  })
})

describe('mergeThreads', () => {
  const server = [t(c('b', D(5))), t(c('a', D(1)), c('a1', D(2)))]

  it('sem nada local, devolve o servidor', () => {
    expect(mergeThreads(server, NO_LOCAL)).toEqual(server)
  })

  it('principal novo vai para o topo', () => {
    const local = localAdd(NO_LOCAL, c('novo', D(9)), null)
    expect(paths(mergeThreads(server, local))).toEqual([['novo'], ['b'], ['a', 'a1']])
  })

  it('resposta nova entra embaixo do principal, em ordem cronológica, e sobe a conversa', () => {
    const local = localAdd(NO_LOCAL, c('a2', D(9)), 'a')
    expect(paths(mergeThreads(server, local))).toEqual([['a', 'a1', 'a2'], ['b']])
  })

  it('resposta a um principal que também é local', () => {
    const local = localAdd(localAdd(NO_LOCAL, c('novo1', D(10)), 'novo'), c('novo', D(9)), null)
    expect(paths(mergeThreads(server, local))[0]).toEqual(['novo', 'novo1'])
  })

  it('o que o servidor já tem não duplica, e vale a cópia do servidor', () => {
    const local = localAdd(NO_LOCAL, c('b', D(5), { html: '<p>local</p>' }), null)
    const merged = mergeThreads(server, local)
    expect(paths(merged)).toEqual([['b'], ['a', 'a1']])
    expect(merged[0].comment.html).toBe('<p>b</p>')
  })

  it('resposta local cujo principal sumiu não aparece', () => {
    const local = localAdd(NO_LOCAL, c('x1', D(9)), 'sumiu')
    expect(paths(mergeThreads(server, local))).toEqual([['b'], ['a', 'a1']])
  })

  it('edição local cobre o servidor enquanto ele não mudou', () => {
    const edited = c('a1', D(2), { updatedAt: D(8), body: 'novo', html: '<p>novo</p>' })
    const local = localEdit(NO_LOCAL, edited, server)
    const merged = mergeThreads(server, local)
    expect(findComment(merged, 'a1')).toEqual(edited)
    // a edição conta como atividade: a conversa sobe
    expect(paths(merged)[0][0]).toBe('a')
  })

  it('o servidor que alcançou a edição manda', () => {
    const edited = c('a1', D(2), { updatedAt: D(8), body: 'novo' })
    const local = localEdit(NO_LOCAL, edited, server)
    const official = c('a1', D(2), { updatedAt: D(8), body: 'novo', html: '<p>oficial</p>' })
    const merged = mergeThreads([t(c('a', D(1)), official)], local)
    expect(findComment(merged, 'a1')!.html).toBe('<p>oficial</p>')
  })

  it('duas edições seguidas: o build da primeira não desfaz a segunda', () => {
    const e1 = c('a1', D(2), { updatedAt: D(8), body: 'um' })
    const e2 = c('a1', D(2), { updatedAt: D(9), body: 'dois' })
    const local = localEdit(localEdit(NO_LOCAL, e1, server), e2, server)
    const merged = mergeThreads([t(c('a', D(1)), e1)], local)
    expect(findComment(merged, 'a1')!.body).toBe('dois')
  })

  it('cópia do disco devolvida num 409 (sem updatedAt mais novo) vale enquanto o servidor não muda', () => {
    const disk = c('a1', D(2), { body: 'mudou no Obsidian' })
    const local = localEdit(NO_LOCAL, disk, server)
    expect(local.edited.a1.base).toBe(commentVersion(server[1].replies[0]))
    expect(findComment(mergeThreads(server, local), 'a1')!.body).toBe('mudou no Obsidian')
    // o servidor mudou (para qualquer coisa): ele manda
    const next = [t(c('a', D(1)), c('a1', D(2), { body: 'outra' }))]
    expect(findComment(mergeThreads(next, local), 'a1')!.body).toBe('outra')
  })

  it('edição de um comentário que o servidor ainda não tem', () => {
    const added = localAdd(NO_LOCAL, c('novo', D(9)), null)
    const local = localEdit(added, c('novo', D(9), { updatedAt: D(10), body: 'editado' }), server)
    expect(local.edited.novo.base).toBeNull()
    expect(findComment(mergeThreads(server, local), 'novo')!.body).toBe('editado')
  })

  it('apagar um principal esconde a conversa inteira', () => {
    const local = localDelete(NO_LOCAL, 'a')
    expect(paths(mergeThreads(server, local))).toEqual([['b']])
  })

  it('apagar uma resposta esconde só ela', () => {
    const local = localDelete(NO_LOCAL, 'a1')
    expect(paths(mergeThreads(server, local))).toEqual([['b'], ['a']])
  })

  it('criar e apagar antes do build: não volta quando o build do meio o traz', () => {
    const local = localDelete(localAdd(NO_LOCAL, c('novo', D(9)), null), 'novo')
    expect(local.added).toEqual([])
    const withIt = [t(c('novo', D(9))), ...server]
    expect(paths(mergeThreads(withIt, local))).toEqual([['b'], ['a', 'a1']])
  })

  it('apagar um principal local leva as respostas locais', () => {
    let local = localAdd(NO_LOCAL, c('novo', D(9)), null)
    local = localAdd(local, c('novo1', D(10)), 'novo')
    local = localDelete(local, 'novo')
    expect(local.added).toEqual([])
  })
})

describe('pruneLocal', () => {
  const server = [t(c('a', D(1)))]

  it('nada a podar: devolve o mesmo objeto', () => {
    const local = localAdd(NO_LOCAL, c('novo', D(9)), null)
    expect(pruneLocal(server, local)).toBe(local)
    expect(pruneLocal(server, NO_LOCAL)).toBe(NO_LOCAL)
  })

  it('criado que o servidor já mostrou sai; se outra pessoa apagar depois, não volta', () => {
    const local = localAdd(NO_LOCAL, c('novo', D(9)), null)
    const pruned = pruneLocal([t(c('novo', D(9))), ...server], local)
    expect(pruned.added).toEqual([])
    expect(paths(mergeThreads(server, pruned))).toEqual([['a']])
  })

  it('edição alcançada pelo servidor sai; a que ainda cobre fica', () => {
    const edited = c('a', D(1), { updatedAt: D(8), body: 'novo' })
    const local = localEdit(NO_LOCAL, edited, server)
    expect(pruneLocal(server, local)).toBe(local)
    expect(pruneLocal([t(edited)], local).edited).toEqual({})
  })

  it('não mexe nos apagados', () => {
    const local = localDelete(localAdd(NO_LOCAL, c('novo', D(9)), null), 'a')
    const pruned = pruneLocal([t(c('novo', D(9)))], local)
    expect(pruned.deleted).toEqual(['a'])
  })
})

describe('authorLabel', () => {
  const names = { ana: 'Ana Souza', bia: null }

  it('nome de exibição + @username', () => {
    expect(authorLabel('ana', names)).toEqual({ name: 'Ana Souza', handle: '@ana' })
  })

  it('usuário sem nome: só @username', () => {
    expect(authorLabel('bia', names)).toEqual({ name: '', handle: '@bia' })
  })

  it('autor desconhecido: o valor cru', () => {
    expect(authorLabel('Agente X', names)).toEqual({ name: 'Agente X', handle: '' })
    expect(authorLabel('', names)).toEqual({ name: '', handle: '' })
  })

  it('não confunde com propriedades herdadas do objeto', () => {
    expect(authorLabel('constructor', names)).toEqual({ name: 'constructor', handle: '' })
  })
})
