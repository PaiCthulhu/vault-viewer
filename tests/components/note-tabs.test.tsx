// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'dark' }) }))
vi.mock('@/components/i18n/I18nProvider', async () => {
  const { getDict, translate } = await import('@/lib/i18n')
  const dict = getDict('pt-BR')
  return {
    useI18n: () => ({
      t: (k: string, vars?: Record<string, string | number>) => translate(dict, k, vars),
    }),
  }
})

import { NoteTabs } from '@/components/viewer/NoteTabs'
import { ContentPanel } from '@/components/viewer/ContentPanel'
import type { PageTab } from '@/builder/types'
import type { HtmlSegment } from '@/lib/parse-html-segments'

const TABS: PageTab[] = [
  { path: 'Seleções/Seleções', label: 'Resumo' },
  { path: 'Seleções/Lista', label: 'Lista' },
  { path: 'Seleções/Cartões #1', label: 'Cartões' },
]

const links = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLAnchorElement>('nav.vault-tabs a.vault-tab'))

// Ouvinte no window, que roda depois do React (ele escuta na raiz do render): anota se o
// componente cancelou a ação padrão do clique e então a cancela, para o jsdom não tentar
// seguir o link (ele não navega e só reclama no console).
let prevented: boolean[] = []
const stopNavigation = (e: Event) => {
  prevented.push(e.defaultPrevented)
  e.preventDefault()
}
beforeEach(() => {
  prevented = []
  window.addEventListener('click', stopNavigation)
})
afterEach(() => window.removeEventListener('click', stopNavigation))

// Clica e diz se o componente cancelou a ação padrão (true = ele cuidou do clique;
// false = o clique ficou com o navegador).
function click(el: Element, init?: MouseEventInit): boolean {
  fireEvent.click(el, init)
  return prevented[prevented.length - 1]
}

describe('NoteTabs', () => {
  beforeEach(() => push.mockClear())
  afterEach(() => cleanup())

  it('mostra as abas na ordem recebida, com rótulo e href codificado', () => {
    const { container } = render(<NoteTabs slug="v" tabs={TABS} currentPath="Seleções/Seleções" />)
    const as = links(container)
    expect(as.map(a => a.textContent)).toEqual(['Resumo', 'Lista', 'Cartões'])
    expect(as.map(a => a.getAttribute('href'))).toEqual([
      '/vault/v/Sele%C3%A7%C3%B5es/Sele%C3%A7%C3%B5es',
      '/vault/v/Sele%C3%A7%C3%B5es/Lista',
      '/vault/v/Sele%C3%A7%C3%B5es/Cart%C3%B5es%20%231',
    ])
    expect(container.querySelector('nav.vault-tabs')!.getAttribute('aria-label')).toBe('Abas')
  })

  it('destaca só a aba da página atual', () => {
    const { container } = render(<NoteTabs slug="v" tabs={TABS} currentPath="Seleções/Lista" />)
    const as = links(container)
    expect(as.map(a => a.getAttribute('aria-current'))).toEqual([null, 'page', null])
    expect(as.map(a => a.classList.contains('is-active'))).toEqual([false, true, false])
  })

  it('clique simples navega por SPA', () => {
    const { container } = render(<NoteTabs slug="v" tabs={TABS} currentPath="Seleções/Seleções" />)
    expect(click(links(container)[1])).toBe(true)
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/vault/v/Sele%C3%A7%C3%B5es/Lista')
  })

  it('clique com modificador ou outro botão fica com o navegador', () => {
    const { container } = render(<NoteTabs slug="v" tabs={TABS} currentPath="Seleções/Seleções" />)
    const a = links(container)[2]
    expect(click(a, { ctrlKey: true })).toBe(false)
    expect(click(a, { metaKey: true })).toBe(false)
    expect(click(a, { shiftKey: true })).toBe(false)
    expect(click(a, { altKey: true })).toBe(false)
    expect(click(a, { button: 1 })).toBe(false)
    expect(prevented).toHaveLength(5)
    expect(push).not.toHaveBeenCalled()
  })

  it('a mãe é a aba ativa na página da mãe', () => {
    const { container } = render(<NoteTabs slug="v" tabs={TABS} currentPath="Seleções/Seleções" />)
    expect(links(container).map(a => a.getAttribute('aria-current'))).toEqual(['page', null, null])
  })

  it('clique na aba já ativa não navega (nem recarrega a página)', () => {
    const { container } = render(<NoteTabs slug="v" tabs={TABS} currentPath="Seleções/Lista" />)
    expect(click(links(container)[1])).toBe(true)
    expect(push).not.toHaveBeenCalled()
    // Com modificador, continua com o navegador (abrir em outra aba).
    expect(click(links(container)[1], { ctrlKey: true })).toBe(false)
  })

  it('codifica % e ? no caminho como a sidebar', () => {
    const tabs = [TABS[0], { path: 'A/100% certo?', label: 'x' }]
    const { container } = render(<NoteTabs slug="v" tabs={tabs} currentPath="A/100% certo?" />)
    expect(links(container)[1].getAttribute('href')).toBe('/vault/v/A/100%25%20certo%3F')
  })

  it('rola a barra até a aba ativa quando ela está fora da vista', () => {
    // jsdom não tem layout: a barra mostra 0–100px e a aba ativa está em 150–200px.
    const rect = (l: number, r: number) => ({ left: l, right: r, top: 0, bottom: 40, width: r - l, height: 40, x: l, y: 0, toJSON() {} })
    const spyRect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.matches('nav.vault-tabs')) return rect(0, 100) as DOMRect
      if (this.matches('a.is-active')) return rect(150, 200) as DOMRect
      return rect(0, 50) as DOMRect
    })
    const scrolls: number[] = []
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollLeft')!
    Object.defineProperty(Element.prototype, 'scrollLeft', {
      configurable: true,
      get: () => 0,
      set: (v: number) => { scrolls.push(v) },
    })
    try {
      render(<NoteTabs slug="v" tabs={TABS} currentPath="Seleções/Cartões #1" />)
      expect(scrolls).toEqual([100])
    } finally {
      Object.defineProperty(Element.prototype, 'scrollLeft', desc)
      spyRect.mockRestore()
    }
  })

  it('não mexe na rolagem quando a aba ativa já está à vista', () => {
    const scrolls: number[] = []
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollLeft')!
    Object.defineProperty(Element.prototype, 'scrollLeft', {
      configurable: true,
      get: () => 0,
      set: (v: number) => { scrolls.push(v) },
    })
    try {
      render(<NoteTabs slug="v" tabs={TABS} currentPath="Seleções/Lista" />)
      expect(scrolls).toEqual([])
    } finally {
      Object.defineProperty(Element.prototype, 'scrollLeft', desc)
    }
  })

  it('rótulo é texto, não HTML', () => {
    const tabs = [TABS[0], { path: 'X/Y', label: '<b>negrito</b>' }]
    const { container } = render(<NoteTabs slug="v" tabs={tabs} currentPath="X/Y" />)
    expect(links(container)[1].textContent).toBe('<b>negrito</b>')
    expect(container.querySelector('nav b')).toBeNull()
  })

  it('sem abas (ou só uma) não mostra nada', () => {
    expect(render(<NoteTabs slug="v" tabs={undefined} currentPath="A" />).container.innerHTML).toBe('')
    expect(render(<NoteTabs slug="v" tabs={[]} currentPath="A" />).container.innerHTML).toBe('')
    expect(render(<NoteTabs slug="v" tabs={[TABS[0]]} currentPath="A" />).container.innerHTML).toBe('')
  })
})

