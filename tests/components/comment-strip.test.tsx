// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, act, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/components/i18n/I18nProvider', async () => {
  const { getDict, translate } = await import('@/lib/i18n')
  const dict = getDict('pt-BR')
  return {
    useI18n: () => ({
      locale: 'pt-BR',
      t: (k: string, vars?: Record<string, string | number>) => translate(dict, k, vars),
    }),
  }
})

import { CommentStrip } from '@/components/viewer/CommentStrip'
import type { CommentThread, PageComment } from '@/builder/types'
import { commentVersion } from '@/lib/comment-version'

const MOTHER = 'Notas/Minha Nota'
const D = (day: number, hour = 12) =>
  `2026-11-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`

const c = (name: string, createdAt: string | null, extra: Partial<PageComment> = {}): PageComment => ({
  path: `_comments/${MOTHER}/${name}`,
  author: 'ana', createdAt, updatedAt: null, body: `texto ${name}`, html: `<p>texto ${name}</p>`, ...extra,
})
const th = (comment: PageComment, ...replies: PageComment[]): CommentThread => ({ comment, replies })

// n conversas, da mais recente para a mais antiga (a ordem que o build grava).
const convs = (n: number): CommentThread[] =>
  Array.from({ length: n }, (_, i) => th(c(`c${n - i}`, D(n - i))))

const NAMES = { ana: 'Ana Souza', bia: null, root: 'Admin' }

interface Opts {
  threads?: CommentThread[]
  username?: string
  isAdmin?: boolean
  displayNames?: Record<string, string | null>
}
const strip = ({ threads, username = 'ana', isAdmin = false, displayNames = NAMES }: Opts = {}) => (
  <CommentStrip
    slug="my-vault" pagePath={MOTHER} threads={threads}
    displayNames={displayNames} username={username} isAdmin={isAdmin}
  />
)

const threadEls = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>('.vault-comment-thread'))
const commentEl = (el: HTMLElement, name: string) =>
  el.querySelector<HTMLElement>(`[data-comment-path="_comments/${MOTHER}/${name}"]`)!
const order = (el: HTMLElement) =>
  threadEls(el).map(t =>
    Array.from(t.querySelectorAll<HTMLElement>('[data-comment-path]')).map(x =>
      x.dataset.commentPath!.split('/').pop(),
    ),
  )
const actions = (el: HTMLElement, name: string) =>
  Array.from(commentEl(el, name).querySelectorAll<HTMLElement>(':scope > .vault-comment-actions [data-action]')).map(
    b => b.dataset.action,
  )
const action = (el: HTMLElement, name: string, a: string) =>
  commentEl(el, name).querySelector<HTMLButtonElement>(`:scope > .vault-comment-actions [data-action="${a}"]`)!
const textarea = (el: HTMLElement) => el.querySelector<HTMLTextAreaElement>('textarea.vault-comment-input')!
const more = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.vault-comments-more')
const writeBtn = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.vault-comments-write')!
const submitBtn = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('form.vault-comment-form button[type="submit"]')!

type FetchCall = { method: string; body: Record<string, unknown> }
let calls: FetchCall[] = []
function mockApi(reply: (call: FetchCall) => { status: number; body: unknown }) {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const call = { method: init.method as string, body: JSON.parse(init.body as string) }
    calls.push(call)
    const { status, body } = reply(call)
    return { status, type: 'basic', json: async () => body } as unknown as Response
  }))
}

async function type(el: HTMLElement, text: string) {
  fireEvent.change(textarea(el), { target: { value: text } })
}
async function send(el: HTMLElement) {
  await act(async () => { fireEvent.submit(el.querySelector('form.vault-comment-form')!) })
}

