// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'

const router = { push: vi.fn(), refresh: vi.fn() }
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'dark' }) }))
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
const mermaidRender = vi.fn<(id: string, source: string) => Promise<{ svg: string }>>(async () => ({ svg: '<svg data-test="diagrama"></svg>' }))
vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: mermaidRender } }))

import { ContentPanel, type ContentPanelComments } from '@/components/viewer/ContentPanel'
import { parseHtmlSegments, COMMENTS_SLOT } from '@/lib/parse-html-segments'
import type { CommentThread, PageComment } from '@/builder/types'

const PAGE = 'Notas/Minha Nota'
const PROPS = '<details class="vault-properties"><summary>Propriedades</summary><dl></dl></details>'
const BODY =
  '<h1>Minha Nota</h1><details class="vault-callout"><summary>Dobrável</summary><p>dentro</p></details>' +
  '<p><a href="/vault/my-vault/Notas/Outra">link da nota</a></p>'
const pageHtml = (body = BODY) => `<article class="vault-content">${PROPS}${COMMENTS_SLOT}${body}</article>`

const comment = (name: string, extra: Partial<PageComment> = {}): PageComment => ({
  path: `_comments/${PAGE}/${name}`,
  author: 'ana', createdAt: '2026-11-10T12:00:00.000Z', updatedAt: null,
  body: name, html: `<p>${name}</p>`, ...extra,
})
const th = (c: PageComment, ...replies: PageComment[]): CommentThread => ({ comment: c, replies })

const on = (threads?: CommentThread[]): ContentPanelComments => ({
  threads, displayNames: { ana: 'Ana Souza' }, username: 'ana', isAdmin: false,
})

// Cada chamada parte de um parse novo, como um router.refresh() entrega.
const panel = (html: string, comments: ContentPanelComments | undefined, pagePath = PAGE, parse = true) => (
  <ContentPanel
    segments={parseHtmlSegments(html, { comments: parse })}
    css="" articleClass="vault-article" slug="my-vault" pagePath={pagePath} comments={comments}
  />
)

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

beforeEach(() => {
  router.push.mockClear()
  mermaidRender.mockClear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ContentPanel: faixa de comentários', () => {
  it('a faixa fica entre as Propriedades e o corpo', () => {
    const { container } = render(panel(pageHtml(), on([th(comment('c1'))])))
    const strip = container.querySelector('.vault-comments')!
    expect(strip).not.toBeNull()
    const props = container.querySelector('.vault-properties')!
    const h1 = container.querySelector('h1')!
    expect(props.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(strip.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // o marcador saiu do HTML: quem ocupa o lugar é a faixa
    expect(container.querySelector('.vault-comments-slot')).toBeNull()
  })

  it('sem comentários ligados não há faixa (o marcador fica como um div vazio)', () => {
    const { container } = render(panel(pageHtml(), undefined, PAGE, false))
    expect(container.querySelector('.vault-comments')).toBeNull()
    expect(container.querySelector('.vault-comments-slot')!.childNodes).toHaveLength(0)
  })

  it('página sem marcador (aba, nota sem Propriedades) não ganha faixa mesmo com a flag', () => {
    const html = `<article class="vault-content">${BODY}</article>`
    const { container } = render(panel(html, on([th(comment('c1'))])))
    expect(container.querySelector('.vault-comments')).toBeNull()
  })

  it('um <details> aberto continua aberto quando o refresh só traz comentários novos', async () => {
    const { container, rerender } = render(panel(pageHtml(), on([th(comment('c1'))])))
    const details = container.querySelector<HTMLDetailsElement>('details.vault-callout')!
    details.open = true

    await act(async () => {
      rerender(panel(pageHtml(), on([th(comment('c2', { createdAt: '2026-11-12T12:00:00.000Z' })), th(comment('c1'))])))
    })

    expect(container.querySelectorAll('[data-comment-path]')).toHaveLength(2)
    const after = container.querySelector<HTMLDetailsElement>('details.vault-callout')!
    expect(after).toBe(details) // o nó não foi recriado
    expect(after.open).toBe(true)
  })

  it('quando o corpo muda de verdade, o HTML novo entra', async () => {
    const { container, rerender } = render(panel(pageHtml(), on()))
    await act(async () => { rerender(panel(pageHtml('<p>corpo novo</p>'), on())) })
    expect(container.textContent).toContain('corpo novo')
    expect(container.querySelector('details.vault-callout')).toBeNull()
  })

  it('o rascunho sobrevive ao refresh e é descartado ao navegar para outra página', async () => {
    const { container, rerender } = render(panel(pageHtml(), on()))
    fireEvent.click(container.querySelector('.vault-comments-write')!)
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'rascunho' } })

    await act(async () => { rerender(panel(pageHtml('<p>corpo novo</p>'), on())) })
    expect(container.querySelector('textarea')!.value).toBe('rascunho')

    await act(async () => { rerender(panel(pageHtml(), on(), 'Notas/Outra')) })
    expect(container.querySelector('textarea')).toBeNull()
  })

  it('link interno num comentário navega como os da nota', () => {
    const html = '<p><a href="/vault/my-vault/Notas/Outra">ver</a></p>'
    const { container } = render(panel(pageHtml(), on([th(comment('c1', { html }))])))
    const a = container.querySelector<HTMLAnchorElement>('.vault-comment-body a')!
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => { a.dispatchEvent(ev) })
    expect(ev.defaultPrevented).toBe(true)
    expect(router.push).toHaveBeenCalledWith('/vault/my-vault/Notas/Outra')
  })

  it('link externo num comentário abre em outra aba', () => {
    const html = '<p><a href="https://example.com/">fora</a></p>'
    const { container } = render(panel(pageHtml(), on([th(comment('c1', { html }))])))
    const a = container.querySelector<HTMLAnchorElement>('.vault-comment-body a')!
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('os botões e o campo da faixa não navegam nem abrem o lightbox', () => {
    const { container } = render(panel(pageHtml(), on([th(comment('c1'))])))
    fireEvent.click(container.querySelector('[data-action="reply"]')!)
    const textarea = container.querySelector('textarea')!
    fireEvent.click(textarea)
    fireEvent.change(textarea, { target: { value: 'oi' } })
    expect(textarea.value).toBe('oi')
    expect(router.push).not.toHaveBeenCalled()
    expect(container.querySelector('.vault-lightbox')).toBeNull()
  })

  it('mermaid: o bloco da nota vira diagrama, o de um comentário fica como código', async () => {
    const fence = (src: string) => `<pre><code class="language-mermaid">${src}</code></pre>`
    const { container } = render(
      panel(pageHtml(fence('graph TD; A--&gt;B')), on([th(comment('c1', { html: fence('graph TD; X--&gt;Y') }))])),
    )
    await flush()
    await flush()
    expect(mermaidRender).toHaveBeenCalledTimes(1)
    expect(mermaidRender.mock.calls[0][1]).toBe('graph TD; A-->B')
    expect(container.querySelector('.vault-comment-body pre > code.language-mermaid')).not.toBeNull()
    expect(container.querySelector('.vault-comment-body .mermaid-diagram')).toBeNull()
  })

  it('só com mermaid em comentário, a biblioteca nem é chamada', async () => {
    const html = '<pre><code class="language-mermaid">graph TD; X--&gt;Y</code></pre>'
    render(panel(pageHtml(), on([th(comment('c1', { html }))])))
    await flush()
    expect(mermaidRender).not.toHaveBeenCalled()
  })
})

