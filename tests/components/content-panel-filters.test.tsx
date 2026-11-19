// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
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

import { ContentPanel } from '@/components/viewer/ContentPanel'
import type { HtmlSegment } from '@/lib/parse-html-segments'

const ENGINES = ["Alfa'X", 'Gama', "Alfa'X", 'Gama', 'Ômega', "Alfa'X"]
const STATUSES = ['Fase Um', 'Fase Dois', 'Fase Um', 'Fase Dois', 'Fase Um', 'Fase Dois']

function card(i: number, engine: string, status: string) {
  const props = encodeURIComponent(JSON.stringify({ Motor: [engine], Etapa: [status] }))
  return `<div class="dv-card" data-props="${props}">c${i}</div>`
}

function segs(extra = 0): HtmlSegment[] {
  const cards = ENGINES.map((e, i) => card(i, e, STATUSES[i]))
  for (let i = 0; i < extra; i++) cards.push(card(100 + i, "Alfa'X", 'Fase Um'))
  return [{ type: 'html', html: `<div class="dv-gallery">${cards.join('')}</div>` } as HtmlSegment]
}

const panel = (segments: HtmlSegment[], pagePath: string) => (
  <ContentPanel segments={segments} css="" articleClass="vault-article" slug="v" pagePath={pagePath} />
)

function pickEngine(container: HTMLElement) {
  fireEvent.click(container.querySelector('.dv-filter-add')!)
  const item = Array.from(container.querySelectorAll<HTMLElement>('.dv-filter-menu-item')).find(
    b => b.textContent === 'Motor',
  )!
  fireEvent.click(item)
  const select = container.querySelector<HTMLSelectElement>('.dv-filter-chip select')!
  fireEvent.change(select, { target: { value: 'Gama' } })
  return select
}

const visibleCards = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLElement>('.dv-card')).filter(x => x.style.display !== 'none')

describe('ContentPanel filtros', () => {
  afterEach(() => cleanup())

  it('filtro volta depois de um refresh da mesma página', async () => {
    const { container, rerender } = render(panel(segs(), 'Pasta/X'))
    pickEngine(container)
    expect(visibleCards(container)).toHaveLength(2)

    await act(async () => { rerender(panel(segs(1), 'Pasta/X')) })

    const chip = container.querySelector('.dv-filter-chip')
    expect(chip).not.toBeNull()
    expect(chip!.querySelector('select')!.value).toBe('Gama')
    const visible = visibleCards(container)
    expect(visible).toHaveLength(2)
    expect(visible.every(c => decodeURIComponent(c.dataset.props!).includes('Gama'))).toBe(true)
  })

  it('navegar para outra página zera os filtros', async () => {
    const { container, rerender } = render(panel(segs(), 'Pasta/X'))
    pickEngine(container)
    await act(async () => { rerender(panel(segs(1), 'Pasta/Y')) })
    expect(container.querySelector('.dv-filter-chip')).toBeNull()
  })
})

// ─── Busca ────────────────────────────────────────────────────────────────
type Entry = [string, Record<string, string[]> | null]
const SEARCH_CARDS: Entry[] = [
  ['Alfa', { Nível: ['Ouro'], Seleções: ['Casa Órbita', 'Círculo Azul'] }],
  ['Bravo', { Nível: ['Prata'], Seleções: ['Liga de Exemplópolis'] }],
  ['Charlie', { Nível: ['Ouro'], Seleções: ['Liga de Exemplópolis', 'Casa Órbita'] }],
  ['Delta', { Nível: ['Prata'], Seleções: ['Círculo Azul'] }],
  ['Echo', { Nível: ['Bronze'], Seleções: ['Casa Órbita'] }],
  ['Foxtrot Velho', null],
]

function searchSegs(entries: Entry[] = SEARCH_CARDS): HtmlSegment[] {
  const cards = entries.map(([name, props]) => {
    const attr = props ? ` data-props="${encodeURIComponent(JSON.stringify(props))}"` : ''
    return `<div class="dv-card"${attr}>${name}</div>`
  })
  return [{ type: 'html', html: `<div class="dv-gallery">${cards.join('')}</div>` } as HtmlSegment]
}

// O campo fica sempre aberto; "entrar" nele é só focar.
const focusSearch = (c: HTMLElement) => searchInput(c).focus()
const searchInput = (c: HTMLElement) =>
  c.querySelector<HTMLInputElement>('.dv-filter-search-input')!
const typeSearch = (c: HTMLElement, v: string) =>
  fireEvent.input(searchInput(c), { target: { value: v } })
const visibleNames = (c: HTMLElement) => visibleCards(c).map(x => x.textContent)
const clearX = (c: HTMLElement) => c.querySelector<HTMLElement>('.dv-filter-search-clear')!

