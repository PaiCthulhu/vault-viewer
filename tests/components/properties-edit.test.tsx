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
import { ScalarEditor } from '@/components/viewer/PropertyEditors'
import type { PageProperty } from '@/builder/types'
import { toPageProperty, type PropertyRenderContext } from '@/builder/plugins/properties'
import { LinkResolver } from '@/builder/link-resolver'
import { EMPTY_PROPERTY_CONFIG } from '@/builder/property-types'

const EDIT: PropertiesEditContext = { slug: 'my-vault', pagePath: 'Notes/My Note' }

const resolver = new LinkResolver([{ absolutePath: '/v/Notes/Other.md', relativePath: 'Notes/Other', title: 'Other' }])
const CTX: PropertyRenderContext = {
  renderWikilinks: s => resolver.replaceWikilinksEscaped(s, 'my-vault'),
  resolveImage: p => '/vault-assets/my-vault/' + p,
  config: EMPTY_PROPERTY_CONFIG,
}
// A linha que o builder grava para esse valor.
const prop = (key: string, value: unknown): PageProperty => toPageProperty(key, value, CTX)

const STATUS = prop('status', 'todo')
const RATING = prop('rating', 3)
const DUE = prop('due', '2024-01-05')
const START = prop('start', '2024-01-05T08:00')
const DONE = prop('done', false)
const GENRES = prop('genres', ['RPG'])
const LOCKED: PageProperty = { key: 'source', type: 'text', value: 'x', html: 'x', locked: 'readonly' }
const MISMATCH: PageProperty = { key: 'rating', type: 'number', value: '12', html: '12', mismatch: true }

// Cópia nova com o mesmo conteúdo, como um router.refresh() entrega.
const fresh = (props: PageProperty[]): PageProperty[] => JSON.parse(JSON.stringify(props))

// `edit: null` monta o bloco sem `edit` (só leitura).
const view = (properties: PageProperty[], edit: PropertiesEditContext | null = EDIT) => (
  <I18nProvider locale="pt-BR">
    <PropertiesBlock properties={properties} edit={edit ?? undefined} />
  </I18nProvider>
)

// ─── fetch em stub: cada chamada fica pendente até o teste responder ─────────────
type Call = { url: string; method: string; body: Record<string, unknown> }
type Reply = { status: number; body: unknown }
let calls: Call[] = []
let pending: Array<(r: Reply) => void> = []

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method), body: JSON.parse(String(init.body)) })
    return new Promise<Response>(resolve => {
      pending.push(({ status, body }) =>
        resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })))
    })
  }))
}

// Responde a chamada pendente mais antiga e espera a linha reagir.
async function respond(reply: Reply) {
  const next = pending.shift()
  if (!next) throw new Error('nenhuma chamada pendente')
  await act(async () => {
    next(reply)
    for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0))
  })
}
const ok = (property: PageProperty): Reply => ({ status: 200, body: { property } })

// ─── consultas e ações na tela ───────────────────────────────────────────────────
const rowOf = (el: HTMLElement, key: string) => {
  const row = Array.from(el.querySelectorAll<HTMLElement>('.vault-prop'))
    .find(r => r.querySelector('.vault-prop-key')?.textContent === key)
  if (!row) throw new Error('sem a linha ' + key)
  return row
}
const valueText = (el: HTMLElement, key: string) => rowOf(el, key).querySelector('.vault-prop-val')!.textContent
const editableOf = (el: HTMLElement, key: string) =>
  rowOf(el, key).querySelector<HTMLElement>('.vault-prop-editable')!
const inputOf = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input.vault-prop-input')
const alertOf = (el: HTMLElement, key: string) => rowOf(el, key).querySelector('.vault-prop-error[role="alert"]')
const confirmOf = (el: HTMLElement) => el.querySelector<HTMLElement>('.vault-prop-confirm')
const button = (el: HTMLElement, label: string) =>
  Array.from(el.querySelectorAll('button')).find(b => b.textContent === label)!

const open = (el: HTMLElement, key: string) => { fireEvent.click(editableOf(el, key)) }
const typeIn = (el: HTMLElement, text: string) => { fireEvent.change(inputOf(el)!, { target: { value: text } }) }
const press = (el: HTMLElement, key: string) => { fireEvent.keyDown(inputOf(el)!, { key }) }
// blur de verdade: o jsdom tira o foco do input e dispara blur/focusout, como o navegador.
const blurInput = (el: HTMLElement) => { act(() => { inputOf(el)!.blur() }) }