beforeEach(() => { calls = [] })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('CommentStrip: conversas', () => {
  it('vazia: "Nenhum comentário ainda" e o botão de escrever', () => {
    const { container } = render(strip())
    expect(container.querySelector('.vault-comments-empty')!.textContent).toBe('Nenhum comentário ainda')
    expect(writeBtn(container).textContent).toBe('Escrever comentário')
    expect(threadEls(container)).toHaveLength(0)
    expect(more(container)).toBeNull()
  })

  it('1 conversa: aparece, sem "Ver todos" e sem a mensagem de vazio', () => {
    const { container } = render(strip({ threads: convs(1) }))
    expect(order(container)).toEqual([['c1']])
    expect(container.querySelector('.vault-comments-empty')).toBeNull()
    expect(more(container)).toBeNull()
  })

  it('3 conversas: todas, sem "Ver todos"', () => {
    const { container } = render(strip({ threads: convs(3) }))
    expect(order(container)).toEqual([['c3'], ['c2'], ['c1']])
    expect(more(container)).toBeNull()
  })

  it('5 conversas: as 3 mais recentes e "Ver todos (5)", que expande o resto', () => {
    const { container } = render(strip({ threads: convs(5) }))
    expect(order(container)).toEqual([['c5'], ['c4'], ['c3']])
    expect(more(container)!.textContent).toBe('Ver todos (5)')
    fireEvent.click(more(container)!)
    expect(order(container)).toEqual([['c5'], ['c4'], ['c3'], ['c2'], ['c1']])
    expect(more(container)).toBeNull()
  })

  it('ordena pela última atividade: resposta ou edição recente sobe a conversa', () => {
    const threads = [
      th(c('velha-editada', D(1), { updatedAt: D(20) })),
      th(c('nova', D(10))),
      th(c('velha-respondida', D(2)), c('r2', D(15)), c('r1', D(3))),
      th(c('antiga', D(4))),
    ]
    const { container } = render(strip({ threads: [threads[3], threads[1], threads[0], threads[2]] }))
    expect(order(container)).toEqual([['velha-editada'], ['velha-respondida', 'r1', 'r2'], ['nova']])
  })

  it('resposta de resposta aparece na conversa do principal, em ordem cronológica', () => {
    // O build já sobe a resposta de resposta até o principal: ela vem em `replies`.
    const threads = [
      th(c('p1', D(5)), c('r1', D(6)), c('resposta-da-r1', D(7))),
      th(c('p2', D(4)), c('r-outra', D(4, 13))),
    ]
    const { container } = render(strip({ threads }))
    expect(order(container)).toEqual([['p1', 'r1', 'resposta-da-r1'], ['p2', 'r-outra']])
    const replies = threadEls(container)[0].querySelector('.vault-comment-replies')!
    expect(replies.querySelectorAll('[data-comment-path]')).toHaveLength(2)
    expect(replies.querySelector('.vault-comment-replies')).toBeNull() // um nível só
  })
})