function pickTier(c: HTMLElement, value: string) {
  fireEvent.click(c.querySelector('.dv-filter-add')!)
  const item = Array.from(c.querySelectorAll<HTMLElement>('.dv-filter-menu-item')).find(
    b => b.textContent === 'Nível',
  )!
  fireEvent.click(item)
  fireEvent.change(c.querySelector<HTMLSelectElement>('.dv-filter-chip select')!, {
    target: { value },
  })
}

describe('ContentPanel busca', () => {
  afterEach(() => cleanup())

  it('campo de busca já aparece aberto, sem botão para expandir', () => {
    const { container } = render(panel(searchSegs(), 'S/A'))
    expect(searchInput(container)).not.toBeNull()
    expect(container.querySelector('.dv-filter-search-toggle')).toBeNull()
    expect(document.activeElement).not.toBe(searchInput(container))
  })

  it('clicar na lupa foca o campo sem tirar o foco no mousedown', () => {
    const { container } = render(panel(searchSegs(), 'S/A'))
    const icon = container.querySelector<HTMLElement>('.dv-filter-search-icon')!
    expect(fireEvent.mouseDown(icon)).toBe(false)
    fireEvent.click(icon)
    expect(document.activeElement).toBe(searchInput(container))
  })

  it('busca pelo texto visível', () => {
    const { container } = render(panel(searchSegs(), 'S/A'))
    typeSearch(container, 'cha')
    expect(visibleNames(container)).toEqual(['Charlie'])
  })

  it('busca em valor de propriedade, sem acento', () => {
    const { container } = render(panel(searchSegs(), 'S/A'))
    typeSearch(container, 'orbita')
    expect(visibleNames(container)).toEqual(['Alfa', 'Charlie', 'Echo'])
  })

  it('várias palavras: todas, em qualquer ordem', () => {
    const { container } = render(panel(searchSegs(), 'S/A'))
    typeSearch(container, 'orbita exemp')
    expect(visibleNames(container)).toEqual(['Charlie'])
    typeSearch(container, 'exemp orbita')
    expect(visibleNames(container)).toEqual(['Charlie'])
  })

  it('card sem data-props entra pela busca', () => {
    const { container } = render(panel(searchSegs(), 'S/A'))
    typeSearch(container, 'foxtrot')
    expect(visibleNames(container)).toEqual(['Foxtrot Velho'])
  })

  it('soma com chip (AND)', () => {
    const { container } = render(panel(searchSegs(), 'S/A'))
    pickTier(container, 'Ouro')
    expect(visibleNames(container)).toEqual(['Alfa', 'Charlie', 'Foxtrot Velho'])
    typeSearch(container, 'orbita')
    expect(visibleNames(container)).toEqual(['Alfa', 'Charlie'])
  })

  it('sem resultado mantém a barra e conta zero', () => {
    const { container } = render(panel(searchSegs(), 'S/A'))
    typeSearch(container, 'zzz')
    expect(visibleNames(container)).toEqual([])
    const bar = container.querySelector<HTMLElement>('.dv-filterbar')!
    expect(bar).not.toBeNull()
    expect(bar.style.display).not.toBe('none')
    expect(container.querySelector('.dv-filter-count')!.textContent).toBe('0 itens')
  })

  it('contador conta a busca', () => {
    const { container } = render(panel(searchSegs(), 'S/A'))
    typeSearch(container, 'orbita')
    expect(container.querySelector('.dv-filter-count')!.textContent).toBe('3 itens')
  })

  it('✕ só aparece com texto no campo', () => {
    const { container } = render(panel(searchSegs(), 'S/A'))
    expect(clearX(container).style.visibility).toBe('hidden')
    typeSearch(container, 'cha')
    expect(clearX(container).style.visibility).not.toBe('hidden')
    typeSearch(container, '')
    expect(clearX(container).style.visibility).toBe('hidden')
  })

  it('Esc limpa a busca e o foco fica no campo', () => {
    const { container } = render(panel(searchSegs(), 'S/A'))
    focusSearch(container)
    typeSearch(container, 'cha')
    fireEvent.keyDown(searchInput(container), { key: 'Escape' })
    expect(searchInput(container).value).toBe('')
    expect(document.activeElement).toBe(searchInput(container))
    expect(visibleNames(container)).toHaveLength(6)
  })

  it('✕ limpa a busca e devolve o foco ao campo', () => {
    const { container } = render(panel(searchSegs(), 'S/A'))
    focusSearch(container)
    typeSearch(container, 'cha')
    expect(fireEvent.mouseDown(clearX(container))).toBe(false)
    fireEvent.click(clearX(container))
    expect(searchInput(container).value).toBe('')
    expect(document.activeElement).toBe(searchInput(container))
    expect(visibleNames(container)).toHaveLength(6)
  })

  it('Limpar zera chips e busca', () => {
    const { container } = render(panel(searchSegs(), 'S/A'))
    pickTier(container, 'Ouro')
    typeSearch(container, 'orbita')
    fireEvent.click(container.querySelector('.dv-filter-clear')!)
    expect(container.querySelector('.dv-filter-chip')).toBeNull()
    expect(searchInput(container).value).toBe('')
    expect(visibleNames(container)).toHaveLength(6)
    expect(container.querySelector<HTMLElement>('.dv-filter-clear')!.style.display).toBe('none')
  })

  it('Limpar aparece só com busca', () => {
    const { container } = render(panel(searchSegs(), 'S/A'))
    typeSearch(container, 'cha')
    expect(container.querySelector<HTMLElement>('.dv-filter-clear')!.style.display).not.toBe('none')
  })

  it('busca e foco voltam depois de um refresh da mesma página', async () => {
    const { container, rerender } = render(panel(searchSegs(), 'S/A'))
    focusSearch(container)
    typeSearch(container, 'orbita')
    await act(async () => { rerender(panel(searchSegs(), 'S/A')) })
    const input = searchInput(container)
    expect(input.value).toBe('orbita')
    expect(document.activeElement).toBe(input)
    expect(input.selectionStart).toBe(6)
    expect(clearX(container).style.visibility).not.toBe('hidden')
    expect(visibleNames(container)).toEqual(['Alfa', 'Charlie', 'Echo'])
  })

  it('refresh sem foco no campo não rouba o foco', async () => {
    const { container, rerender } = render(panel(searchSegs(), 'S/A'))
    focusSearch(container)
    typeSearch(container, 'orbita')
    searchInput(container).blur()
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    await act(async () => { rerender(panel(searchSegs(), 'S/A')) })
    const input = searchInput(container)
    expect(input.value).toBe('orbita')
    expect(document.activeElement).not.toBe(input)
  })

  it('navegar para outra página zera a busca', async () => {
    const { container, rerender } = render(panel(searchSegs(), 'S/A'))
    typeSearch(container, 'orbita')
    await act(async () => { rerender(panel(searchSegs(), 'S/B')) })
    expect(searchInput(container).value).toBe('')
  })

  it('barra aparece só com busca quando nenhuma propriedade serve de chip', () => {
    const entries: Entry[] = ['Item Um', 'Item Dois', 'Item Três', 'Item Quatro'].map(n => [n, { Tipo: ['Exemplo'] }])
    const { container } = render(panel(searchSegs(entries), 'S/C'))
    expect(container.querySelector('.dv-filterbar')).not.toBeNull()
    expect(container.querySelector<HTMLElement>('.dv-filter-add')!.style.display).toBe('none')
    typeSearch(container, 'tres')
    expect(visibleNames(container)).toEqual(['Item Três'])
  })

  it.each([
    ['Esc', (c: HTMLElement) => fireEvent.keyDown(searchInput(c), { key: 'Escape' })],
    ['✕', (c: HTMLElement) => fireEvent.click(clearX(c))],
  ])('digitar, %s, rerender da mesma página: campo vazio e focado', async (_n, clear) => {
    const { container, rerender } = render(panel(searchSegs(), 'S/A'))
    focusSearch(container)
    typeSearch(container, 'cha')
    clear(container)
    await act(async () => { rerender(panel(searchSegs(), 'S/A')) })
    const input = searchInput(container)
    expect(input.value).toBe('')
    expect(document.activeElement).toBe(input)
    expect(visibleNames(container)).toHaveLength(6)
  })

  it('digitar, Limpar, rerender da mesma página: campo vazio e sem roubar o foco', async () => {
    const { container, rerender } = render(panel(searchSegs(), 'S/A'))
    focusSearch(container)
    typeSearch(container, 'cha')
    fireEvent.click(container.querySelector('.dv-filter-clear')!)
    await act(async () => { rerender(panel(searchSegs(), 'S/A')) })
    const input = searchInput(container)
    expect(input.value).toBe('')
    expect(document.activeElement).not.toBe(input)
  })

  it('restaura o foco sem rolar a página', async () => {
    const spy = vi.spyOn(HTMLInputElement.prototype, 'focus')
    try {
      const { container, rerender } = render(panel(searchSegs(), 'S/A'))
      focusSearch(container)
      typeSearch(container, 'orbita')
      spy.mockClear()
      await act(async () => { rerender(panel(searchSegs(), 'S/A')) })
      expect(spy).toHaveBeenCalledWith({ preventScroll: true })
    } finally {
      spy.mockRestore()
    }
  })

  it('blur tardio de input removido não apaga o foco lembrado', async () => {
    const { container, rerender } = render(panel(searchSegs(), 'S/A'))
    focusSearch(container)
    typeSearch(container, 'orbita')
    const old = searchInput(container)
    await act(async () => { rerender(panel(searchSegs(), 'S/A')) })
    expect(old.isConnected).toBe(false)
    fireEvent.blur(old)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    await act(async () => { rerender(panel(searchSegs(), 'S/A')) })
    expect(document.activeElement).toBe(searchInput(container))
  })
})
