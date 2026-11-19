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
import type { PageProperty, RelationCandidate, RelationEntry } from '@/builder/types'
import { toPageProperty, type PropertyRenderContext } from '@/builder/plugins/properties'
import { LinkResolver } from '@/builder/link-resolver'
import { EMPTY_PROPERTY_CONFIG } from '@/builder/property-types'

const EDIT: PropertiesEditContext = { slug: 'my-vault', pagePath: 'Notes/My Note' }

const resolver = new LinkResolver([{ absolutePath: '/v/Notes/Other.md', relativePath: 'Notes/Other', title: 'Other' }])
const CTX: PropertyRenderContext = {
  renderWikilinks: s => resolver.replaceWikilinksEscaped(s, 'my-vault'),
  resolveImage: p => '/vault-assets/my-vault/' + p,
  config: { ...EMPTY_PROPERTY_CONFIG, relation: new Map([['related', 'Games']]) },
}
const relationRow = (value: unknown): PageProperty => toPageProperty('related', value, CTX)

const cand = (link: string, label: string, path: string): RelationCandidate => ({ link, label, path })
const BASE: RelationCandidate[] = [
  cand('[[Alpha]]', 'Alpha', 'Games/Alpha'),
  cand('[[Beta]]', 'Beta', 'Games/Beta'),
  cand('[[Games/Sub/Delta]]', 'Delta', 'Games/Sub/Delta'),
]

const view = (properties: PageProperty[]) => (
  <I18nProvider locale="pt-BR">
    <PropertiesBlock properties={properties} edit={EDIT} />
  </I18nProvider>
)

type Call = { url: string; method: string; body: Record<string, unknown> }
type Reply = { status: number; body: unknown }
let calls: Call[] = []
let valuesReply: Reply = { status: 200, body: { values: [] } }

const response = ({ status, body }: Reply) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function setRelation(candidates: RelationCandidate[], resolved: Record<string, string> = {}) {
  const relation: RelationEntry = { candidates, resolved }
  valuesReply = { status: 200, body: { values: candidates.map(c => c.link), relation } }
}

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
    if (url.includes('/property-values?key=')) return Promise.resolve(response(valuesReply))
    calls.push({ url, method: String(init.method), body: JSON.parse(String(init.body)) })
    return new Promise<Response>(() => {})
  }))
}

const settle = () => act(async () => {
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0))
})

const rowOf = (el: HTMLElement) => el.querySelector<HTMLElement>('.vault-prop')!
const editorOf = (el: HTMLElement) => el.querySelector<HTMLElement>('.vault-prop-multiselect')!
const inputOf = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input.vault-prop-list-input')!
const optionsOf = (el: HTMLElement) =>
  Array.from(el.querySelectorAll<HTMLElement>('.vault-prop-menu li[role="option"]:not([aria-disabled])'))
const optionTexts = (el: HTMLElement) => optionsOf(el).map(o => o.textContent)
// Os itens escolhidos, chip ou título de nota: o texto mostrado (sem o ×).
const editorChips = (el: HTMLElement) =>
  Array.from(editorOf(el).querySelectorAll(':scope > .vault-prop-chip, :scope > .vault-prop-note'))
    .map(c => c.firstChild!.textContent)
const removeLabels = (el: HTMLElement) =>
  Array.from(editorOf(el).querySelectorAll('button.vault-prop-chip-remove')).map(b => b.getAttribute('aria-label'))

async function open(el: HTMLElement) {
  fireEvent.click(rowOf(el).querySelector<HTMLElement>('.vault-prop-editable')!)
  await settle()
}
const typeIn = (el: HTMLElement, text: string) => { fireEvent.change(inputOf(el), { target: { value: text } }) }
const press = (el: HTMLElement, key: string) => { fireEvent.keyDown(inputOf(el), { key }) }
const clickOption = (el: HTMLElement, text: string) => {
  fireEvent.click(optionsOf(el).find(o => o.textContent === text)!)
}

