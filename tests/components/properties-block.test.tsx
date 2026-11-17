// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'

// O I18nProvider de verdade usa o router (para o refresh ao trocar de idioma).
const router = { push: vi.fn(), refresh: vi.fn() }
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'dark' }) }))

import { I18nProvider } from '@/components/i18n/I18nProvider'
import { PropertiesBlock } from '@/components/viewer/PropertiesBlock'
import { ContentPanel, type ContentPanelComments } from '@/components/viewer/ContentPanel'
import { parseHtmlSegments, PROPERTIES_SLOT, COMMENTS_SLOT } from '@/lib/parse-html-segments'
import type { PageProperty } from '@/builder/types'

const PAGE = 'Notes/My Note'

const PROPS: PageProperty[] = [
  { key: 'genres', type: 'multitext', value: ['RPG'], html: '<span class="vault-prop-chip" data-color="blue">RPG</span>' },
  { key: 'status', type: 'text', value: null, html: '' },
]

// Cópia nova com o mesmo conteúdo, como um router.refresh() entrega.
const fresh = (props: PageProperty[]): PageProperty[] => JSON.parse(JSON.stringify(props))

const BODY =
  '<details class="vault-callout"><summary>Dobrável</summary><p>dentro</p></details>' +
  '<p><a href="/vault/my-vault/Notes/Other">link da nota</a></p>'
const TITLE = '<h1 class="vault-page-title">My Note</h1>'
const pageHtml = (body = BODY, extra = '') =>
  `<article class="vault-content">${TITLE}${PROPERTIES_SLOT}${extra}${body}</article>`

const panel = (
  html: string,
  properties: PageProperty[] | undefined,
  opts: { comments?: ContentPanelComments; pagePath?: string } = {},
) => (
  <I18nProvider locale="pt-BR">
    <ContentPanel
      segments={parseHtmlSegments(html, { properties: true, comments: !!opts.comments })}
      css="" articleClass="vault-article" slug="my-vault" pagePath={opts.pagePath ?? PAGE}
      properties={properties} comments={opts.comments}
    />
  </I18nProvider>
)

beforeEach(() => {
  router.push.mockClear()
})
afterEach(() => {
  cleanup()
})

describe('PropertiesBlock', () => {
  const block = (properties: PageProperty[]) =>
    render(
      <I18nProvider locale="pt-BR">
        <PropertiesBlock properties={properties} />
      </I18nProvider>,
    )

  it('uma linha .vault-prop por propriedade, com a marcação do bloco antigo', () => {
    const { container } = block(PROPS)
    const details = container.querySelector<HTMLDetailsElement>('details.vault-properties')!
    expect(details).not.toBeNull()
    expect(details.open).toBe(false) // fechado por padrão
    const summary = details.querySelector('summary.vault-properties-summary')!
    expect(summary.querySelector('.vault-properties-chevron')!.textContent).toBe('▸')
    expect(summary.textContent).toContain('Propriedades')

    const rows = container.querySelectorAll('.vault-properties-body > .vault-prop')
    expect(rows).toHaveLength(2)
    expect(rows[0].querySelector('.vault-prop-key')!.textContent).toBe('genres')
    expect(rows[0].querySelector('.vault-prop-val .vault-prop-chip[data-color="blue"]')!.textContent).toBe('RPG')
    // a propriedade vazia aparece, com o valor vazio
    expect(rows[1].querySelector('.vault-prop-key')!.textContent).toBe('status')
    expect(rows[1].querySelector('.vault-prop-val')!.innerHTML).toBe('')
  })

  it('a chave é texto, nunca HTML', () => {
    const { container } = block([{ key: '<b>k</b>', type: 'text', value: 'x', html: 'x' }])
    const key = container.querySelector('.vault-prop-key')!
    expect(key.textContent).toBe('<b>k</b>')
    expect(key.querySelector('b')).toBeNull()
  })
})

