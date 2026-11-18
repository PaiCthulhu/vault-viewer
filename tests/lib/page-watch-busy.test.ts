// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { isUserBusy } from '@/lib/page-watch'

afterEach(() => {
  document.body.innerHTML = ''
})

function focused(tag: string, attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  document.body.appendChild(el)
  el.focus()
  return el
}

describe('isUserBusy', () => {
  it('menu de filtro aberto é ocupado', () => {
    const m = document.createElement('div')
    m.className = 'dv-filter-menu is-open'
    document.body.appendChild(m)
    expect(isUserBusy(document, -Infinity, 10_000)).toBe(true)
  })

  it('foco num input de texto com interação recente é ocupado', () => {
    focused('input', { type: 'text' })
    expect(isUserBusy(document, 1_000, 3_999)).toBe(true)
  })

  it('foco parado há 3 s não é ocupado', () => {
    focused('input', { type: 'text' })
    expect(isUserBusy(document, 1_000, 4_000)).toBe(false)
  })

  it('select e textarea contam', () => {
    focused('select')
    expect(isUserBusy(document, 0, 100)).toBe(true)
    document.body.innerHTML = ''
    focused('textarea')
    expect(isUserBusy(document, 0, 100)).toBe(true)
  })

  it('contenteditable conta', () => {
    focused('div', { contenteditable: 'true', tabindex: '0' })
    expect(isUserBusy(document, 0, 100)).toBe(true)
  })

  it('checkbox e botão não contam', () => {
    focused('input', { type: 'checkbox' })
    expect(isUserBusy(document, 0, 100)).toBe(false)
    document.body.innerHTML = ''
    focused('button')
    expect(isUserBusy(document, 0, 100)).toBe(false)
  })

  it('linha de propriedade em edição é ocupado, sem olhar a janela de interação', () => {
    document.body.innerHTML =
      '<details class="vault-properties"><div class="vault-prop is-editing"></div></details>'
    expect(isUserBusy(document, -Infinity, 10_000)).toBe(true)
  })

  it('linha de propriedade fora de edição não é ocupado', () => {
    document.body.innerHTML = '<details class="vault-properties"><div class="vault-prop"></div></details>'
    expect(isUserBusy(document, -Infinity, 10_000)).toBe(false)
  })
})
