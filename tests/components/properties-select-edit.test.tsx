// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'

// O I18nProvider de verdade usa o router (para o refresh ao trocar de idioma).
const router = { push: vi.fn(), refresh: vi.fn() }
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'dark' }) }))

import { I18nProvider } from '@/components/i18n/I18nProvider'
import { PropertiesBlock, type PropertiesEditContext } from '@/components/viewer/PropertiesBlock'
import { SelectEditor } from '@/components/viewer/PropertyEditors'
import type { PageProperty } from '@/builder/types'
import { toPageProperty, type PropertyRenderContext } from '@/builder/plugins/properties'
import { LinkResolver } from '@/builder/link-resolver'
import { EMPTY_PROPERTY_CONFIG, type PropertyConfig } from '@/builder/property-types'
import { propertyColor } from '@/lib/property-color'

const EDIT: PropertiesEditContext = { slug: 'my-vault', pagePath: 'Notes/My Note' }

const resolver = new LinkResolver([{ absolutePath: '/v/Notes/Other.md', relativePath: 'Notes/Other', title: 'Other' }])
const CONFIG: PropertyConfig = {
  ...EMPTY_PROPERTY_CONFIG,
  select: new Map([['status', ['todo', 'doing', 'done', 'dropped']]]),
  colors: new Map([['status', new Map([['done', 'green'], ['dropped', 'red']])]]),
} as PropertyConfig
const CTX: PropertyRenderContext = {
  renderWikilinks: s => resolver.replaceWikilinksEscaped(s, 'my-vault'),
  resolveImage: p => '/vault-assets/my-vault/' + p,
  config: CONFIG,
}
const prop = (key: string, value: unknown): PageProperty => toPageProperty(key, value, CTX)
// Sem `select` declarado: continua um texto comum.
const PLAIN_CTX: PropertyRenderContext = { ...CTX, config: EMPTY_PROPERTY_CONFIG }

const STATUS = prop('status', 'todo')
const SUGGESTIONS = ['todo', 'doing', 'done', 'dropped', 'zeta']

const view = (properties: PageProperty[]) => (
  <I18nProvider locale="pt-BR">
    <PropertiesBlock properties={properties} edit={EDIT} />
  </I18nProvider>
)

// ─── fetch em stub: o GET de sugestões responde sozinho; o PATCH fica pendente ──────
type Call = { url: string; method: string; body: Record<string, unknown> }
type Reply = { status: number; body: unknown }
let calls: Call[] = []
let pending: Array<(r: Reply) => void> = []
let valuesReply: Reply = { status: 200, body: { values: SUGGESTIONS } }

const response = ({ status, body }: Reply) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
    if (url.includes('/property-values?key=')) return Promise.resolve(response(valuesReply))
    calls.push({ url, method: String(init.method), body: JSON.parse(String(init.body)) })
    return new Promise<Response>(resolve => { pending.push(r => resolve(response(r))) })
  }))
}

const settle = () => act(async () => {
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0))
})

// ─── consultas e ações na tela ───────────────────────────────────────────────────
const rowOf = (el: HTMLElement, key: string) => {
  const row = Array.from(el.querySelectorAll<HTMLElement>('.vault-prop'))
    .find(r => r.querySelector('.vault-prop-key')?.textContent === key)
  if (!row) throw new Error('sem a linha ' + key)
  return row
}
const editableOf = (el: HTMLElement, key: string) =>
  rowOf(el, key).querySelector<HTMLElement>('.vault-prop-editable')!
const editorOf = (el: HTMLElement) => el.querySelector<HTMLElement>('.vault-prop-select')
const inputOf = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input.vault-prop-list-input')
const editorChips = (el: HTMLElement) =>
  Array.from(editorOf(el)!.querySelectorAll<HTMLElement>(':scope > .vault-prop-chip'))
const optionsOf = (el: HTMLElement) =>
  Array.from(el.querySelectorAll<HTMLElement>('.vault-prop-menu li[role="option"]:not([aria-disabled])'))