describe('CommentStrip: cada comentário', () => {
  it('nome de exibição + @username; só @username; autor desconhecido cru', () => {
    const threads = [
      th(c('a', D(3))),
      th(c('b', D(2), { author: 'bia' })),
      th(c('x', D(1), { author: 'Agente Externo' })),
    ]
    const { container } = render(strip({ threads }))
    const meta = (n: string) => commentEl(container, n).querySelector('.vault-comment-meta')!
    expect(meta('a').querySelector('.vault-comment-name')!.textContent).toBe('Ana Souza')
    expect(meta('a').querySelector('.vault-comment-handle')!.textContent).toBe('@ana')
    expect(meta('b').querySelector('.vault-comment-name')).toBeNull()
    expect(meta('b').querySelector('.vault-comment-handle')!.textContent).toBe('@bia')
    expect(meta('x').querySelector('.vault-comment-name')!.textContent).toBe('Agente Externo')
    expect(meta('x').querySelector('.vault-comment-handle')).toBeNull()
  })

  it('autor vazio: "Autor desconhecido"', () => {
    const { container } = render(strip({ threads: [th(c('a', D(1), { author: '' }))] }))
    expect(commentEl(container, 'a').querySelector('.vault-comment-name')!.textContent).toBe('Autor desconhecido')
  })

  it('"(editado)" só com updatedAt', () => {
    const threads = [th(c('editado', D(2), { updatedAt: D(3) })), th(c('intacto', D(1)))]
    const { container } = render(strip({ threads }))
    expect(commentEl(container, 'editado').querySelector('.vault-comment-edited')!.textContent).toBe('(editado)')
    expect(commentEl(container, 'intacto').querySelector('.vault-comment-edited')).toBeNull()
  })

  it('data no horário local do navegador', () => {
    const iso = '2026-11-16T18:30:12.000Z'
    const { container } = render(strip({ threads: [th(c('a', iso))] }))
    const time = commentEl(container, 'a').querySelector('time')!
    expect(time.getAttribute('datetime')).toBe(iso)
    const expected = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))
    expect(time.textContent).toBe(expected)
  })

  it('comentário sem data não mostra data', () => {
    const { container } = render(strip({ threads: [th(c('a', null))] }))
    expect(commentEl(container, 'a').querySelector('time')).toBeNull()
  })

  it('mostra o HTML do render restrito', () => {
    const html = '<p>veja <a href="/vault/my-vault/Notas/Outra">Outra</a> e <a href="https://example.com/">fora</a></p>'
    const { container } = render(strip({ threads: [th(c('a', D(1), { html }))] }))
    const body = commentEl(container, 'a').querySelector('.vault-comment-body')!
    expect(body.innerHTML).toBe(
      '<p>veja <a href="/vault/my-vault/Notas/Outra">Outra</a> e <a href="https://example.com/" target="_blank" rel="noopener noreferrer">fora</a></p>',
    )
  })
})

describe('CommentStrip: botões por papel', () => {
  const threads = [th(c('da-ana', D(2)), c('resp-bia', D(3), { author: 'bia' }), c('resp-ana', D(4)))]

  it('autor: responder (só no principal), editar e apagar nos seus', () => {
    const { container } = render(strip({ threads, username: 'ana' }))
    expect(actions(container, 'da-ana')).toEqual(['reply', 'edit', 'delete'])
    expect(actions(container, 'resp-ana')).toEqual(['edit', 'delete'])
    expect(actions(container, 'resp-bia')).toEqual([])
  })

  it('outro leitor: só responder no principal', () => {
    const { container } = render(strip({ threads, username: 'caio' }))
    expect(actions(container, 'da-ana')).toEqual(['reply'])
    expect(actions(container, 'resp-bia')).toEqual([])
    expect(actions(container, 'resp-ana')).toEqual([])
  })

  it('admin: apaga qualquer um, mas não edita o dos outros', () => {
    const { container } = render(strip({ threads, username: 'root', isAdmin: true }))
    expect(actions(container, 'da-ana')).toEqual(['reply', 'delete'])
    expect(actions(container, 'resp-bia')).toEqual(['delete'])
  })

  it('autoria é o username exato', () => {
    const { container } = render(strip({ threads, username: 'Ana' }))
    expect(actions(container, 'da-ana')).toEqual(['reply'])
  })

  it('com um campo aberto, os outros botões ficam desligados', () => {
    const { container } = render(strip({ threads }))
    fireEvent.click(writeBtn(container))
    expect(writeBtn(container).disabled).toBe(true)
    expect(action(container, 'da-ana', 'reply').disabled).toBe(true)
    expect(action(container, 'resp-ana', 'delete').disabled).toBe(true)
  })
})

