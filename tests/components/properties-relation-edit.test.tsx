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
const editorChips = (el: HTMLElement) =>
  Array.from(editorOf(el).querySelectorAll(':scope > .vault-prop-chip')).map(c => c.firstChild!.textContent)
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

  it('item fora da pasta aparece como chip pelo nome e não é sugerido', async () => {
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