const optionTexts = (el: HTMLElement) => optionsOf(el).map(o => o.textContent)
const optionByText = (el: HTMLElement, text: string) => optionsOf(el).find(o => o.textContent === text)!
const shownChip = (el: HTMLElement, key: string) =>
  rowOf(el, key).querySelector<HTMLElement>('.vault-prop-val .vault-prop-chip')

async function open(el: HTMLElement, key: string) {
  fireEvent.click(editableOf(el, key))
  await settle()
}
const typeIn = (el: HTMLElement, text: string) => { fireEvent.change(inputOf(el)!, { target: { value: text } }) }
const press = (el: HTMLElement, key: string) => { fireEvent.keyDown(inputOf(el)!, { key }) }
const focusOn = (target: HTMLElement) => { act(() => { target.focus() }) }

async function respond(reply: Reply) {
  const next = pending.shift()
  if (!next) throw new Error('nenhum PATCH pendente')
  next(reply)
  await settle()
}

beforeEach(() => {
  calls = []
  pending = []
  valuesReply = { status: 200, body: { values: SUGGESTIONS } }
  stubFetch()
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PropertiesBlock com edição: seleção única', () => {
  it('abre com o valor atual como chip com ×, e as opções na ordem do índice, na cor', async () => {
    expect(STATUS.select).toBe(true)
    const { container } = render(view([STATUS]))
    await open(container, 'status')

    expect(rowOf(container, 'status').classList.contains('is-editing')).toBe(true)
    const chips = editorChips(container)
    expect(chips).toHaveLength(1)
    expect(chips[0].firstChild!.textContent).toBe('todo')
    expect(chips[0].querySelector('button')!.getAttribute('aria-label')).toBe('Remover todo')

    const input = inputOf(container)!
    expect(input.getAttribute('role')).toBe('combobox')
    expect(document.activeElement).toBe(input)
    // o valor atual continua entre as opções
    expect(optionTexts(container)).toEqual(SUGGESTIONS)
    expect(optionByText(container, 'done').querySelector<HTMLElement>('.vault-prop-chip')!.dataset.color).toBe('green')
    expect(optionByText(container, 'dropped').querySelector<HTMLElement>('.vault-prop-chip')!.dataset.color).toBe('red')
    expect(optionByText(container, 'zeta').querySelector<HTMLElement>('.vault-prop-chip')!.dataset.color)
      .toBe(propertyColor('status', 'zeta'))
  })

  it('clicar numa opção grava, fecha o editor e mostra a linha provisória na cor escolhida', async () => {
    const { container } = render(view([STATUS]))
    await open(container, 'status')
    fireEvent.click(optionByText(container, 'done'))
    await settle()

    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('PATCH')
    expect(calls[0].body).toMatchObject({ key: 'status', value: 'done', expected: 'todo' })
    expect(editorOf(container)).toBeNull()
    expect(shownChip(container, 'status')!.textContent).toBe('done')
    expect(shownChip(container, 'status')!.dataset.color).toBe('green')
  })

  it('blur no mesmo tick da escolha não cancela nem faz uma segunda chamada (guarda `closed`)', async () => {
    const { container } = render(view([STATUS]))
    await open(container, 'status')
    const input = inputOf(container)!
    const option = optionByText(container, 'done')
    // Um único act: o editor ainda está montado quando o blur chega, então só o `closed` o barra.
    act(() => {
      fireEvent.click(option)
      fireEvent.blur(input)
      fireEvent.focusOut(input)
    })
    await settle()
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toMatchObject({ value: 'done', expected: 'todo' })
    expect(editorOf(container)).toBeNull()
    expect(shownChip(container, 'status')!.textContent).toBe('done')
  })

  it('o SelectEditor sozinho: blur e Esc no mesmo tick da escolha não chamam onCancel (guarda `closed`)', async () => {
    // No bloco o cancelamento tardio é inofensivo (o pai já fechou); aqui ele é observável.
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    const { container } = render(
      <I18nProvider locale="pt-BR">
        <SelectEditor propKey="status" slug="my-vault" initial="todo" label="status" onCommit={onCommit} onCancel={onCancel} />
      </I18nProvider>,
    )
    await settle()
    const input = inputOf(container)!
    act(() => {
      fireEvent.click(optionByText(container, 'done'))
      fireEvent.blur(input)
      fireEvent.focusOut(input)
      fireEvent.keyDown(input, { key: 'Escape' })
    })
    await settle()
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('done')
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('Enter com opção ativa (setas) grava essa opção', async () => {
    const { container } = render(view([STATUS]))
    await open(container, 'status')
    press(container, 'ArrowDown')
    press(container, 'ArrowDown')
    press(container, 'ArrowDown')
    press(container, 'Enter')
    await settle()
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toMatchObject({ value: 'done', expected: 'todo' })
  })

  it('Enter com "DONE" digitado escolhe "done"', async () => {
    const { container } = render(view([STATUS]))
    await open(container, 'status')
    typeIn(container, 'DONE')
    press(container, 'Enter')
    await settle()
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toMatchObject({ value: 'done' })
  })

  it('Enter com "do" não pega a primeira opção: cria "do"', async () => {
    const { container } = render(view([STATUS]))
    await open(container, 'status')
    typeIn(container, 'do')
    press(container, 'Enter')
    await settle()
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toMatchObject({ value: 'do' })
  })

  it('"Criar novo" grava o texto novo', async () => {
    const { container } = render(view([STATUS]))
    await open(container, 'status')
    typeIn(container, 'novo')
    expect(optionTexts(container).at(-1)).toBe('Criar novo')
    fireEvent.click(optionByText(container, 'Criar novo'))
    await settle()
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toMatchObject({ value: 'novo', expected: 'todo' })
  })

  it('o valor atual não pode ser criado de novo: digitá-lo não oferece "Criar"', async () => {
    const { container } = render(view([STATUS]))
    await open(container, 'status')
    typeIn(container, 'todo')
    expect(optionTexts(container)).toEqual(['todo'])
  })

  it('o × grava null e a linha fica vazia', async () => {
    const { container } = render(view([STATUS]))
    await open(container, 'status')
    fireEvent.click(editorChips(container)[0].querySelector('button')!)
    await settle()
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toMatchObject({ key: 'status', value: null, expected: 'todo' })
    expect(editorOf(container)).toBeNull()
    expect(rowOf(container, 'status').querySelector('.vault-prop-empty')!.textContent).toBe('Vazio')
  })

  it('Esc e sair do editor sem escolher não chamam nada', async () => {
    const { container } = render(view([STATUS]))
    await open(container, 'status')
    fireEvent.keyDown(inputOf(container)!, { key: 'Escape' })
    await settle()
    expect(editorOf(container)).toBeNull()

    await open(container, 'status')
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    focusOn(outside)
    await settle()
    expect(editorOf(container)).toBeNull()
    expect(calls).toHaveLength(0)
    outside.remove()
  })

  it('alt-tab (janela sem foco) não fecha o editor', async () => {
    const { container } = render(view([STATUS]))
    await open(container, 'status')
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    fireEvent.blur(inputOf(container)!)
    await settle()
    expect(editorOf(container)).not.toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('Enter com o campo vazio, ou clicar no valor atual, fecha sem chamar', async () => {
    const { container } = render(view([STATUS]))
    await open(container, 'status')
    press(container, 'Enter')
    await settle()
    expect(editorOf(container)).toBeNull()

    await open(container, 'status')
    fireEvent.click(optionByText(container, 'todo'))
    await settle()
    expect(editorOf(container)).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('um texto longo demais no "Criar" não grava e mostra o alerta até o texto mudar', async () => {
    const { container } = render(view([STATUS]))
    await open(container, 'status')
    typeIn(container, 'x'.repeat(10001))
    fireEvent.click(optionsOf(container).at(-1)!)
    await settle()
    expect(calls).toHaveLength(0)
    expect(editorOf(container)).not.toBeNull()
    expect(editorOf(container)!.querySelector('[role="alert"]')!.textContent).toBe('O valor é grande demais.')
    typeIn(container, 'x')
    expect(editorOf(container)!.querySelector('[role="alert"]')).toBeNull()
  })

  it('409 mostra a linha que está no disco', async () => {
    const { container } = render(view([STATUS]))
    await open(container, 'status')
    fireEvent.click(optionByText(container, 'done'))
    await settle()
    await respond({ status: 409, body: { error: 'mudou', property: prop('status', 'doing') } })
    expect(shownChip(container, 'status')!.textContent).toBe('doing')
    expect(rowOf(container, 'status').querySelector('[role="alert"]')).not.toBeNull()
  })

  it('linha select vazia abre o editor sem chip', async () => {
    const { container } = render(view([prop('status', null)]))
    await open(container, 'status')
    expect(editorOf(container)).not.toBeNull()
    expect(editorChips(container)).toHaveLength(0)
    expect(optionTexts(container)).toEqual(SUGGESTIONS)
  })

  it('linha sem select continua com o ScalarEditor', async () => {
    const plain = toPageProperty('status', 'todo', PLAIN_CTX)
    const { container } = render(view([plain]))
    await open(container, 'status')
    expect(editorOf(container)).toBeNull()
    expect(rowOf(container, 'status').querySelector('input.vault-prop-input')).not.toBeNull()
    expect(inputOf(container)).toBeNull()
  })

  // Combobox próprio do SelectEditor (duplicado do ListEditor).
  describe('menu e sugestões', () => {
    const MANY = Array.from({ length: 60 }, (_, i) => 'v' + String(i).padStart(2, '0'))
    const moreRow = (el: HTMLElement) => el.querySelector<HTMLElement>('.vault-prop-menu li.is-more')

    it('com mais de 50 sugestões mostra 50 opções e a linha "mais", que as setas pulam', async () => {
      valuesReply = { status: 200, body: { values: MANY } }
      const { container } = render(view([STATUS]))
      await open(container, 'status')
      expect(optionsOf(container)).toHaveLength(50)
      expect(moreRow(container)!.textContent).toBe('Mais 10: digite para filtrar')

      const input = inputOf(container)!
      const activeId = () => input.getAttribute('aria-activedescendant')
      const optionIds = optionsOf(container).map(o => o.id)
      const moreId = moreRow(container)!.id

      // ArrowUp a partir de nada vai para a última opção real, nunca para a linha "mais"
      press(container, 'ArrowUp')
      expect(activeId()).toBe(optionIds[49])
      // ArrowDown depois da última volta à primeira
      press(container, 'ArrowDown')
      expect(activeId()).toBe(optionIds[0])
      // ArrowUp da primeira volta à última
      press(container, 'ArrowUp')
      expect(activeId()).toBe(optionIds[49])
      expect(moreRow(container)!.classList.contains('is-active')).toBe(false)
      expect(activeId()).not.toBe(moreId)
      expect(container.querySelectorAll('.vault-prop-menu .is-active')).toHaveLength(1)
      expect(document.getElementById(activeId()!)!.classList.contains('is-more')).toBe(false)
    })

    it('com a busca de sugestões falhando ainda dá para digitar e criar', async () => {
      valuesReply = { status: 500, body: { error: 'falhou' } }
      const { container } = render(view([STATUS]))
      await open(container, 'status')
      expect(editorOf(container)).not.toBeNull()
      typeIn(container, 'novo')
      expect(optionTexts(container)).toEqual(['Criar novo'])
      fireEvent.click(optionByText(container, 'Criar novo'))
      await settle()
      expect(calls).toHaveLength(1)
      expect(calls[0].body).toMatchObject({ key: 'status', value: 'novo', expected: 'todo' })
    })
  })
})