describe('ContentPanel: prévia de link no hover', () => {
  const fetchMock = vi.fn<(url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>(
    async () => ({ ok: true, json: async () => ({ title: 'Título' }) }),
  )
  const previewCalls = (kind: string) => fetchMock.mock.calls.filter(([u]) => String(u).startsWith(kind))

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
  })
  afterEach(() => { vi.useRealTimers() })

  // Passa o mouse e espera mais que o atraso da prévia (350 ms).
  const hover = (a: Element) => {
    fireEvent.mouseOver(a)
    act(() => { vi.advanceTimersByTime(400) })
  }

  it('link externo dentro da faixa não busca a prévia externa', () => {
    const html = '<p><a href="https://comentario.example/">fora</a></p>'
    const { container } = render(panel(pageHtml(), on([th(comment('c1', { html }))])))
    hover(container.querySelector('.vault-comment-body a')!)
    expect(previewCalls('/api/link-preview')).toHaveLength(0)
  })

  it('link externo do corpo da nota continua buscando a prévia externa', () => {
    const { container } = render(
      panel(pageHtml('<p><a href="https://corpo.example/">fora</a></p>'), on([th(comment('c1'))])),
    )
    hover(container.querySelector('a[href="https://corpo.example/"]')!)
    expect(previewCalls('/api/link-preview')).toHaveLength(1)
  })

  it('link interno dentro da faixa continua com a prévia interna', () => {
    const html = '<p><a href="/vault/my-vault/Notas/Terceira">ver</a></p>'
    const { container } = render(panel(pageHtml(), on([th(comment('c1', { html }))])))
    hover(container.querySelector('.vault-comment-body a')!)
    expect(previewCalls('/api/vault/my-vault/preview')).toHaveLength(1)
  })
})

describe('ContentPanel: mesmo HTML, classe da nota diferente', () => {
  it('um cssclasses novo reaplica o HTML e os efeitos de DOM rodam de novo', async () => {
    const html = pageHtml('<p><a href="https://example.com/">fora</a></p>')
    const el = (cls: string) => (
      <ContentPanel
        segments={parseHtmlSegments(html, { comments: true })}
        css="" articleClass={cls} slug="my-vault" pagePath={PAGE} comments={on()}
      />
    )
    const { container, rerender } = render(el('vault-article'))
    const link = () => container.querySelector<HTMLAnchorElement>('a[href="https://example.com/"]')!
    expect(link().getAttribute('target')).toBe('_blank')
    await act(async () => { rerender(el('vault-article wide-page')) })
    expect(container.querySelector('.vault-article.wide-page')).not.toBeNull()
    // o efeito que marca links externos rodou sobre o HTML reaplicado
    expect(link().getAttribute('target')).toBe('_blank')
  })
})