describe('CommentStrip: escrever', () => {
  const posted = c('novo', D(20), { body: 'olá **mundo**', html: '<p>olá <strong>mundo</strong></p>' })

  it('o comentário aparece na hora, a partir da resposta da API', async () => {
    mockApi(() => ({ status: 201, body: { comment: posted, replyTo: null } }))
    const { container } = render(strip({ threads: convs(3) }))
    fireEvent.click(writeBtn(container))
    await type(container, '  olá **mundo**  ')
    await send(container)

    expect(calls).toEqual([{ method: 'POST', body: { parent: MOTHER, body: 'olá **mundo**' } }])
    expect(order(container)[0]).toEqual(['novo'])
    expect(commentEl(container, 'novo').querySelector('.vault-comment-body')!.innerHTML).toBe(posted.html)
    expect(textarea(container)).toBeNull()
    // são 4 agora: as 3 mais recentes e o "Ver todos"
    expect(more(container)!.textContent).toBe('Ver todos (4)')
  })

  it('não duplica quando chega o PageMeta novo com o mesmo comentário', async () => {
    mockApi(() => ({ status: 201, body: { comment: posted, replyTo: null } }))
    const before = convs(2)
    const { container, rerender } = render(strip({ threads: before }))
    fireEvent.click(writeBtn(container))
    await type(container, 'olá **mundo**')
    await send(container)
    expect(order(container)).toEqual([['novo'], ['c2'], ['c1']])
    const bodyNode = commentEl(container, 'novo').querySelector('.vault-comment-body')

    // O rebuild silencioso terminou: o refresh traz o comentário no PageMeta.
    await act(async () => { rerender(strip({ threads: [th(posted), ...before] })) })
    expect(order(container)).toEqual([['novo'], ['c2'], ['c1']])
    expect(container.querySelectorAll(`[data-comment-path="${posted.path}"]`)).toHaveLength(1)
    // sem piscar: o nó do corpo é o mesmo, não foi recriado
    expect(commentEl(container, 'novo').querySelector('.vault-comment-body')).toBe(bodyNode)
  })

  it('um refresh que ainda não traz o comentário não o faz sumir', async () => {
    mockApi(() => ({ status: 201, body: { comment: posted, replyTo: null } }))
    const { container, rerender } = render(strip({ threads: convs(2) }))
    fireEvent.click(writeBtn(container))
    await type(container, 'x')
    await send(container)
    await act(async () => { rerender(strip({ threads: convs(2) })) })
    expect(order(container)).toEqual([['novo'], ['c2'], ['c1']])
  })

  it('depois que o servidor mostrou o comentário, ele some se outra pessoa apagar', async () => {
    mockApi(() => ({ status: 201, body: { comment: posted, replyTo: null } }))
    const before = convs(1)
    const { container, rerender } = render(strip({ threads: before }))
    fireEvent.click(writeBtn(container))
    await type(container, 'x')
    await send(container)
    await act(async () => { rerender(strip({ threads: [th(posted), ...before] })) })
    await act(async () => { rerender(strip({ threads: before })) })
    expect(order(container)).toEqual([['c1']])
  })

  it('resposta da API que chega depois do refresh que já traz o comentário não o ressuscita', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    vi.stubGlobal('fetch', vi.fn(async () => {
      await gate
      return { status: 201, type: 'basic', json: async () => ({ comment: posted, replyTo: null }) } as unknown as Response
    }))
    const before = convs(1)
    const { container, rerender } = render(strip({ threads: before }))
    fireEvent.click(writeBtn(container))
    await type(container, 'x')
    await send(container)
    // o refresh chega antes da resposta do POST
    await act(async () => { rerender(strip({ threads: [th(posted), ...before] })) })
    await act(async () => { release(); await gate; await Promise.resolve() })
    await waitFor(() => expect(textarea(container)).toBeNull())
    expect(order(container)).toEqual([['novo'], ['c1']])
    // outra pessoa apaga: ele some, não volta do estado local
    await act(async () => { rerender(strip({ threads: before })) })
    expect(order(container)).toEqual([['c1']])
  })

  it('responder: manda o principal como parent e a resposta entra embaixo dele', async () => {
    const threads = [th(c('p2', D(5))), th(c('p1', D(1)), c('r1', D(2)))]
    const reply = c('r2', D(21), { html: '<p>resposta</p>' })
    mockApi(() => ({ status: 201, body: { comment: reply, replyTo: threads[1].comment.path } }))
    const { container } = render(strip({ threads }))
    fireEvent.click(action(container, 'p1', 'reply'))
    // o campo abre dentro da conversa certa
    expect(threadEls(container)[1].querySelector('textarea')).not.toBeNull()
    await type(container, 'resposta')
    await send(container)

    expect(calls[0]).toEqual({ method: 'POST', body: { parent: threads[1].comment.path, body: 'resposta' } })
    // a conversa respondida sobe (última atividade)
    expect(order(container)).toEqual([['p1', 'r1', 'r2'], ['p2']])
  })

  it('não há "Responder" numa resposta', () => {
    const { container } = render(strip({ threads: [th(c('p', D(1)), c('r', D(2)))] }))
    expect(actions(container, 'r')).not.toContain('reply')
  })

  it('vazio ou só espaços não envia', async () => {
    mockApi(() => ({ status: 201, body: {} }))
    const { container } = render(strip())
    fireEvent.click(writeBtn(container))
    expect(submitBtn(container).disabled).toBe(true)
    await type(container, '  \n ')
    expect(submitBtn(container).disabled).toBe(true)
    await send(container)
    expect(calls).toEqual([])
  })

  it('acima de 10.000 caracteres: avisa e não envia', async () => {
    mockApi(() => ({ status: 201, body: {} }))
    const { container } = render(strip())
    fireEvent.click(writeBtn(container))
    await type(container, 'a'.repeat(10_001))
    expect(submitBtn(container).disabled).toBe(true)
    expect(container.querySelector('.vault-comment-error')!.textContent).toContain('10001')
    await send(container)
    expect(calls).toEqual([])
    await type(container, 'a'.repeat(10_000))
    expect(submitBtn(container).disabled).toBe(false)
  })

  it('erro da API: mensagem curta traduzida, e o texto digitado fica', async () => {
    mockApi(() => ({ status: 403, body: { error: 'Sem acesso' } }))
    const { container } = render(strip())
    fireEvent.click(writeBtn(container))
    await type(container, 'meu texto')
    await send(container)
    expect(container.querySelector('.vault-comment-error')!.textContent).toBe('Você não tem permissão para isso.')
    expect(textarea(container).value).toBe('meu texto')
    expect(threadEls(container)).toHaveLength(0)
  })

  it('Cancelar fecha o campo sem enviar', () => {
    const { container } = render(strip())
    fireEvent.click(writeBtn(container))
    fireEvent.click(Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Cancelar')!)
    expect(textarea(container)).toBeNull()
    expect(writeBtn(container).disabled).toBe(false)
  })

  it('Ctrl+Enter envia', async () => {
    mockApi(() => ({ status: 201, body: { comment: posted, replyTo: null } }))
    const { container } = render(strip())
    fireEvent.click(writeBtn(container))
    await type(container, 'x')
    await act(async () => { fireEvent.keyDown(textarea(container), { key: 'Enter', ctrlKey: true }) })
    expect(calls).toHaveLength(1)
    expect(order(container)).toEqual([['novo']])
  })

  it('o texto digitado não se perde num refresh (PageMeta novo no meio da digitação)', async () => {
    const { container, rerender } = render(strip({ threads: convs(2) }))
    fireEvent.click(action(container, 'c1', 'reply'))
    await type(container, 'rascunho em andamento')
    const node = textarea(container)
    await act(async () => { rerender(strip({ threads: [th(c('de-outro', D(25), { author: 'bia' })), ...convs(2)] })) })
    expect(textarea(container)).toBe(node)
    expect(textarea(container).value).toBe('rascunho em andamento')
  })

  it('a conversa em que o usuário escreve não some atrás do "Ver todos" quando a ordem muda', async () => {
    const { container, rerender } = render(strip({ threads: convs(3) }))
    fireEvent.click(action(container, 'c1', 'reply'))
    await type(container, 'rascunho')
    const newer = [6, 5, 4].map(n => th(c(`c${n}`, D(n))))
    await act(async () => { rerender(strip({ threads: [...newer, ...convs(3)] })) })
    expect(order(container)).toEqual([['c6'], ['c5'], ['c4'], ['c1']])
    expect(textarea(container).value).toBe('rascunho')
  })
})