describe('ContentPanel com abas', () => {
  beforeEach(() => push.mockClear())
  afterEach(() => cleanup())

  const segs: HtmlSegment[] = [{ type: 'html', html: '<article class="vault-article"><h1>T</h1></article>' } as HtmlSegment]

  it('põe a barra antes do artigo e navega uma vez só', () => {
    const { container } = render(
      <ContentPanel segments={segs} css="" articleClass="vault-article" slug="v" pagePath="Seleções/Lista" tabs={TABS} />,
    )
    const nav = container.querySelector('nav.vault-tabs')!
    const article = container.querySelector('article.vault-article')!
    expect(nav).not.toBeNull()
    expect(nav.compareDocumentPosition(article) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(nav.contains(article)).toBe(false)
    fireEvent.click(links(container)[0])
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/vault/v/Sele%C3%A7%C3%B5es/Sele%C3%A7%C3%B5es')
  })

  it('re-render com novas `tabs` (refresh) não recria o artigo nem fecha <details>', () => {
    const withDetails: HtmlSegment[] = [
      { type: 'html', html: '<article class="vault-article"><details><summary>s</summary>x</details></article>' } as HtmlSegment,
    ]
    const props = { segments: withDetails, css: '', articleClass: 'vault-article', slug: 'v', pagePath: 'Seleções/Lista' }
    const { container, rerender } = render(<ContentPanel {...props} tabs={TABS} />)
    const article = container.querySelector('article')!
    const details = container.querySelector('details')!
    details.open = true
    rerender(<ContentPanel {...props} tabs={TABS.map(t => ({ ...t }))} />)
    rerender(<ContentPanel {...props} />)
    rerender(<ContentPanel {...props} tabs={TABS} />)
    expect(container.querySelector('article')).toBe(article)
    expect(container.querySelector('details')!.open).toBe(true)
  })

  it('sem `tabs` não há barra', () => {
    const { container } = render(
      <ContentPanel segments={segs} css="" articleClass="vault-article" slug="v" pagePath="Pasta/B" />,
    )
    expect(container.querySelector('nav.vault-tabs')).toBeNull()
  })
})