beforeEach(() => {
  calls = []
  setRelation(BASE)
  stubFetch()
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('editor de relação', () => {
  it('lista os nomes em ordem e não mostra o candidato já escolhido por outra grafia', async () => {
    setRelation(BASE, { '[[alpha|A]]': 'Games/Alpha' })
    const { container } = render(view([relationRow(['[[alpha|A]]'])]))
    expect(relationRow([]).relation).toBe(true)
    await open(container)
    expect(optionTexts(container)).toEqual(['Beta', 'Games/Sub/Delta'])
  })

  it('com 60 candidatos: 50 opções e "Mais 10"; filtrar acha a nota', async () => {
    const many = Array.from({ length: 60 }, (_, i) => {
      const n = 'Nota ' + String(i).padStart(2, '0')
      return cand(`[[${n}]]`, n, 'Games/' + n)
    })
    setRelation(many)
    const { container } = render(view([relationRow([])]))
    await open(container)
    expect(optionsOf(container)).toHaveLength(50)
    expect(container.querySelector('.vault-prop-option.is-more')!.textContent).toBe('Mais 10: digite para filtrar')
    typeIn(container, 'nota 57')
    expect(optionTexts(container)).toEqual(['Nota 57'])
  })

  it('clicar um candidato e Enter no campo vazio grava o link; a ambígua grava o caminho', async () => {
    const { container } = render(view([relationRow([])]))
    await open(container)
    clickOption(container, 'Beta')
    clickOption(container, 'Games/Sub/Delta')
    expect(editorChips(container)).toEqual(['Beta', 'Games/Sub/Delta'])
    press(container, 'Enter')
    expect(calls).toHaveLength(1)
    const value = calls[0].body.value as string[]
    expect(value[0]).toBe('[[Beta]]')
    expect(value.at(-1)).toBe('[[Games/Sub/Delta]]')
  })

  it('digitar um nome novo mostra "Criar nota X"; escolher e Enter grava [[X]]', async () => {
    const { container } = render(view([relationRow([])]))
    await open(container)
    typeIn(container, 'Nova')
    expect(optionTexts(container)).toEqual(['Criar nota Nova'])
    clickOption(container, 'Criar nota Nova')
    expect(editorChips(container)).toEqual(['Nova'])
    press(container, 'Enter')
    expect(calls[0].body.value).toEqual(['[[Nova]]'])
  })

  it('nome inválido não oferece criar, e Enter não adiciona nada', async () => {
    const { container } = render(view([relationRow([])]))
    await open(container)
    typeIn(container, 'Foo|bar')
    expect(optionTexts(container)).toEqual([])
    typeIn(container, 'a#b')
    expect(optionTexts(container)).toEqual([])
    press(container, 'Enter')
    expect(editorChips(container)).toEqual([])
    expect(inputOf(container).value).toBe('a#b')
  })

  it('Enter no nome de uma nota já escolhida limpa o campo; nome inválido deixa o texto', async () => {
    setRelation(BASE, { '[[Games/Alpha|A]]': 'Games/Alpha' })
    const { container } = render(view([relationRow(['[[Games/Alpha|A]]'])]))
    await open(container)
    typeIn(container, 'Alpha')
    press(container, 'Enter')
    expect(editorChips(container)).toEqual(['A'])
    expect(inputOf(container).value).toBe('')
    typeIn(container, 'a#b')
    press(container, 'Enter')
    expect(editorChips(container)).toEqual(['A'])
    expect(inputOf(container).value).toBe('a#b')
  })

  it('item fora da pasta aparece pelo nome e não é sugerido', async () => {
    setRelation([...BASE, cand('[[Outside]]', 'Outside', 'Elsewhere/Outside')])
    const { container } = render(view([relationRow(['[[Outside]]'])]))
    await open(container)
    expect(editorChips(container)).toEqual(['Outside'])
    expect(optionTexts(container)).toEqual(['Alpha', 'Beta', 'Games/Sub/Delta'])
  })

  it('dois chips de mesmo nome têm × diferentes, ambos com "Remover Alpha"', async () => {
    const { container } = render(view([relationRow(['[[Alpha]]', '[[Games/Alpha|Alpha]]'])]))
    await open(container)
    const labels = removeLabels(container)
    expect(labels[0]).not.toBe(labels[1])
    for (const l of labels) expect(l!.startsWith('Remover Alpha')).toBe(true)
  })

  it('GET 500: sem sugestões e com "Criar nota X"', async () => {
    valuesReply = { status: 500, body: { error: 'x' } }
    const { container } = render(view([relationRow([])]))
    await open(container)
    expect(optionTexts(container)).toEqual([])
    typeIn(container, 'X')
    expect(optionTexts(container)).toEqual(['Criar nota X'])
  })
})

describe('relação: a nota aparece como título, sem chip', () => {
  const readView = (properties: PageProperty[]) => (
    <I18nProvider locale="pt-BR">
      <PropertiesBlock properties={properties} />
    </I18nProvider>
  )
  const itemsOf = (el: HTMLElement) => Array.from(editorOf(el).querySelectorAll<HTMLElement>(':scope > span'))

  it('na leitura, a nota é um link sem chip e o alias sai literal; o texto solto é chip', () => {
    const { container } = render(readView([relationRow(['[[Other]]', '[[Missing|a & <b>]]', 'solto'])]))
    const val = container.querySelector<HTMLElement>('.vault-prop-val')!
    const notes = Array.from(val.querySelectorAll(':scope > .vault-prop-note'))
    expect(notes.map(n => n.textContent)).toEqual(['Other', 'a & <b>'])
    expect(notes[0].querySelector('a')!.getAttribute('href')).toBe('/vault/my-vault/Notes/Other')
    expect(notes[1].querySelector('.vault-dead-link')).not.toBeNull()
    expect(Array.from(val.querySelectorAll('.vault-prop-chip')).map(c => c.textContent)).toEqual(['solto'])
  })

  it('o nome acessível do valor separa os títulos por vírgula', () => {
    const { container } = render(view([relationRow(['[[Other]]', '[[Missing]]', 'solto'])]))
    expect(rowOf(container).querySelector('.vault-prop-editable')!.getAttribute('aria-label'))
      .toBe('Editar related: Other, Missing, solto')
  })

  it('no editor, a nota escolhida é título com o ×; o texto solto continua chip', async () => {
    const { container } = render(view([relationRow(['[[Alpha]]', 'solto', '[[Outside]]'])]))
    await open(container)
    const items = itemsOf(container)
    expect(items.map(i => i.className)).toEqual(['vault-prop-note', 'vault-prop-chip', 'vault-prop-note'])
    expect(items[0].querySelector('.vault-prop-note-title')!.textContent).toBe('Alpha')
    expect(items[0].hasAttribute('data-color')).toBe(false)
    expect(items[2].hasAttribute('data-color')).toBe(false)
    expect(items[1].getAttribute('data-color')).not.toBeNull()
    expect(removeLabels(container)).toEqual(['Remover Alpha', 'Remover solto', 'Remover Outside'])
  })

  it('o × do título repetido mantém o "Remover {value} ({path})"', async () => {
    const { container } = render(view([relationRow(['[[Alpha]]', '[[Games/Alpha|Alpha]]'])]))
    await open(container)
    expect(itemsOf(container).every(i => i.className === 'vault-prop-note')).toBe(true)
    expect(removeLabels(container)).toEqual(['Remover Alpha (Games/Alpha)', 'Remover Alpha ([[Games/Alpha|Alpha]])'])
  })

  it('as opções do menu são títulos, e a ativa destaca a linha', async () => {
    const { container } = render(view([relationRow([])]))
    await open(container)
    const opts = optionsOf(container)
    expect(opts).toHaveLength(3)
    for (const o of opts) {
      expect(o.querySelector('.vault-prop-chip')).toBeNull()
      expect(o.querySelector(':scope > .vault-prop-note > .vault-prop-note-title')).not.toBeNull()
    }
    press(container, 'ArrowDown')
    expect(optionsOf(container)[0].classList.contains('is-active')).toBe(true)
  })

  it('"Criar nota {name}" mostra o nome como título', async () => {
    const { container } = render(view([relationRow([])]))
    await open(container)
    typeIn(container, 'Nova')
    const [create] = optionsOf(container)
    expect(create.textContent).toBe('Criar nota Nova')
    expect(create.querySelector('.vault-prop-chip')).toBeNull()
    expect(create.querySelector('.vault-prop-note > .vault-prop-note-title')!.textContent).toBe('Nova')
  })

  it('a linha provisória depois de salvar já mostra o título, sem chip', async () => {
    const { container } = render(view([relationRow(['solto'])]))
    await open(container)
    clickOption(container, 'Beta')
    press(container, 'Enter')
    expect(calls).toHaveLength(1)
    const val = rowOf(container).querySelector<HTMLElement>('.vault-prop-val')!
    expect(Array.from(val.querySelectorAll('.vault-prop-note')).map(n => n.textContent)).toEqual(['Beta'])
    expect(Array.from(val.querySelectorAll('.vault-prop-chip')).map(n => n.textContent)).toEqual(['solto'])
  })

  it('lista comum (sem relation) com wikilink: chip no editor, no menu e no "Criar", como antes', async () => {
    const plainCtx: PropertyRenderContext = { ...CTX, config: EMPTY_PROPERTY_CONFIG }
    valuesReply = { status: 200, body: { values: ['[[Alpha]]', '[[Beta]]'] } }
    const { container } = render(view([toPageProperty('related', ['[[Other]]'], plainCtx)]))
    expect(container.querySelector('.vault-prop-note')).toBeNull()
    await open(container)
    expect(itemsOf(container).map(i => i.className)).toEqual(['vault-prop-chip'])
    for (const o of optionsOf(container)) expect(o.querySelector(':scope > .vault-prop-chip')).not.toBeNull()
    typeIn(container, '[[Nova]]')
    const create = optionsOf(container).at(-1)!
    expect(create.querySelector('.vault-prop-chip')!.textContent).toBe('[[Nova]]')
    expect(container.querySelector('.vault-prop-note')).toBeNull()
  })
})