describe('CommentStrip: editar', () => {
  const original = c('meu', D(2), { body: 'antes', html: '<p>antes</p>' })
  const edited = { ...original, body: 'depois', html: '<p>depois</p>', updatedAt: D(22) }

  it('abre com o markdown cru, manda a versão e mostra o resultado na hora', async () => {
    mockApi(() => ({ status: 200, body: { comment: edited } }))
    const { container } = render(strip({ threads: [th(original)] }))
    fireEvent.click(action(container, 'meu', 'edit'))
    expect(textarea(container).value).toBe('antes')
    await type(container, 'depois')
    await send(container)

    expect(calls).toEqual([{
      method: 'PATCH', body: { path: original.path, body: 'depois', version: commentVersion(original) },
    }])
    expect(commentEl(container, 'meu').querySelector('.vault-comment-body')!.innerHTML).toBe('<p>depois</p>')
    expect(commentEl(container, 'meu').querySelector('.vault-comment-edited')).not.toBeNull()
  })

  it('a edição continua lá num refresh que ainda traz o texto antigo, e o oficial entra sem duplicar', async () => {
    mockApi(() => ({ status: 200, body: { comment: edited } }))
    const { container, rerender } = render(strip({ threads: [th(original)] }))
    fireEvent.click(action(container, 'meu', 'edit'))
    await type(container, 'depois')
    await send(container)
    await act(async () => { rerender(strip({ threads: [th({ ...original })] })) })
    expect(commentEl(container, 'meu').querySelector('.vault-comment-body')!.innerHTML).toBe('<p>depois</p>')
    await act(async () => { rerender(strip({ threads: [th({ ...edited })] })) })
    expect(container.querySelectorAll('[data-comment-path]')).toHaveLength(1)
    expect(commentEl(container, 'meu').querySelector('.vault-comment-body')!.innerHTML).toBe('<p>depois</p>')
  })

  it('409: avisa, mostra o comentário do disco, mantém o texto e reenvia com a versão nova', async () => {
    const onDisk = { ...original, body: 'mudou por fora', html: '<p>mudou por fora</p>' }
    let n = 0
    mockApi(() =>
      n++ === 0
        ? { status: 409, body: { error: 'x', comment: onDisk } }
        : { status: 200, body: { comment: edited } },
    )
    const { container } = render(strip({ threads: [th(original)] }))
    fireEvent.click(action(container, 'meu', 'edit'))
    await type(container, 'depois')
    await send(container)

    expect(container.querySelector('.vault-comment-error')!.textContent).toContain('mudou enquanto você editava')
    expect(textarea(container).value).toBe('depois')

    await send(container)
    expect(calls[1].body.version).toBe(commentVersion(onDisk))
    expect(textarea(container)).toBeNull()
    expect(commentEl(container, 'meu').querySelector('.vault-comment-body')!.innerHTML).toBe('<p>depois</p>')
  })
})