describe('ContentPanel: segmento de Propriedades', () => {
  it('o bloco fica entre o título e o corpo, numa caixa própria', () => {
    const html = pageHtml()
    expect(parseHtmlSegments(html, { properties: true }).map(s => s.type)).toEqual(['html', 'properties', 'html'])
    const { container } = render(panel(html, PROPS))
    const props = container.querySelector('.vault-properties')!
    const title = container.querySelector('.vault-page-title')!
    const body = container.querySelector('details.vault-callout')!
    expect(title.compareDocumentPosition(props) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(props.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const wrap = props.parentElement!
    expect(wrap.className).toBe('vault-article vault-properties-wrap')
    expect(container.querySelector('.vault-properties-slot')).toBeNull()
  })

  it('sem a prop properties, ou com ela vazia, não renderiza nada no lugar do segmento', () => {
    for (const properties of [undefined, []]) {
      const { container } = render(panel(pageHtml(), properties))
      expect(container.querySelector('.vault-properties')).toBeNull()
      expect(container.querySelector('.vault-properties-wrap')).toBeNull()
      expect(container.querySelector('details.vault-callout')).not.toBeNull()
      cleanup()
    }
  })

  it('refresh com o mesmo conteúdo: o <details> não é recriado e continua aberto', async () => {
    const { container, rerender } = render(panel(pageHtml(), PROPS))
    const details = container.querySelector<HTMLDetailsElement>('details.vault-properties')!
    const chip = container.querySelector('.vault-prop-chip')!
    details.open = true

    await act(async () => { rerender(panel(pageHtml(), fresh(PROPS))) })

    const after = container.querySelector<HTMLDetailsElement>('details.vault-properties')!
    expect(after).toBe(details)
    expect(after.open).toBe(true)
    // o valor igual não teve o innerHTML reaplicado
    expect(container.querySelector('.vault-prop-chip')).toBe(chip)
  })

  it('refresh com um valor novo na mesma página: continua aberto e o valor novo aparece', async () => {
    const { container, rerender } = render(panel(pageHtml(), PROPS))
    const details = container.querySelector<HTMLDetailsElement>('details.vault-properties')!
    details.open = true

    const changed = fresh(PROPS)
    changed[0] = { ...changed[0], value: ['RPG', 'Ação'], html: changed[0].html + '<span class="vault-prop-chip" data-color="red">Ação</span>' }
    await act(async () => { rerender(panel(pageHtml(), changed)) })

    const after = container.querySelector<HTMLDetailsElement>('details.vault-properties')!
    expect(after).toBe(details)
    expect(after.open).toBe(true)
    expect(container.querySelector('.vault-prop-chip[data-color="red"]')!.textContent).toBe('Ação')
  })

  it('o <details> continua aberto quando o corpo muda no refresh', async () => {
    const { container, rerender } = render(panel(pageHtml(), PROPS))
    const details = container.querySelector<HTMLDetailsElement>('details.vault-properties')!
    details.open = true
    await act(async () => { rerender(panel(pageHtml('<p>corpo novo</p>'), fresh(PROPS))) })
    expect(container.textContent).toContain('corpo novo')
    expect(container.querySelector('details.vault-properties')).toBe(details)
    expect(details.open).toBe(true)
  })

  it('ao navegar para outra página o bloco é outro (fechado de novo)', async () => {
    const { container, rerender } = render(panel(pageHtml(), PROPS))
    container.querySelector<HTMLDetailsElement>('details.vault-properties')!.open = true
    await act(async () => { rerender(panel(pageHtml(), fresh(PROPS), { pagePath: 'Notes/Other' })) })
    expect(container.querySelector<HTMLDetailsElement>('details.vault-properties')!.open).toBe(false)
  })

  it('a miniatura abre o lightbox e o link interno navega como os da nota', () => {
    const props: PageProperty[] = [
      { key: 'cover', type: 'text', value: 'x.png', html: '<img class="vault-prop-thumb" src="/vault-assets/my-vault/x.png" alt="" />' },
      { key: 'related', type: 'text', value: '[[Notes/Other]]', html: '<a href="/vault/my-vault/Notes/Other">Other</a>' },
    ]
    const { container } = render(panel(pageHtml(), props))
    fireEvent.click(container.querySelector('.vault-prop-thumb')!)
    expect(container.querySelector('.vault-lightbox img')).not.toBeNull()

    const a = container.querySelector<HTMLAnchorElement>('.vault-prop-val a')!
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => { a.dispatchEvent(ev) })
    expect(ev.defaultPrevented).toBe(true)
    expect(router.push).toHaveBeenCalledWith('/vault/my-vault/Notes/Other')
  })

  it('link externo numa propriedade abre em outra aba, mesmo num valor que chega pelo refresh', async () => {
    const url = (u: string): PageProperty[] => [{ key: 'site', type: 'text', value: u, html: `<a href="${u}">${u}</a>` }]
    const { container, rerender } = render(panel(pageHtml(), url('https://example.com/')))
    const first = container.querySelector<HTMLAnchorElement>('.vault-prop-val a')!
    expect(first.getAttribute('target')).toBe('_blank')
    expect(first.getAttribute('rel')).toBe('noopener noreferrer')

    // o corpo é o mesmo, então os segmentos ficam e o efeito do ContentPanel não roda de novo
    await act(async () => { rerender(panel(pageHtml(), url('https://example.org/'))) })
    const second = container.querySelector<HTMLAnchorElement>('.vault-prop-val a')!
    expect(second.getAttribute('href')).toBe('https://example.org/')
    expect(second.getAttribute('target')).toBe('_blank')
  })

  it('com a faixa de comentários, a ordem é Propriedades, faixa, corpo', () => {
    const comments: ContentPanelComments = { threads: [], displayNames: {}, username: 'ana', isAdmin: false }
    const html = pageHtml(BODY, COMMENTS_SLOT)
    const { container } = render(panel(html, PROPS, { comments }))
    const props = container.querySelector('.vault-properties')!
    const strip = container.querySelector('.vault-comments')!
    const body = container.querySelector('details.vault-callout')!
    expect(props.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(strip.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('HTML antigo (o <details> dentro do artigo, sem slot) segue como antes', () => {
    const old =
      '<article class="vault-content"><details class="vault-properties"><summary>Properties</summary>' +
      '<div class="vault-properties-body"><div class="vault-prop"><span class="vault-prop-key">k</span>' +
      '<span class="vault-prop-val">v</span></div></div></details><p>corpo</p></article>'
    const { container } = render(panel(old, undefined))
    expect(container.querySelectorAll('details.vault-properties')).toHaveLength(1)
    expect(container.querySelector('.vault-properties-wrap')).toBeNull()
    expect(container.querySelector('.vault-prop-key')!.textContent).toBe('k')
  })
})