// O Chrome dispara blur no input com foco quando ele sai do DOM; o jsdom não. Aqui o
// removeChild tira o foco antes de remover, como o navegador.
function blurOnRemove() {
  const removeChild = Node.prototype.removeChild
  return vi.spyOn(Node.prototype, 'removeChild').mockImplementation(function (this: Node, child: Node) {
    const active = document.activeElement
    if (active instanceof HTMLElement && child.contains(active)) active.blur()
    return removeChild.call(this, child)
  } as typeof Node.prototype.removeChild)
}

// Número ou data que o navegador não entende: `value` vazio e `validity.badInput`.
function markBadInput(input: HTMLInputElement) {
  Object.defineProperty(input, 'value', { configurable: true, get: () => '' })
  Object.defineProperty(input, 'validity', { configurable: true, get: () => ({ badInput: true }) })
}

beforeEach(() => {
  calls = []
  pending = []
  stubFetch()
  // O jsdom responde false a document.hasFocus() depois de um blur; no navegador, um blur por
  // clique em outro lugar acontece com a janela em foco.
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PropertiesBlock com edição: escalares', () => {
  it('controles por linha: a não travada é editável e a travada não', () => {
    const { container } = render(view([STATUS, LOCKED]))
    const editable = editableOf(container, 'status')
    expect(editable.getAttribute('role')).toBe('button')
    expect(editable.getAttribute('tabindex')).toBe('0')
    // o nome acessível leva o valor que está na tela
    expect(editable.getAttribute('aria-label')).toBe('Editar status: todo')
    expect(editable.classList.contains('vault-prop-val')).toBe(true)
    expect(editable.textContent).toBe('todo')
    open(container, 'status')
    expect(inputOf(container)!.getAttribute('aria-label')).toBe('Editar status')
    press(container, 'Escape')

    const locked = rowOf(container, 'source')
    expect(locked.querySelector('.vault-prop-editable')).toBeNull()
    expect(locked.querySelector('[role="button"], [tabindex]')).toBeNull()
    expect(locked.querySelector('.vault-prop-lock')).not.toBeNull()
    fireEvent.click(locked.querySelector('.vault-prop-val')!)
    expect(inputOf(container)).toBeNull()
  })

  it('nome acessível: o texto visível do valor, com as entidades decodificadas, ou "Vazio"', () => {
    const quoted = prop('quote', 'a < b & "c"')
    expect(quoted.html).toContain('&lt;')
    const empty = prop('note', '')
    const related = prop('related', '[[Notes/Other]]')
    const { container } = render(view([quoted, empty, related]))
    expect(editableOf(container, 'quote').getAttribute('aria-label')).toBe('Editar quote: a < b & "c"')
    expect(editableOf(container, 'note').getAttribute('aria-label')).toBe('Editar note: Vazio')
    expect(editableOf(container, 'related').getAttribute('aria-label'))
      .toBe('Editar related: ' + editableOf(container, 'related').textContent)
  })

  it('texto com quebra de linha fica sem controle: o input de uma linha o achataria', () => {
    const { container } = render(view([prop('summary', 'line one\nline two'), prop('sep', 'a b')]))
    for (const key of ['summary', 'sep']) {
      const row = rowOf(container, key)
      expect(row.querySelector('.vault-prop-editable, [role="button"], [tabindex], input, button')).toBeNull()
      fireEvent.click(row.querySelector('.vault-prop-val')!)
    }
    expect(inputOf(container)).toBeNull()
  })

  it('texto com Enter: PATCH, "salvando" e depois o HTML da resposta', async () => {
    const { container } = render(view([STATUS]))
    open(container, 'status')
    const input = inputOf(container)!
    expect(input.type).toBe('text')
    expect(input.value).toBe('todo')
    expect(document.activeElement).toBe(input)
    expect(rowOf(container, 'status').classList.contains('is-editing')).toBe(true)

    typeIn(container, 'done')
    press(container, 'Enter')

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/api/vault/my-vault/properties')
    expect(calls[0].method).toBe('PATCH')
    expect(calls[0].body).toEqual({ path: 'Notes/My Note', key: 'status', value: 'done', expected: 'todo' })
    expect(Object.hasOwn(calls[0].body, 'confirm')).toBe(false)

    const row = rowOf(container, 'status')
    expect(inputOf(container)).toBeNull()
    expect(row.classList.contains('is-editing')).toBe(false)
    expect(row.classList.contains('is-saving')).toBe(true)
    expect(row.getAttribute('aria-busy')).toBe('true')
    expect(valueText(container, 'status')).toBe('done')
    expect(row.querySelector('.vault-prop-saving')!.textContent).toBe('Salvando…')

    await respond(ok({ key: 'status', type: 'text', value: 'done', html: '&lt;b&gt;x&lt;/b&gt;' }))

    const after = rowOf(container, 'status')
    expect(valueText(container, 'status')).toBe('<b>x</b>')
    expect(after.querySelector('b')).toBeNull()
    expect(after.querySelector('.vault-prop-saving')).toBeNull()
    expect(after.classList.contains('is-saving')).toBe(false)
    expect(after.hasAttribute('aria-busy')).toBe(false)
  })

  it('durante o salvamento a linha não abre editor', () => {
    const { container } = render(view([STATUS]))
    open(container, 'status')
    typeIn(container, 'done')
    press(container, 'Enter')
    open(container, 'status')
    expect(inputOf(container)).toBeNull()
    fireEvent.keyDown(editableOf(container, 'status'), { key: 'Enter' })
    expect(inputOf(container)).toBeNull()
  })

  it('Esc não grava e mostra o valor de antes', () => {
    const { container } = render(view([STATUS]))
    open(container, 'status')
    typeIn(container, 'done')
    press(container, 'Escape')
    expect(calls).toHaveLength(0)
    expect(inputOf(container)).toBeNull()
    expect(valueText(container, 'status')).toBe('todo')
  })

  it('Enter seguido do blur que o navegador dispara ao tirar o input: um PATCH só', () => {
    blurOnRemove()
    const { container } = render(view([STATUS]))
    open(container, 'status')
    typeIn(container, 'done')
    press(container, 'Enter')
    expect(inputOf(container)).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it('Esc seguido do blur que o navegador dispara ao tirar o input: nenhum PATCH', () => {
    blurOnRemove()
    const { container } = render(view([STATUS]))
    open(container, 'status')
    typeIn(container, 'done')
    press(container, 'Escape')
    expect(inputOf(container)).toBeNull()
    expect(calls).toHaveLength(0)
    expect(valueText(container, 'status')).toBe('todo')
  })

  // O React 19 não entrega ao onBlur o blur de um input que ele mesmo está tirando da tela
  // (o caso acima). Aqui o blur chega antes do novo render, com o input ainda montado: é a
  // ref "fechado" do ScalarEditor que segura a segunda chamada.
  it('Enter ou Esc com um blur antes do novo render: um PATCH no Enter, nenhum no Esc', () => {
    const { container } = render(view([STATUS, RATING]))
    open(container, 'status')
    typeIn(container, 'done')
    act(() => {
      fireEvent.keyDown(inputOf(container)!, { key: 'Enter' })
      inputOf(container)!.blur()
    })
    expect(inputOf(container)).toBeNull()
    expect(calls).toHaveLength(1)

    open(container, 'rating')
    typeIn(container, '7')
    act(() => {
      fireEvent.keyDown(inputOf(container)!, { key: 'Escape' })
      inputOf(container)!.blur()
    })
    expect(inputOf(container)).toBeNull()
    expect(calls).toHaveLength(1)
    expect(valueText(container, 'rating')).toBe('3')
  })

  // Alt-tab ou troca de aba tiram o foco do input sem que a pessoa tenha terminado: o blur
  // com a janela sem foco não grava nem fecha.
  it('blur causado pela janela perder o foco mantém o editor aberto e não grava', () => {
    const { container } = render(view([STATUS]))
    open(container, 'status')
    typeIn(container, 'do')
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    fireEvent.blur(inputOf(container)!)
    expect(calls).toHaveLength(0)
    expect(inputOf(container)).not.toBeNull()
    expect(inputOf(container)!.value).toBe('do')

    // a janela voltou: o próximo blur de verdade decide
    typeIn(container, 'done')
    focus.mockReturnValue(true)
    fireEvent.blur(inputOf(container)!)
    expect(calls).toHaveLength(1)
    expect(calls[0].body.value).toBe('done')
  })

  it('blur salva', () => {
    const { container } = render(view([STATUS]))
    open(container, 'status')
    typeIn(container, 'done')
    blurInput(container)
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toEqual({ path: 'Notes/My Note', key: 'status', value: 'done', expected: 'todo' })
    expect(valueText(container, 'status')).toBe('done')
  })

  it('abrir e sair sem mudar não chama a API (blur, Enter e só espaços em volta)', () => {
    const { container } = render(view([STATUS, RATING]))
    open(container, 'status')
    blurInput(container)
    open(container, 'status')
    press(container, 'Enter')
    open(container, 'status')
    typeIn(container, '  todo  ')
    press(container, 'Enter')
    open(container, 'rating')
    typeIn(container, '3.0')
    press(container, 'Enter')
    expect(calls).toHaveLength(0)
    expect(inputOf(container)).toBeNull()
    expect(container.querySelector('.vault-prop-saving')).toBeNull()
  })

  it('valor com espaços em volta: abrir e sair sem mexer não grava (nem por blur, nem por Enter)', () => {
    const padded = prop('status', ' todo ')
    expect(padded.value).toBe(' todo ') // o builder guarda o texto cru
    const { container } = render(view([padded]))
    open(container, 'status')
    expect(inputOf(container)!.value).toBe(' todo ')
    blurInput(container)
    open(container, 'status')
    press(container, 'Enter')
    expect(calls).toHaveLength(0)
    expect(alertOf(container, 'status')).toBeNull()
    expect(inputOf(container)).toBeNull()
  })

  it('mismatch: abrir e sair por blur sem mexer não confirma nem grava; o Enter confirma', () => {
    const { container } = render(view([MISMATCH]))
    open(container, 'rating')
    blurInput(container)
    expect(confirmOf(container)).toBeNull()
    expect(calls).toHaveLength(0)
    expect(rowOf(container, 'rating').classList.contains('is-editing')).toBe(false)

    open(container, 'rating')
    press(container, 'Enter') // Enter é a intenção de converter, mesmo sem mudar o texto
    expect(confirmOf(container)).not.toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('número: manda number e, esvaziado, null', async () => {
    const { container } = render(view([RATING]))
    open(container, 'rating')
    const input = inputOf(container)!
    expect(input.type).toBe('number')
    // sem inputmode: o teclado "decimal" do iOS não tem a tecla de menos
    expect(input.getAttribute('inputmode')).toBeNull()
    expect(input.getAttribute('step')).toBe('any')
    expect(input.value).toBe('3')
    typeIn(container, '12.5')
    press(container, 'Enter')
    expect(calls[0].body.value).toBe(12.5)
    expect(typeof calls[0].body.value).toBe('number')
    expect(calls[0].body.expected).toBe(3)
    await respond(ok({ key: 'rating', type: 'number', value: 12.5, html: '12.5' }))

    open(container, 'rating')
    typeIn(container, '')
    press(container, 'Enter')
    expect(calls[1].body).toEqual({ path: 'Notes/My Note', key: 'rating', value: null, expected: 12.5 })
  })

  it('data e data-hora: inputs nativos e os valores no formato da API', () => {
    const { container } = render(view([DUE, START]))
    expect(DUE.type).toBe('date')
    expect(START.type).toBe('datetime')

    open(container, 'due')
    expect(inputOf(container)!.type).toBe('date')
    expect(inputOf(container)!.value).toBe('2024-01-05')
    typeIn(container, '2024-03-01')
    press(container, 'Enter')

    open(container, 'start')
    expect(inputOf(container)!.type).toBe('datetime-local')
    expect(inputOf(container)!.value).toBe('2024-01-05T08:00')
    typeIn(container, '2024-03-01T09:30')
    press(container, 'Enter')

    expect(calls.map(c => [c.body.key, c.body.value])).toEqual([['due', '2024-03-01'], ['start', '2024-03-01T09:30']])
  })

  it('entrada que o navegador não entende mostra o erro do tipo, sem gravar nem limpar', () => {
    const { container } = render(view([RATING, DUE]))
    open(container, 'rating')
    markBadInput(inputOf(container)!)
    press(container, 'Enter')
    expect(inputOf(container)).toBeNull()
    expect(alertOf(container, 'rating')!.textContent).toBe('Digite um número.')
    expect(valueText(container, 'rating')).toBe('3')

    open(container, 'due')
    expect(alertOf(container, 'rating')).toBeNull() // abrir um editor apaga o aviso
    markBadInput(inputOf(container)!)
    blurInput(container)
    expect(alertOf(container, 'due')!.textContent).toBe('Digite uma data válida.')
    expect(calls).toHaveLength(0)
  })

  it('texto grande demais: aviso, sem gravar', () => {
    const { container } = render(view([STATUS]))
    open(container, 'status')
    const input = inputOf(container)!
    // sem maxLength: ele cortaria a colagem em silêncio e o aviso nunca apareceria
    expect(input.maxLength).toBe(-1)
    typeIn(container, 'a'.repeat(10001))
    expect(input.value).toHaveLength(10001)
    press(container, 'Enter')
    expect(calls).toHaveLength(0)
    expect(alertOf(container, 'status')!.textContent).toBe('O valor é grande demais.')
    expect(valueText(container, 'status')).toBe('todo')
  })

  it('checkbox: habilitado, manda o booleano', async () => {
    const { container } = render(view([DONE]))
    const cb = rowOf(container, 'done').querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(cb.classList.contains('vault-prop-checkbox')).toBe(true)
    expect(cb.disabled).toBe(false)
    expect(cb.checked).toBe(false)
    expect(cb.getAttribute('aria-label')).toBe('done')
    expect(rowOf(container, 'done').querySelectorAll('input')).toHaveLength(1) // o do builder não fica junto

    fireEvent.click(cb)
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toEqual({ path: 'Notes/My Note', key: 'done', value: true, expected: false })
    const saving = rowOf(container, 'done').querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(saving.checked).toBe(true)
    // aria-disabled e não disabled: o foco de quem marcou pelo teclado fica no checkbox
    expect(saving.disabled).toBe(false)
    expect(saving.getAttribute('aria-disabled')).toBe('true')
    saving.focus()
    fireEvent.click(saving) // durante o salvamento o clique não grava, e o checkbox não muda
    expect(calls).toHaveLength(1)
    expect(saving.checked).toBe(true)
    expect(document.activeElement).toBe(saving)

    await respond(ok({ key: 'done', type: 'checkbox', value: true, html: '<input type="checkbox" class="vault-prop-checkbox" checked disabled>' }))
    const after = rowOf(container, 'done').querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(after.checked).toBe(true)
    expect(after.disabled).toBe(false)
    expect(after.getAttribute('aria-disabled')).toBeNull()
    expect(document.activeElement).toBe(after)
  })

  it('texto com link: abre com o texto cru, e o clique no link segue para fora sem abrir o editor', () => {
    const related = prop('related', '[[Notes/Other]]')
    expect(related.html).toContain('<a ')
    const outer = vi.fn()
    // Como o ContentPanel: pega o clique no link e navega pelo router (preventDefault).
    const { container } = render(
      <div onClick={e => { e.preventDefault(); outer((e.target as Element).tagName) }}>{view([related])}</div>,
    )
    const a = editableOf(container, 'related').querySelector('a')!
    fireEvent.click(a)
    expect(inputOf(container)).toBeNull()
    expect(outer).toHaveBeenCalledWith('A') // o clique continua subindo, até o ContentPanel
    fireEvent.keyDown(a, { key: 'Enter' }) // Enter no link é do link
    expect(inputOf(container)).toBeNull()

    open(container, 'related')
    expect(inputOf(container)!.value).toBe('[[Notes/Other]]')
  })

  it('Enter e Espaço com foco no valor abrem o editor', () => {
    const { container } = render(view([STATUS]))
    fireEvent.keyDown(editableOf(container, 'status'), { key: 'Enter' })
    expect(inputOf(container)).not.toBeNull()
    press(container, 'Escape')
    fireEvent.keyDown(editableOf(container, 'status'), { key: ' ' })
    expect(inputOf(container)).not.toBeNull()
  })

  it('mismatch: confirma antes de gravar e manda confirm: true', () => {
    const { container } = render(view([MISMATCH]))
    open(container, 'rating')
    expect(inputOf(container)!.value).toBe('12')
    press(container, 'Enter')
    expect(calls).toHaveLength(0)
    const confirm = confirmOf(container)!
    expect(confirm.textContent).toContain(
      'O valor atual não é do tipo desta propriedade (Número) e vai ser substituído.',
    )
    expect(rowOf(container, 'rating').classList.contains('is-editing')).toBe(true)
    // o valor atual continua à mostra
    expect(rowOf(container, 'rating').querySelector('.vault-prop-current')!.textContent).toBe('12')

    fireEvent.click(button(confirm, 'Substituir'))
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toEqual({ path: 'Notes/My Note', key: 'rating', value: 12, expected: '12', confirm: true })
    expect(confirmOf(container)).toBeNull()
  })

  it('mismatch: Cancelar não grava, fecha a confirmação e mostra o valor de antes', () => {
    const { container } = render(view([MISMATCH]))
    open(container, 'rating')
    press(container, 'Enter')
    fireEvent.click(button(confirmOf(container)!, 'Cancelar'))
    expect(calls).toHaveLength(0)
    expect(confirmOf(container)).toBeNull()
    expect(rowOf(container, 'rating').classList.contains('is-editing')).toBe(false)
    expect(valueText(container, 'rating')).toBe('12')
  })

  it('mismatch: Esc com foco num botão cancela', () => {
    const { container } = render(view([MISMATCH]))
    open(container, 'rating')
    press(container, 'Enter')
    fireEvent.keyDown(button(confirmOf(container)!, 'Substituir'), { key: 'Escape' })
    expect(confirmOf(container)).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('checkbox com mismatch: confirma, e Cancelar o deixa desmarcado', () => {
    const row: PageProperty = { key: 'done', type: 'checkbox', value: 'yes', html: 'yes', mismatch: true }
    const { container } = render(view([row]))
    const cb = () => rowOf(container, 'done').querySelector<HTMLInputElement>('input.vault-prop-checkbox')!
    expect(cb().checked).toBe(false)
    expect(rowOf(container, 'done').querySelector('.vault-prop-current')!.textContent).toBe('yes')

    fireEvent.click(cb())
    expect(calls).toHaveLength(0)
    expect(confirmOf(container)!.textContent).toContain('(Caixa de seleção)')
    expect(rowOf(container, 'done').querySelector('.vault-prop-current')!.textContent).toBe('yes')

    fireEvent.click(button(confirmOf(container)!, 'Cancelar'))
    expect(confirmOf(container)).toBeNull()
    expect(cb().checked).toBe(false)
    expect(calls).toHaveLength(0)

    fireEvent.click(cb())
    fireEvent.click(button(confirmOf(container)!, 'Substituir'))
    expect(calls[0].body).toEqual({ path: 'Notes/My Note', key: 'done', value: true, expected: 'yes', confirm: true })
  })

  it('409: mostra o valor atual com a mensagem, e o próximo editor parte dele', async () => {
    const { container } = render(view([STATUS]))
    open(container, 'status')
    typeIn(container, 'done')
    press(container, 'Enter')
    await respond({
      status: 409,
      body: { error: 'conflito', property: { key: 'status', type: 'text', value: 'other', html: 'other' } },
    })
    expect(valueText(container, 'status')).toBe('other')
    expect(alertOf(container, 'status')!.textContent).toBe(
      'Este valor foi mudado em outro lugar. O valor atual está na tela.',
    )

    open(container, 'status')
    expect(alertOf(container, 'status')).toBeNull()
    expect(inputOf(container)!.value).toBe('other')
    typeIn(container, 'again')
    press(container, 'Enter')
    expect(calls[1].body).toEqual({ path: 'Notes/My Note', key: 'status', value: 'again', expected: 'other' })
  })

  it('500: mensagem genérica e volta ao valor de antes', async () => {
    const { container } = render(view([STATUS]))
    open(container, 'status')
    typeIn(container, 'done')
    press(container, 'Enter')
    await respond({ status: 500, body: { error: 'falhou' } })
    expect(valueText(container, 'status')).toBe('todo')
    expect(alertOf(container, 'status')!.textContent).toBe('Não deu certo. Tente de novo.')
    expect(rowOf(container, 'status').classList.contains('is-saving')).toBe(false)
  })

  it('400 de mudança de tipo: a mensagem depende do que foi mandado, e a linha continua editável', async () => {
    const TYPE_CHANGE = { status: 400, body: { error: 'O valor mudaria o tipo da propriedade' } }
    const { container } = render(view([RATING, STATUS]))

    open(container, 'rating')
    typeIn(container, '')
    press(container, 'Enter')
    expect(calls[0].body.value).toBeNull()
    await respond(TYPE_CHANGE)
    expect(alertOf(container, 'rating')!.textContent).toBe('Limpar mudaria o tipo da propriedade')
    expect(valueText(container, 'rating')).toBe('3')
    open(container, 'rating')
    expect(inputOf(container)!.value).toBe('3')
    press(container, 'Escape')

    open(container, 'status')
    typeIn(container, '2024-01-02')
    press(container, 'Enter')
    expect(calls[1].body.value).toBe('2024-01-02')
    await respond(TYPE_CHANGE)
    expect(alertOf(container, 'status')!.textContent).toBe('Esse valor mudaria o tipo da propriedade')
    expect(valueText(container, 'status')).toBe('todo')
    open(container, 'status')
    expect(inputOf(container)!.value).toBe('todo')
  })

  it('refresh com o valor antigo, durante o salvamento e depois da resposta, mantém o valor novo sem duplicar a linha', async () => {
    const props = [STATUS, RATING]
    const { container, rerender } = render(view(props))
    const count = container.querySelectorAll('.vault-prop').length
    open(container, 'status')
    typeIn(container, 'done')
    press(container, 'Enter')

    rerender(view(fresh(props)))
    expect(valueText(container, 'status')).toBe('done')
    expect(container.querySelectorAll('.vault-prop')).toHaveLength(count)
    expect(rowOf(container, 'status').querySelector('.vault-prop-saving')).not.toBeNull()

    await respond(ok({ key: 'status', type: 'text', value: 'done', html: 'done' }))
    rerender(view(fresh(props)))
    expect(valueText(container, 'status')).toBe('done')
    expect(container.querySelectorAll('.vault-prop')).toHaveLength(count)
  })

  it('refresh com o valor novo tira o local, e o servidor volta a valer', async () => {
    const { container, rerender } = render(view([STATUS]))
    open(container, 'status')
    typeIn(container, 'done')
    press(container, 'Enter')
    await respond(ok({ key: 'status', type: 'text', value: 'done', html: 'done' }))

    rerender(view([{ ...STATUS, value: 'done', html: 'done' }]))
    expect(valueText(container, 'status')).toBe('done')
    rerender(view([{ ...STATUS, value: 'other', html: 'other' }]))
    expect(valueText(container, 'status')).toBe('other')
    // o local já foi embora: mesmo o valor de antes, vindo do servidor, aparece
    rerender(view(fresh([STATUS])))
    expect(valueText(container, 'status')).toBe('todo')
  })

  // O build do primeiro save pode chegar depois do segundo: o valor intermediário não pode
  // aparecer, e a entrada local só sai quando o servidor mostra o valor final.
  it('checkbox marcado e desmarcado antes do build: o refresh com o valor intermediário não o traz de volta', async () => {
    const TRUE = prop('done', true)
    const { container, rerender } = render(view([DONE]))
    const box = () => rowOf(container, 'done').querySelector<HTMLInputElement>('input[type="checkbox"]')!
    fireEvent.click(box())
    await respond(ok(TRUE))
    fireEvent.click(box())
    await respond(ok(DONE))
    expect(calls.map(c => c.body.value)).toEqual([true, false])
    expect(box().checked).toBe(false)

    rerender(view([TRUE]))
    expect(box().checked).toBe(false)
    rerender(view([DONE]))
    expect(box().checked).toBe(false)
    // o local já foi embora: um valor de outra pessoa aparece
    rerender(view([TRUE]))
    expect(box().checked).toBe(true)
  })

  it('texto "todo" para "b" e de volta a "todo" antes do build: o refresh com "b" não o traz de volta', async () => {
    const B = { ...STATUS, value: 'b', html: 'b' }
    const { container, rerender } = render(view([STATUS]))
    open(container, 'status')
    typeIn(container, 'b')
    press(container, 'Enter')
    await respond(ok(B))
    open(container, 'status')
    typeIn(container, 'todo')
    press(container, 'Enter')
    await respond(ok(STATUS))
    expect(valueText(container, 'status')).toBe('todo')

    rerender(view([B]))
    expect(valueText(container, 'status')).toBe('todo')
    rerender(view([STATUS]))
    expect(valueText(container, 'status')).toBe('todo')
    rerender(view([B]))
    expect(valueText(container, 'status')).toBe('b')
  })

  it('refresh com o editor aberto mantém o input e o texto digitado', () => {
    const { container, rerender } = render(view([STATUS, RATING]))
    open(container, 'status')
    typeIn(container, 'meio digitado')
    const input = inputOf(container)!
    rerender(view(fresh([STATUS, RATING])))
    expect(inputOf(container)).toBe(input)
    expect(input.value).toBe('meio digitado')
    expect(document.activeElement).toBe(input)
    expect(rowOf(container, 'status').classList.contains('is-editing')).toBe(true)
  })

  it('um editor por vez: abrir outro troca o editor e cancela a confirmação pendente', () => {
    const { container } = render(view([STATUS, RATING]))
    open(container, 'status')
    open(container, 'rating')
    expect(container.querySelectorAll('.vault-prop-input')).toHaveLength(1)
    expect(inputOf(container)!.type).toBe('number')
    const editing = container.querySelectorAll('.vault-prop.is-editing')
    expect(editing).toHaveLength(1)
    expect(editing[0]).toBe(rowOf(container, 'rating'))
    cleanup()

    const other = render(view([MISMATCH, STATUS]))
    open(other.container, 'rating')
    press(other.container, 'Enter')
    expect(confirmOf(other.container)).not.toBeNull()
    open(other.container, 'status')
    expect(confirmOf(other.container)).toBeNull()
    expect(other.container.querySelectorAll('.vault-prop.is-editing')).toHaveLength(1)
    expect(calls).toHaveLength(0)
  })

  it('chaves com nome de Object.prototype editam e gravam normalmente', async () => {
    const props = [prop('constructor', 'a'), prop('__proto__', 'b')]
    const { container, rerender } = render(view(props))
    for (const [key, value] of [['constructor', 'x'], ['__proto__', 'y']]) {
      open(container, key)
      typeIn(container, value)
      press(container, 'Enter')
      expect(calls.at(-1)!.body).toEqual({ path: 'Notes/My Note', key, value, expected: key === 'constructor' ? 'a' : 'b' })
      await respond(ok({ key, type: 'text', value, html: value }))
      expect(valueText(container, key)).toBe(value)
    }
    rerender(view(fresh(props)))
    expect(valueText(container, 'constructor')).toBe('x')
    expect(valueText(container, '__proto__')).toBe('y')
    expect(container.querySelectorAll('.vault-prop')).toHaveLength(2)
  })

  it('foco: fechar pelo teclado devolve o foco ao valor; a confirmação recebe o foco; o blur não o puxa', () => {
    const { container } = render(view([STATUS, MISMATCH]))
    open(container, 'status')
    press(container, 'Escape')
    expect(document.activeElement).toBe(editableOf(container, 'status'))

    open(container, 'status')
    typeIn(container, 'done')
    press(container, 'Enter')
    expect(document.activeElement).toBe(editableOf(container, 'status'))

    open(container, 'rating')
    press(container, 'Enter')
    expect(document.activeElement).toBe(button(confirmOf(container)!, 'Cancelar'))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(document.activeElement).toBe(editableOf(container, 'rating'))

    open(container, 'rating')
    typeIn(container, '15')
    blurInput(container) // mudou e saiu clicando em outro lugar: a confirmação abre sem puxar o foco
    expect(confirmOf(container)).not.toBeNull()
    expect(document.activeElement).toBe(document.body)
  })
})

describe('PropertiesBlock sem edição', () => {
  it('nenhum controle de edição no bloco', () => {
    const SCORE = { ...MISMATCH, key: 'score' }
    const { container } = render(view([STATUS, RATING, DUE, START, DONE, GENRES, LOCKED, SCORE], null))
    const block = container.querySelector('.vault-properties')!
    expect(block.querySelector('input:not([disabled]), button, [role="button"], [tabindex]')).toBeNull()
    expect(block.querySelector('.vault-prop-editable, .vault-prop-val-wrap')).toBeNull()
    // o checkbox do builder continua lá, desabilitado
    expect(rowOf(container, 'done').querySelector('input.vault-prop-checkbox[disabled]')).not.toBeNull()
    fireEvent.click(rowOf(container, 'status').querySelector('.vault-prop-val')!)
    expect(inputOf(container)).toBeNull()
  })
})

describe('ScalarEditor', () => {
  const editor = (type: 'text' | 'number' | 'date' | 'datetime', initial = 'todo') => {
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    const r = render(<ScalarEditor type={type} initial={initial} label="status" onCommit={onCommit} onCancel={onCancel} />)
    return { ...r, onCommit, onCancel, input: r.container.querySelector<HTMLInputElement>('input.vault-prop-input')! }
  }

  it('o input de cada tipo', () => {
    const text = editor('text')
    expect(text.input.type).toBe('text')
    expect(text.input.maxLength).toBe(-1)
    expect(text.input.getAttribute('aria-label')).toBe('status')
    expect(document.activeElement).toBe(text.input)
    cleanup()
    const num = editor('number', '3')
    expect(num.input.type).toBe('number')
    expect(num.input.getAttribute('inputmode')).toBeNull()
    expect(num.input.getAttribute('step')).toBe('any')
    cleanup()
    expect(editor('date', '2024-01-05').input.type).toBe('date')
    cleanup()
    expect(editor('datetime', '2024-01-05T08:00').input.type).toBe('datetime-local')
  })

  it('Enter seguido de blur chama onCommit uma vez só', () => {
    const { input, onCommit, onCancel } = editor('text')
    fireEvent.change(input, { target: { value: 'done' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    act(() => { input.blur() })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('done', { unchanged: false })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('Esc seguido de blur chama só onCancel, uma vez', () => {
    const { input, onCommit, onCancel } = editor('text')
    fireEvent.change(input, { target: { value: 'done' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    act(() => { input.blur() })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('blur sozinho chama onCommit com o texto do campo', () => {
    const { input, onCommit } = editor('text')
    fireEvent.change(input, { target: { value: 'done' } })
    act(() => { input.blur() })
    expect(onCommit).toHaveBeenCalledWith('done', { unchanged: false })
  })

  it('sem mudança: o blur cancela e o Enter avisa que não mudou', () => {
    const blurred = editor('text', ' todo ')
    act(() => { blurred.input.blur() })
    expect(blurred.onCancel).toHaveBeenCalledTimes(1)
    expect(blurred.onCommit).not.toHaveBeenCalled()
    cleanup()

    const entered = editor('text', ' todo ')
    fireEvent.keyDown(entered.input, { key: 'Enter' })
    expect(entered.onCommit).toHaveBeenCalledTimes(1)
    expect(entered.onCommit).toHaveBeenCalledWith(' todo ', { unchanged: true })
    expect(entered.onCancel).not.toHaveBeenCalled()
  })

  it('mudar e voltar ao texto de antes conta como sem mudança', () => {
    const { input, onCommit, onCancel } = editor('number', '3')
    fireEvent.change(input, { target: { value: '4' } })
    fireEvent.change(input, { target: { value: '3' } })
    act(() => { input.blur() })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('a comparação é com o valor que o input mostrou, já sanitizado pelo navegador', () => {
    // O input de texto tira as quebras do valor inicial: sem mexer, é "sem mudança".
    const { input, onCommit, onCancel } = editor('text', 'line one\nline two')
    expect(input.value).toBe('line oneline two')
    act(() => { input.blur() })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })
})