describe('CommentStrip: apagar', () => {
  const confirmText = (el: HTMLElement) => el.querySelector('.vault-comment-confirm-text')?.textContent
  const confirmBtn = (el: HTMLElement) =>
    el.querySelector<HTMLButtonElement>('.vault-comment-confirm .vault-comment-btn.is-danger')!

  beforeEach(() => {
    vi.stubGlobal('confirm', vi.fn(() => { throw new Error('confirm() do navegador não pode ser usado') }))
  })

  it('confirmação dentro da faixa, avisando quantas respostas vão junto', () => {
    const threads = [
      th(c('com-duas', D(5)), c('r1', D(6)), c('r2', D(7))),
      th(c('com-uma', D(3)), c('r3', D(4))),
      th(c('sozinho', D(1))),
    ]
    const { container } = render(strip({ threads }))

    fireEvent.click(action(container, 'com-duas', 'delete'))
    expect(confirmText(container)).toBe('Apagar este comentário e as 2 respostas dele? Não dá para desfazer.')
    expect(commentEl(container, 'com-duas').querySelector('.vault-comment-confirm')).not.toBeNull()
    fireEvent.click(Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Cancelar')!)
    expect(confirmText(container)).toBeUndefined()

    fireEvent.click(action(container, 'com-uma', 'delete'))
    expect(confirmText(container)).toBe('Apagar este comentário e a resposta dele? Não dá para desfazer.')
    fireEvent.click(Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Cancelar')!)

    fireEvent.click(action(container, 'sozinho', 'delete'))
    expect(confirmText(container)).toBe('Apagar este comentário? Não dá para desfazer.')
    fireEvent.click(Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Cancelar')!)

    // apagar uma resposta não fala de respostas
    fireEvent.click(action(container, 'r1', 'delete'))
    expect(confirmText(container)).toBe('Apagar este comentário? Não dá para desfazer.')
    expect(window.confirm).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })

  it('a contagem inclui uma resposta que acabou de ser enviada', async () => {
    const threads = [th(c('p', D(1)), c('r1', D(2)))]
    mockApi(() => ({ status: 201, body: { comment: c('r2', D(20)), replyTo: threads[0].comment.path } }))
    const { container } = render(strip({ threads }))
    fireEvent.click(action(container, 'p', 'reply'))
    await type(container, 'x')
    await send(container)
    fireEvent.click(action(container, 'p', 'delete'))
    expect(confirmText(container)).toContain('as 2 respostas')
  })

  it('apagar o principal tira a conversa inteira da faixa, e ela não volta num refresh atrasado', async () => {
    const threads = [th(c('p', D(5)), c('r1', D(6))), th(c('outro', D(1)))]
    mockApi(() => ({ status: 200, body: { deleted: 2 } }))
    const { container, rerender } = render(strip({ threads }))
    fireEvent.click(action(container, 'p', 'delete'))
    await act(async () => { fireEvent.click(confirmBtn(container)) })

    expect(calls).toEqual([{ method: 'DELETE', body: { path: threads[0].comment.path } }])
    expect(order(container)).toEqual([['outro']])
    await act(async () => { rerender(strip({ threads: [...threads] })) })
    expect(order(container)).toEqual([['outro']])
    await act(async () => { rerender(strip({ threads: [threads[1]] })) })
    expect(order(container)).toEqual([['outro']])
  })

  it('404 ao apagar: o comentário já não existe, então sai da faixa', async () => {
    mockApi(() => ({ status: 404, body: { error: 'x' } }))
    const { container } = render(strip({ threads: [th(c('p', D(5)))] }))
    fireEvent.click(action(container, 'p', 'delete'))
    await act(async () => { fireEvent.click(confirmBtn(container)) })
    expect(order(container)).toEqual([])
  })

  it('a confirmação recebe o foco no "Cancelar" e fecha com Esc', () => {
    const { container } = render(strip({ threads: [th(c('p', D(5)))] }))
    fireEvent.click(action(container, 'p', 'delete'))
    const box = container.querySelector<HTMLElement>('.vault-comment-confirm')!
    expect(document.activeElement!.textContent).toBe('Cancelar')
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(container.querySelector('.vault-comment-confirm')).toBeNull()
  })

  it('apagar uma resposta tira só ela', async () => {
    const threads = [th(c('p', D(5)), c('r1', D(6)), c('r2', D(7)))]
    mockApi(() => ({ status: 200, body: { deleted: 1 } }))
    const { container } = render(strip({ threads }))
    fireEvent.click(action(container, 'r1', 'delete'))
    await act(async () => { fireEvent.click(confirmBtn(container)) })
    expect(order(container)).toEqual([['p', 'r2']])
  })

  it('erro ao apagar: a mensagem aparece na confirmação e nada some', async () => {
    const threads = [th(c('p', D(5)))]
    mockApi(() => ({ status: 500, body: { error: 'x' } }))
    const { container } = render(strip({ threads }))
    fireEvent.click(action(container, 'p', 'delete'))
    await act(async () => { fireEvent.click(confirmBtn(container)) })
    await waitFor(() =>
      expect(container.querySelector('.vault-comment-confirm .vault-comment-error')!.textContent).toBe(
        'Não deu certo. Tente de novo.',
      ),
    )
    expect(order(container)).toEqual([['p']])
  })
})
