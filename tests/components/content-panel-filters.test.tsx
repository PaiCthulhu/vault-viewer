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

const ENGINES = ["Ren'Py", 'Unity', "Ren'Py", 'Unity', 'Godot', "Ren'Py"]
const STATUSES = ['Jogando', 'Zerado', 'Jogando', 'Zerado', 'Jogando', 'Zerado']

function card(i: number, engine: string, status: string) {
  const props = encodeURIComponent(JSON.stringify({ Engine: [engine], Status: [status] }))
  return `<div class="dv-card" data-props="${props}">c${i}</div>`
}

function segs(extra = 0): HtmlSegment[] {
  const cards = ENGINES.map((e, i) => card(i, e, STATUSES[i]))
  for (let i = 0; i < extra; i++) cards.push(card(100 + i, "Ren'Py", 'Jogando'))
  return [{ type: 'html', html: `<div class="dv-gallery">${cards.join('')}</div>` } as HtmlSegment]
}

const panel = (segments: HtmlSegment[], pagePath: string) => (
  <ContentPanel segments={segments} css="" articleClass="vault-article" slug="v" pagePath={pagePath} />
)

function pickEngine(container: HTMLElement) {
  fireEvent.click(container.querySelector('.dv-filter-add')!)
  const item = Array.from(container.querySelectorAll<HTMLElement>('.dv-filter-menu-item')).find(
    b => b.textContent === 'Engine',
  )!
  fireEvent.click(item)
  const select = container.querySelector<HTMLSelectElement>('.dv-filter-chip select')!
  fireEvent.change(select, { target: { value: 'Unity' } })
  return select
}

const visibleCards = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLElement>('.dv-card')).filter(x => x.style.display !== 'none')

describe('ContentPanel filtros', () => {
  afterEach(() => cleanup())

  it('filtro volta depois de um refresh da mesma página', async () => {
    const { container, rerender } = render(panel(segs(), 'Views/X'))
    pickEngine(container)
    expect(visibleCards(container)).toHaveLength(2)

    await act(async () => { rerender(panel(segs(1), 'Views/X')) })

    const chip = container.querySelector('.dv-filter-chip')
    expect(chip).not.toBeNull()
    expect(chip!.querySelector('select')!.value).toBe('Unity')
    const visible = visibleCards(container)
    expect(visible).toHaveLength(2)
    expect(visible.every(c => decodeURIComponent(c.dataset.props!).includes('Unity'))).toBe(true)
  })

  it('navegar para outra página zera os filtros', async () => {
    const { container, rerender } = render(panel(segs(), 'Views/X'))
    pickEngine(container)
    await act(async () => { rerender(panel(segs(1), 'Views/Y')) })
    expect(container.querySelector('.dv-filter-chip')).toBeNull()
  })
})
