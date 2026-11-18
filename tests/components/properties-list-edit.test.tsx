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
import { ListEditor } from '@/components/viewer/PropertyEditors'
import type { PageProperty } from '@/builder/types'
import { toPageProperty, type PropertyRenderContext } from '@/builder/plugins/properties'
import { LinkResolver } from '@/builder/link-resolver'
import { EMPTY_PROPERTY_CONFIG } from '@/builder/property-types'
import { propertyColor } from '@/lib/property-color'

const EDIT: PropertiesEditContext = { slug: 'my-vault', pagePath: 'Notes/My Note' }

const resolver = new LinkResolver([{ absolutePath: '/v/Notes/Other.md', relativePath: 'Notes/Other', title: 'Other' }])
const CTX: PropertyRenderContext = {
  renderWikilinks: s => resolver.replaceWikilinksEscaped(s, 'my-vault'),
  resolveImage: p => '/vault-assets/my-vault/' + p,
  config: EMPTY_PROPERTY_CONFIG,
}
// A linha que o builder grava para esse valor.
const prop = (key: string, value: unknown): PageProperty => toPageProperty(key, value, CTX)

const GENRES = prop('genres', ['RPG', 'Indie'])
const STATUS = prop('status', 'todo')
const TAGS_MISMATCH: PageProperty = { key: 'tags', type: 'tags', value: 'a', html: 'a', mismatch: true }

// Cópia nova com o mesmo conteúdo, como um router.refresh() entrega.
const fresh = (props: PageProperty[]): PageProperty[] => JSON.parse(JSON.stringify(props))

const view = (properties: PageProperty[]) => (
  <I18nProvider locale="pt-BR">
    <PropertiesBlock properties={properties} edit={EDIT} />
  </I18nProvider>
)

// ─── fetch em stub: o GET de sugestões responde sozinho; o PATCH fica pendente ──────
type Call = { url: string; method: string; body: Record<string, unknown> }
type Reply = { status: number; body: unknown }
let calls: Call[] = [] // PATCHs
let gets: string[] = [] // GETs de sugestões
let pending: Array<(r: Reply) => void> = []
let pendingGets: Array<(r: Reply) => void> = []
// A resposta do GET de sugestões; 'pending' deixa a chamada esperando o teste.
let valuesReply: Reply | 'pending' = { status: 200, body: { values: [] } }

const response = ({ status, body }: Reply) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
    if (url.includes('/property-values?key=')) {
      gets.push(url)
      if (valuesReply === 'pending') {
        return new Promise<Response>(resolve => { pendingGets.push(r => resolve(response(r))) })
      }
      return Promise.resolve(response(valuesReply))
    }
    calls.push({ url, method: String(init.method), body: JSON.parse(String(init.body)) })
    return new Promise<Response>(resolve => { pending.push(r => resolve(response(r))) })
  }))
}

// Deixa as promessas pendentes (a resposta do GET, o .json()) andarem dentro do act.
const settle = () => act(async () => {
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0))
})

async function respondGet(reply: Reply) {
  const next = pendingGets.shift()
  if (!next) throw new Error('nenhum GET pendente')
  next(reply)
  await settle()
}

// ─── consultas e ações na tela ───────────────────────────────────────────────────
const rowOf = (el: HTMLElement, key: string) => {
  const row = Array.from(el.querySelectorAll<HTMLElement>('.vault-prop'))
    .find(r => r.querySelector('.vault-prop-key')?.textContent === key)
  if (!row) throw new Error('sem a linha ' + key)
  return row
}
const editableOf = (el: HTMLElement, key: string) =>
  rowOf(el, key).querySelector<HTMLElement>('.vault-prop-editable')!
const editorOf = (el: HTMLElement) => el.querySelector<HTMLElement>('.vault-prop-multiselect')
const inputOf = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input.vault-prop-list-input')
// O texto de cada chip do editor, sem o ×.
const editorChips = (el: HTMLElement) =>
  Array.from(editorOf(el)!.querySelectorAll(':scope > .vault-prop-chip')).map(c => c.firstChild!.textContent)
// Os chips do valor parado (sem editor aberto).
const shownChips = (el: HTMLElement, key: string) =>
  Array.from(rowOf(el, key).querySelectorAll('.vault-prop-val .vault-prop-chip')).map(c => c.textContent)
const menuOf = (el: HTMLElement) => el.querySelector<HTMLElement>('.vault-prop-menu')
const optionsOf = (el: HTMLElement) =>
  Array.from(el.querySelectorAll<HTMLElement>('.vault-prop-menu li[role="option"]:not([aria-disabled])'))
const optionTexts = (el: HTMLElement) => optionsOf(el).map(o => o.textContent)
const removeButton = (el: HTMLElement, item: string) =>
  editorOf(el)!.querySelector<HTMLButtonElement>(`button[aria-label="Remover ${item}"]`)!
const confirmOf = (el: HTMLElement) => el.querySelector<HTMLElement>('.vault-prop-confirm')
const button = (el: HTMLElement, label: string) =>
  Array.from(el.querySelectorAll('button')).find(b => b.textContent === label)!

async function open(el: HTMLElement, key: string) {
  fireEvent.click(editableOf(el, key))
  await settle()
}
const typeIn = (el: HTMLElement, text: string) => { fireEvent.change(inputOf(el)!, { target: { value: text } }) }
const press = (el: HTMLElement, key: string) => { fireEvent.keyDown(inputOf(el)!, { key }) }
// Digita e dá Enter, sem opção ativa: cria o item.
const create = (el: HTMLElement, text: string) => { typeIn(el, text); press(el, 'Enter') }
// Foco de verdade: o jsdom tira o foco de onde estava e dispara focusout com o relatedTarget.
const focusOn = (target: HTMLElement) => { act(() => { target.focus() }) }

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

beforeEach(() => {
  calls = []
  gets = []
  pending = []
  pendingGets = []
  valuesReply = { status: 200, body: { values: [] } }
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

describe('PropertiesBlock com edição: listas', () => {
  it('abrir mostra um chip por item, com a cor e o ×, e busca as sugestões uma vez só', async () => {
    const { container } = render(view([GENRES]))
    expect(GENRES.type).toBe('multitext')
    await open(container, 'genres')

    const editor = editorOf(container)!
    expect(rowOf(container, 'genres').classList.contains('is-editing')).toBe(true)
    const chips = Array.from(editor.querySelectorAll<HTMLElement>('.vault-prop-chip'))
    expect(editorChips(container)).toEqual(['RPG', 'Indie'])
    expect(chips.map(c => c.dataset.color)).toEqual([propertyColor('genres', 'RPG'), propertyColor('genres', 'Indie')])
    const remove = removeButton(container, 'RPG')
    expect(remove.type).toBe('button')
    expect(remove.classList.contains('vault-prop-chip-remove')).toBe(true)
    expect(remove.textContent).toBe('×')
    expect(removeButton(container, 'Indie')).not.toBeNull()

    const input = inputOf(container)!
    expect(input.classList.contains('vault-prop-input')).toBe(true)
    expect(input.getAttribute('role')).toBe('combobox')
    expect(input.getAttribute('aria-autocomplete')).toBe('list')
    expect(input.getAttribute('aria-label')).toBe('Editar genres')
    expect(input.placeholder).toBe('Buscar ou criar…')
    expect(document.activeElement).toBe(input)

    expect(gets).toEqual(['/api/vault/my-vault/property-values?key=genres'])
    typeIn(container, 'In')
    typeIn(container, 'Ind')
    await settle()
    expect(gets).toHaveLength(1)
  })

  it('sugestões: filtro sem acento nem caixa, sem os itens já escolhidos, e "Criar" no fim', async () => {
    valuesReply = { status: 200, body: { values: ['Ação', 'Aventura', 'RPG'] } }
    const { container } = render(view([GENRES]))
    await open(container, 'genres')
    // campo vazio: todas as sugestões, menos a já escolhida
    expect(optionTexts(container)).toEqual(['Ação', 'Aventura'])

    typeIn(container, 'acao')
    expect(optionTexts(container)).toEqual(['Ação', 'Criar acao'])

    // igual a uma sugestão ou a um item escolhido (depois de aparar): sem "Criar"
    typeIn(container, ' Aventura ')
    expect(optionTexts(container)).toEqual(['Aventura'])
    typeIn(container, 'RPG')
    expect(optionTexts(container)).toEqual([])
    expect(menuOf(container)).toBeNull()
    expect(inputOf(container)!.getAttribute('aria-expanded')).toBe('false')
  })

  it('setas e Enter escolhem a sugestão; Enter com texto cria; Enter com o campo vazio grava o array', async () => {
    valuesReply = { status: 200, body: { values: ['Ação', 'Aventura', 'RPG'] } }
    const { container } = render(view([GENRES]))
    await open(container, 'genres')
    typeIn(container, 'acao')

    press(container, 'ArrowDown')
    const active = optionsOf(container)[0]
    expect(active.textContent).toBe('Ação')
    expect(active.classList.contains('is-active')).toBe(true)
    expect(active.getAttribute('aria-selected')).toBe('true')
    expect(optionsOf(container)[1].classList.contains('is-active')).toBe(false)
    expect(inputOf(container)!.getAttribute('aria-activedescendant')).toBe(active.id)
    // ↓ de novo vai para o "Criar", ↑ volta para a sugestão
    press(container, 'ArrowDown')
    expect(optionsOf(container)[1].classList.contains('is-active')).toBe(true)
    press(container, 'ArrowUp')
    expect(optionsOf(container)[0].classList.contains('is-active')).toBe(true)

    press(container, 'Enter')
    expect(editorChips(container)).toEqual(['RPG', 'Indie', 'Ação'])
    expect(inputOf(container)!.value).toBe('')

    create(container, 'Novo')
    expect(editorChips(container)).toEqual(['RPG', 'Indie', 'Ação', 'Novo'])
    expect(inputOf(container)!.value).toBe('')
    // texto igual a um item já escolhido não duplica
    create(container, ' RPG ')
    expect(editorChips(container)).toEqual(['RPG', 'Indie', 'Ação', 'Novo'])
    expect(calls).toHaveLength(0)

    press(container, 'Enter')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/api/vault/my-vault/properties')
    expect(calls[0].method).toBe('PATCH')
    expect(calls[0].body).toEqual({
      path: 'Notes/My Note', key: 'genres', value: ['RPG', 'Indie', 'Ação', 'Novo'], expected: ['RPG', 'Indie'],
    })
    expect(editorOf(container)).toBeNull()
    expect(rowOf(container, 'genres').classList.contains('is-saving')).toBe(true)
    expect(shownChips(container, 'genres')).toEqual(['RPG', 'Indie', 'Ação', 'Novo'])
  })

  // "acao" + Enter não cria um quase-duplicado ao lado de "Ação": pega o valor que já existe
  // igual ignorando caixa e acento. O "Criar" continua nas setas.
  it('Enter com "acao" adiciona a sugestão "Ação", e não a query', async () => {
    valuesReply = { status: 200, body: { values: ['Ação', 'Aventura'] } }
    const { container } = render(view([GENRES]))
    await open(container, 'genres')
    create(container, 'acao')
    expect(editorChips(container)).toEqual(['RPG', 'Indie', 'Ação'])
    expect(inputOf(container)!.value).toBe('')
  })

  it('Enter com "ACAO" e "Ação" já escolhido não duplica, e limpa o campo', async () => {
    valuesReply = { status: 200, body: { values: ['Ação'] } }
    const { container } = render(view([prop('genres', ['Ação'])]))
    await open(container, 'genres')
    create(container, 'ACAO')
    expect(editorChips(container)).toEqual(['Ação'])
    expect(inputOf(container)!.value).toBe('')
  })

  it('setas até "Criar acao" e Enter criam "acao"', async () => {
    valuesReply = { status: 200, body: { values: ['Ação'] } }
    const { container } = render(view([GENRES]))
    await open(container, 'genres')
    typeIn(container, 'acao')
    press(container, 'ArrowDown')
    press(container, 'ArrowDown')
    expect(optionsOf(container)[1].textContent).toBe('Criar acao')
    press(container, 'Enter')
    expect(editorChips(container)).toEqual(['RPG', 'Indie', 'acao'])
  })

  it('Enter com "RPG" e a sugestão "RPG Tático" cria "RPG": o Enter não pega a primeira opção', async () => {
    valuesReply = { status: 200, body: { values: ['RPG Tático'] } }
    const { container } = render(view([prop('platforms', ['PC'])]))
    await open(container, 'platforms')
    create(container, 'RPG')
    expect(editorChips(container)).toEqual(['PC', 'RPG'])
  })

  // Alt-tab ou troca de aba tiram o foco do campo sem que a pessoa tenha terminado.
  it('focusout causado pela janela perder o foco mantém o editor aberto e não grava', async () => {
    const { container } = render(view([GENRES]))
    await open(container, 'genres')
    fireEvent.click(removeButton(container, 'Indie'))
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    fireEvent.blur(inputOf(container)!)
    expect(calls).toHaveLength(0)
    expect(editorOf(container)).not.toBeNull()
    expect(editorChips(container)).toEqual(['RPG'])

    // a janela voltou: o próximo focusout de verdade decide
    focus.mockReturnValue(true)
    fireEvent.blur(inputOf(container)!)
    expect(calls).toHaveLength(1)
    expect(calls[0].body.value).toEqual(['RPG'])
  })

  // Sem maxLength o campo não corta a colagem: o item grande demais não vira chip. O texto
  // fica no campo, para a pessoa encurtar, com o aviso no editor até ele mudar.
  it('item de 10.001 caracteres: não vira chip, o aviso aparece no editor e o texto fica no campo', async () => {
    const { container } = render(view([GENRES]))
    await open(container, 'genres')
    expect(inputOf(container)!.maxLength).toBe(-1)
    const long = 'a'.repeat(10001)
    const alertOf = () => editorOf(container)!.querySelector('.vault-prop-error[role="alert"]')

    create(container, long)
    expect(editorChips(container)).toEqual(['RPG', 'Indie'])
    expect(inputOf(container)!.value).toBe(long)
    expect(alertOf()!.textContent).toBe('O valor é grande demais.')
    // nem pelas setas até o "Criar", nem pelo clique nele
    press(container, 'ArrowDown')
    press(container, 'Enter')
    fireEvent.click(optionsOf(container)[0])
    expect(editorChips(container)).toEqual(['RPG', 'Indie'])
    expect(inputOf(container)!.value).toBe(long)
    expect(alertOf()).not.toBeNull()

    // mudou o texto: o aviso some, e 10.000 caracteres (aparados) entram
    typeIn(container, ' ' + 'b'.repeat(10000) + ' ')
    expect(alertOf()).toBeNull()
    press(container, 'Enter')
    expect(editorChips(container)).toEqual(['RPG', 'Indie', 'b'.repeat(10000)])
    expect(inputOf(container)!.value).toBe('')
    expect(alertOf()).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('sugestão grande demais escolhida e depois uma válida: o aviso some quando o item entra', async () => {
    valuesReply = { status: 200, body: { values: ['a'.repeat(10001), 'Ok'] } }
    const { container } = render(view([GENRES]))
    await open(container, 'genres')
    const alertOf = () => editorOf(container)!.querySelector('.vault-prop-error[role="alert"]')
    fireEvent.click(optionsOf(container)[0])
    expect(alertOf()).not.toBeNull()
    fireEvent.click(optionsOf(container)[1])
    expect(editorChips(container)).toEqual(['RPG', 'Indie', 'Ok'])
    expect(alertOf()).toBeNull()
  })

  // A checagem do pai continua como rede: um item grande demais que já vem do disco.
  it('item grande demais vindo do disco: o Enter mostra o aviso na linha, sem chamar a API', async () => {
    const { container } = render(view([prop('genres', ['RPG', 'a'.repeat(10001)])]))
    await open(container, 'genres')
    press(container, 'Enter')
    expect(calls).toHaveLength(0)
    expect(editorOf(container)).toBeNull()
    expect(rowOf(container, 'genres').querySelector('.vault-prop-error[role="alert"]')!.textContent)
      .toBe('O valor é grande demais.')
  })

  it('aria-controls só com o menu aberto, apontando para o listbox que existe', async () => {
    const { container } = render(view([GENRES]))
    await open(container, 'genres')
    const input = inputOf(container)!
    // sem sugestões e sem texto: menu fechado
    expect(menuOf(container)).toBeNull()
    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(input.hasAttribute('aria-controls')).toBe(false)

    typeIn(container, 'Novo')
    const menu = menuOf(container)!
    expect(input.getAttribute('aria-expanded')).toBe('true')
    expect(input.getAttribute('aria-controls')).toBe(menu.id)
    expect(document.getElementById(menu.id)).toBe(menu)

    typeIn(container, '')
    expect(menuOf(container)).toBeNull()
    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(input.hasAttribute('aria-controls')).toBe(false)
  })

  it('cada sugestão é um chip na cor de propertyColor, e o "Criar" mostra o texto digitado como chip na cor dele', async () => {
    valuesReply = { status: 200, body: { values: ['Ação', 'Aventura'] } }
    const { container } = render(view([GENRES]))
    await open(container, 'genres')
    for (const [i, v] of ['Ação', 'Aventura'].entries()) {
      const chip = optionsOf(container)[i].querySelector<HTMLElement>('.vault-prop-chip')!
      expect(chip.dataset.color).toBe(propertyColor('genres', v))
      expect(chip.textContent).toBe(v)
    }
    typeIn(container, 'Novo')
    const last = optionsOf(container).at(-1)!
    expect(last.textContent).toBe('Criar Novo')
    const chip = last.querySelector<HTMLElement>('.vault-prop-chip')!
    expect(chip.textContent).toBe('Novo')
    expect(chip.dataset.color).toBe(propertyColor('genres', 'Novo'))
  })

  it('"Criar" de um wikilink digitado mostra o texto cru', async () => {
    valuesReply = { status: 200, body: { values: [] } }
    const { container } = render(view([GENRES]))
    await open(container, 'genres')
    typeIn(container, '[[Nova]]')
    expect(optionTexts(container)).toEqual(['Criar [[Nova]]'])
    press(container, 'Enter')
    expect(editorChips(container)).toEqual(['RPG', 'Indie', 'Nova'])
  })

  it('item wikilink aparece pelo nome nos chips, nas sugestões e no ×, e é gravado cru', async () => {
    const RELATED = prop('related', ['[[Other]]', '[[Notes/Other|Apelido]]', '[[Other#Seção]]', '[[Missing]]', 'RPG', 'ver [[Other]]'])
    valuesReply = { status: 200, body: { values: ['[[Notes/Third]]', '[[Fourth|Quarta]]'] } }
    const { container } = render(view([RELATED]))
    expect(shownChips(container, 'related')).toEqual(['Other', 'Apelido', 'Other', 'Missing', 'RPG', 'ver Other'])
    await open(container, 'related')
    expect(editorChips(container)).toEqual(['Other', 'Apelido', 'Other', 'Missing', 'RPG', 'ver [[Other]]'])
    expect(removeButton(container, 'Apelido')).toBeTruthy()
    expect(removeButton(container, 'Missing')).toBeTruthy()
    expect(optionTexts(container)).toEqual(['Notes/Third', 'Quarta'])
    // a cor vem do valor cru, não do nome mostrado
    const colorOf = (el: Element) => el.querySelector<HTMLElement>('.vault-prop-chip')!.dataset.color
    expect(colorOf(optionsOf(container)[1])).toBe(propertyColor('related', '[[Fourth|Quarta]]'))
    const apelido = Array.from(editorOf(container)!.querySelectorAll<HTMLElement>('.vault-prop-chip'))
      .find(c => c.textContent?.startsWith('Apelido'))!
    expect(apelido.dataset.color).toBe(propertyColor('related', '[[Notes/Other|Apelido]]'))
    fireEvent.click(optionsOf(container)[1])
    fireEvent.click(removeButton(container, 'Missing'))
    press(container, 'Enter')
    expect(calls[0].body.value).toEqual(['[[Other]]', '[[Notes/Other|Apelido]]', '[[Other#Seção]]', 'RPG', 'ver [[Other]]', '[[Fourth|Quarta]]'])
    await settle()
    expect(shownChips(container, 'related')).toContain('Quarta')
    expect(shownChips(container, 'related')).not.toContain('[[Fourth|Quarta]]')
  })

  it('o filtro acha pelo nome mostrado e pelo texto cru', async () => {
    valuesReply = { status: 200, body: { values: ['[[Notes/Alpha|Primeiro]]', '[[Beta]]', 'Gama'] } }
    const { container } = render(view([GENRES]))
    await open(container, 'genres')
    typeIn(container, 'prim')
    expect(optionTexts(container)).toEqual(['Primeiro', 'Criar prim'])
    typeIn(container, 'alpha')
    expect(optionTexts(container)).toEqual(['Primeiro', 'Criar alpha'])
    typeIn(container, '[[')
    expect(optionTexts(container)).toEqual(['Primeiro', 'Beta', 'Criar [['])
  })

  it('Enter com o nome de um link em outra caixa escolhe o link, e não cria texto solto', async () => {
    valuesReply = { status: 200, body: { values: ['[[Nota A]]', 'Nota Antiga'] } }
    const { container } = render(view([GENRES]))
    await open(container, 'genres')
    create(container, 'nota a')
    expect(editorChips(container).at(-1)).toBe('Nota A')
    press(container, 'Enter')
    expect(calls[0].body.value).toContain('[[Nota A]]')
    expect(calls[0].body.value).not.toContain('nota a')
  })

  it('Enter com o nome de um link já escolhido não duplica, e limpa o campo', async () => {
    valuesReply = { status: 200, body: { values: [] } }
    const { container } = render(view([prop('related', ['[[Nota A]]'])]))
    await open(container, 'related')
    const before = editorChips(container)
    create(container, 'NOTA A')
    expect(editorChips(container)).toEqual(before)
    expect(inputOf(container)!.value).toBe('')
  })

  it('Enter: cru exato, nome exato, cru normalizado e nome normalizado, nessa ordem; nome repetido pega o primeiro', async () => {
    // Confere o valor CRU escolhido (o que seria gravado), não o texto do chip.
    const run = async (values: string[], typed: string) => {
      valuesReply = { status: 200, body: { values } }
      const { container, unmount } = render(view([GENRES]))
      await open(container, 'genres')
      const before = calls.length
      create(container, typed)
      press(container, 'Enter') // campo vazio: salva
      expect(calls).toHaveLength(before + 1)
      const added = (calls.at(-1)!.body.value as string[]).slice(2)
      unmount()
      return added
    }
    // cru exato vence nome exato
    expect(await run(['[[Nota A]]', 'Nota A'], 'Nota A')).toEqual(['Nota A'])
    // nome exato vence cru normalizado
    expect(await run(['nota a', '[[Nota A]]'], 'Nota A')).toEqual(['[[Nota A]]'])
    // cru normalizado vence nome normalizado
    expect(await run(['[[Nota A]]', 'nota a'], 'NOTA A')).toEqual(['nota a'])
    // nome exato repetido: o primeiro
    expect(await run(['[[Nota]]', '[[Nota|Nota]]'], 'Nota')).toEqual(['[[Nota]]'])
    // nome repetido: o primeiro
    expect(await run(['[[Nota]]', '[[Nota#Seção]]'], 'nota')).toEqual(['[[Nota]]'])
  })

  describe('limite de 50 sugestões', () => {
    // 60 valores neutros, na ordem do índice.
    const MANY = Array.from({ length: 60 }, (_, i) => 'Tag ' + String(i).padStart(3, '0'))
    const MORE_10 = 'Mais 10: digite para filtrar'
    const lines = (el: HTMLElement) => Array.from(el.querySelectorAll('.vault-prop-menu li')).map(li => li.textContent)

    it('a linha "Mais n" não tem chip', async () => {
      valuesReply = { status: 200, body: { values: MANY } }
      const { container } = render(view([GENRES]))
      await open(container, 'genres')
      const more = container.querySelector<HTMLElement>('.vault-prop-menu .is-more')!
      expect(more).toBeTruthy()
      expect(more.querySelector('.vault-prop-chip')).toBeNull()
    })

    it('durante a carga, o "Carregando…" não tem chip', async () => {
      valuesReply = 'pending'
      const { container } = render(view([GENRES]))
      await open(container, 'genres')
      const row = container.querySelector<HTMLElement>('.vault-prop-menu .is-loading')!
      expect(row.querySelector('.vault-prop-chip')).toBeNull()
    })

    it('o link igual pelo nome vem primeiro, mesmo depois da 50ª', async () => {
      const SIMILAR = Array.from({ length: 60 }, (_, i) => 'nota a ' + String(i).padStart(2, '0'))
      valuesReply = { status: 200, body: { values: [...SIMILAR, '[[Nota A]]'] } }
      const { container } = render(view([GENRES]))
      await open(container, 'genres')
      typeIn(container, 'nota a')
      expect(optionTexts(container)[0]).toBe('Nota A')
    })
    const moreOf = (el: HTMLElement) =>
      el.querySelector<HTMLElement>('.vault-prop-menu li[aria-disabled="true"]:not(.is-loading)')
    const activeOf = (el: HTMLElement) => {
      const id = inputOf(el)!.getAttribute('aria-activedescendant')
      return id === null ? null : document.getElementById(id)
    }

    it('o valor igual ao digitado (sem caixa e acento) vem primeiro, mesmo depois da 50ª', async () => {
      const SIMILAR = Array.from({ length: 55 }, (_, i) => 'Jogo rpg ' + String(i).padStart(2, '0'))
      valuesReply = { status: 200, body: { values: [...SIMILAR, 'rpg', 'Ação'] } }
      const { container } = render(view([GENRES]))
      await open(container, 'genres')
      typeIn(container, 'rpg')
      // sem "Criar": o valor já existe, e é ele a primeira opção
      expect(optionTexts(container)).toEqual(['rpg', ...SIMILAR.slice(0, 49)])
      fireEvent.click(optionsOf(container)[0])
      expect(editorChips(container)).toEqual(['RPG', 'Indie', 'rpg'])
      typeIn(container, 'acao')
      expect(optionTexts(container)[0]).toBe('Ação')
    })

    it('60 sugestões: 50 opções, a linha "Mais 10" e, com texto, o "Criar" depois dela', async () => {
      valuesReply = { status: 200, body: { values: MANY } }
      const { container } = render(view([GENRES]))
      await open(container, 'genres')
      expect(optionTexts(container)).toEqual(MANY.slice(0, 50))
      expect(lines(container)).toEqual([...MANY.slice(0, 50), MORE_10])
      const more = moreOf(container)!
      expect(more.getAttribute('role')).toBe('option')
      expect(more.getAttribute('aria-selected')).toBe('false')
      expect(more.id).toBe('')

      typeIn(container, 'tag')
      expect(optionTexts(container)).toEqual([...MANY.slice(0, 50), 'Criar tag'])
      expect(lines(container)).toEqual([...MANY.slice(0, 50), MORE_10, 'Criar tag'])
    })

    it('as setas pulam a linha "Mais", e o Enter escolhe a opção que está ativa', async () => {
      valuesReply = { status: 200, body: { values: MANY } }
      const { container } = render(view([GENRES]))
      await open(container, 'genres')
      typeIn(container, 'tag')
      const seen: string[] = []
      for (let i = 0; i < 52; i++) {
        press(container, 'ArrowDown')
        const active = activeOf(container)!
        expect(active.getAttribute('aria-disabled')).toBeNull()
        expect(moreOf(container)!.classList.contains('is-active')).toBe(false)
        expect(moreOf(container)!.getAttribute('aria-selected')).toBe('false')
        seen.push(active.textContent!)
      }
      // as 50 sugestões, o "Criar" e de volta à primeira
      expect(seen).toEqual([...MANY.slice(0, 50), 'Criar tag', MANY[0]])
      press(container, 'ArrowUp')
      expect(activeOf(container)!.textContent).toBe('Criar tag')
      press(container, 'ArrowUp')
      expect(activeOf(container)!.textContent).toBe(MANY[49])
      press(container, 'Enter')
      expect(editorChips(container)).toEqual(['RPG', 'Indie', MANY[49]])
      // com um a menos de fora, a linha conta 9
      expect(moreOf(container)!.textContent).toBe('Mais 9: digite para filtrar')

      // a linha não é escolhida pelo clique
      fireEvent.click(moreOf(container)!)
      expect(editorChips(container)).toEqual(['RPG', 'Indie', MANY[49]])
      // e o mousedown nela não tira o foco do campo (a caixa cancela o padrão)
      expect(fireEvent.mouseDown(moreOf(container)!)).toBe(false)
    })

    it('sem a linha quando o filtro deixa 50 ou menos', async () => {
      valuesReply = { status: 200, body: { values: MANY } }
      const { container } = render(view([GENRES]))
      await open(container, 'genres')
      typeIn(container, 'tag 01')
      expect(optionTexts(container)).toEqual([...MANY.slice(10, 20), 'Criar tag 01'])
      expect(moreOf(container)).toBeNull()
      typeIn(container, '')
      expect(moreOf(container)!.textContent).toBe(MORE_10)
    })

    it('exatamente 50 de fora dos itens escolhidos: sem a linha', async () => {
      valuesReply = { status: 200, body: { values: MANY } }
      const { container } = render(view([prop('genres', MANY.slice(0, 10))]))
      await open(container, 'genres')
      expect(optionTexts(container)).toEqual(MANY.slice(10))
      expect(moreOf(container)).toBeNull()
    })

    it('em inglês: "{n} more: type to narrow down"', async () => {
      valuesReply = { status: 200, body: { values: MANY } }
      const { container } = render(
        <I18nProvider locale="en">
          <ListEditor propKey="genres" slug="my-vault" initial={[]} label="genres" onCommit={vi.fn()} onCancel={vi.fn()} />
        </I18nProvider>,
      )
      await settle()
      expect(moreOf(container)!.textContent).toBe('10 more: type to narrow down')
    })
  })

  it('clique numa opção adiciona, sem tirar o foco do campo', async () => {
    valuesReply = { status: 200, body: { values: ['Ação', 'Aventura'] } }
    const { container } = render(view([GENRES]))
    await open(container, 'genres')
    const option = optionsOf(container)[1]
    // false: o mousedown teve preventDefault, e o foco fica no input
    expect(fireEvent.mouseDown(option)).toBe(false)
    fireEvent.click(option)
    expect(editorChips(container)).toEqual(['RPG', 'Indie', 'Aventura'])
    expect(document.activeElement).toBe(inputOf(container))
    // clicar num chip também não tira o foco (senão o focusout fecharia o editor)
    expect(fireEvent.mouseDown(editorOf(container)!.querySelector('.vault-prop-chip')!)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('o × e o Backspace com o campo vazio tiram itens; tirar todos grava []', async () => {
    const { container } = render(view([GENRES]))
    await open(container, 'genres')

    const remove = removeButton(container, 'Indie')
    expect(fireEvent.mouseDown(remove)).toBe(false)
    fireEvent.click(remove)
    expect(editorChips(container)).toEqual(['RPG'])
    expect(document.activeElement).toBe(inputOf(container))

    // Backspace com texto no campo apaga o texto, não o item
    typeIn(container, 'x')
    press(container, 'Backspace')
    expect(editorChips(container)).toEqual(['RPG'])
    typeIn(container, '')
    press(container, 'Backspace')
    expect(editorChips(container)).toEqual([])
    press(container, 'Backspace') // sem itens: nada acontece
    expect(editorChips(container)).toEqual([])

    press(container, 'Enter')
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toEqual({ path: 'Notes/My Note', key: 'genres', value: [], expected: ['RPG', 'Indie'] })
    expect(rowOf(container, 'genres').querySelector('.vault-prop-val')!.textContent).toBe('Vazio')
  })

  it('× pelo teclado devolve o foco ao campo, sem fechar o editor', async () => {
    const { container } = render(view([GENRES]))
    await open(container, 'genres')
    const remove = removeButton(container, 'Indie')
    focusOn(remove)
    fireEvent.click(remove) // Enter ou Espaço num botão viram click
    expect(editorChips(container)).toEqual(['RPG'])
    expect(document.activeElement).toBe(inputOf(container))
    expect(calls).toHaveLength(0)
  })

  it('Esc não grava, e a linha volta aos chips de antes, com o foco no valor', async () => {
    const { container } = render(view([GENRES]))
    await open(container, 'genres')
    fireEvent.click(removeButton(container, 'Indie'))
    create(container, 'Novo')
    typeIn(container, 'meio')
    press(container, 'Escape')
    expect(calls).toHaveLength(0)
    expect(editorOf(container)).toBeNull()
    expect(rowOf(container, 'genres').classList.contains('is-editing')).toBe(false)
    expect(shownChips(container, 'genres')).toEqual(['RPG', 'Indie'])
    expect(document.activeElement).toBe(editableOf(container, 'genres'))
  })

  it('Esc com o foco num × também cancela', async () => {
    const { container } = render(view([GENRES]))
    await open(container, 'genres')
    fireEvent.click(removeButton(container, 'Indie'))
    focusOn(removeButton(container, 'RPG'))
    fireEvent.keyDown(removeButton(container, 'RPG'), { key: 'Escape' })
    expect(editorOf(container)).toBeNull()
    expect(calls).toHaveLength(0)
    expect(shownChips(container, 'genres')).toEqual(['RPG', 'Indie'])
  })

  it('focusout para fora do editor salva; para o × do próprio editor, não', async () => {
    const { container } = render(<div>{view([GENRES])}<button type="button">fora</button></div>)
    await open(container, 'genres')
    fireEvent.click(removeButton(container, 'Indie'))

    focusOn(removeButton(container, 'RPG'))
    expect(editorOf(container)).not.toBeNull()
    expect(calls).toHaveLength(0)

    const outside = button(container, 'fora')
    focusOn(outside)
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toEqual({ path: 'Notes/My Note', key: 'genres', value: ['RPG'], expected: ['RPG', 'Indie'] })
    expect(editorOf(container)).toBeNull()
    // saiu para outro lugar: o foco fica lá
    expect(document.activeElement).toBe(outside)
  })

  it('sem mudança nos itens: Enter com o campo vazio e focusout para fora não chamam a API', async () => {
    const { container } = render(<div>{view([GENRES])}<button type="button">fora</button></div>)
    await open(container, 'genres')
    press(container, 'Enter')
    expect(editorOf(container)).toBeNull()

    await open(container, 'genres')
    typeIn(container, 'digitado e não adicionado')
    focusOn(button(container, 'fora'))
    expect(editorOf(container)).toBeNull()

    // tirar e pôr de volta no mesmo lugar é "sem mudança"
    await open(container, 'genres')
    press(container, 'Backspace')
    create(container, 'Indie')
    expect(editorChips(container)).toEqual(['RPG', 'Indie'])
    press(container, 'Enter')

    expect(calls).toHaveLength(0)
    expect(container.querySelector('.vault-prop-saving')).toBeNull()
    expect(shownChips(container, 'genres')).toEqual(['RPG', 'Indie'])
  })

  // A comparação é com os itens que abriram, não com o valor já sem repetição: abrir e dar
  // Enter não grava a lista "limpa" sem o usuário ter mexido.
  it('item repetido no disco: Enter sem mudança não grava; tirar um grava sem a repetição', async () => {
    const dup = prop('genres', ['RPG', 'RPG'])
    expect(dup.value).toEqual(['RPG', 'RPG'])
    const { container } = render(view([dup]))
    await open(container, 'genres')
    expect(editorChips(container)).toEqual(['RPG', 'RPG'])
    press(container, 'Enter')
    expect(editorOf(container)).toBeNull()
    expect(calls).toHaveLength(0)

    await open(container, 'genres')
    press(container, 'Backspace')
    press(container, 'Enter')
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toEqual({ path: 'Notes/My Note', key: 'genres', value: ['RPG'], expected: ['RPG', 'RPG'] })
  })

  it('a ordem conta: os mesmos itens em outra ordem gravam', async () => {
    const { container } = render(view([GENRES]))
    await open(container, 'genres')
    fireEvent.click(removeButton(container, 'RPG'))
    create(container, 'RPG')
    press(container, 'Enter')
    expect(calls).toHaveLength(1)
    expect(calls[0].body.value).toEqual(['Indie', 'RPG'])
  })

  it('Enter ou Esc seguidos do blur que o navegador dispara ao tirar o input: um PATCH no Enter, nenhum no Esc', async () => {
    blurOnRemove()
    const { container } = render(view([GENRES]))
    await open(container, 'genres')
    create(container, 'Novo')
    press(container, 'Enter')
    expect(editorOf(container)).toBeNull()
    expect(calls).toHaveLength(1)

    const other = render(view([prop('tags', ['a'])]))
    await open(other.container, 'tags')
    create(other.container, 'b')
    press(other.container, 'Escape')
    expect(editorOf(other.container)).toBeNull()
    expect(calls).toHaveLength(1)
  })

  // Aqui o blur chega antes do novo render, com o editor ainda montado: é a ref "fechado"
  // do ListEditor que segura a segunda chamada.
  it('Enter ou Esc com um blur antes do novo render: um PATCH no Enter, nenhum no Esc', async () => {
    const { container } = render(view([GENRES, prop('tags', ['a'])]))
    await open(container, 'genres')
    create(container, 'Novo')
    act(() => {
      fireEvent.keyDown(inputOf(container)!, { key: 'Enter' })
      inputOf(container)!.blur()
    })
    expect(editorOf(container)).toBeNull()
    expect(calls).toHaveLength(1)

    await open(container, 'tags')
    create(container, 'b')
    act(() => {
      fireEvent.keyDown(inputOf(container)!, { key: 'Escape' })
      inputOf(container)!.blur()
    })
    expect(editorOf(container)).toBeNull()
    expect(calls).toHaveLength(1)
    expect(shownChips(container, 'tags')).toEqual(['a'])
  })

  it('mismatch: tags: "a" abre com o chip "a", e o Enter vai para a confirmação', async () => {
    const { container } = render(view([TAGS_MISMATCH]))
    await open(container, 'tags')
    expect(editorChips(container)).toEqual(['a'])
    press(container, 'Enter')
    expect(calls).toHaveLength(0)
    const confirm = confirmOf(container)!
    expect(confirm.textContent).toContain('(Tags)')
    expect(rowOf(container, 'tags').classList.contains('is-editing')).toBe(true)

    fireEvent.click(button(confirm, 'Substituir'))
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toEqual({ path: 'Notes/My Note', key: 'tags', value: ['a'], expected: 'a', confirm: true })
  })

  it('mismatch: focusout para fora sem mudança cancela, sem confirmação', async () => {
    const { container } = render(<div>{view([TAGS_MISMATCH])}<button type="button">fora</button></div>)
    await open(container, 'tags')
    focusOn(button(container, 'fora'))
    expect(editorOf(container)).toBeNull()
    expect(confirmOf(container)).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('menu aberto: .vault-prop-menu.is-open no documento, como listbox', async () => {
    valuesReply = { status: 200, body: { values: ['Ação'] } }
    const { container } = render(view([GENRES]))
    await open(container, 'genres')
    const menu = document.querySelector<HTMLElement>('.vault-prop-menu.is-open')
    expect(menu).not.toBeNull()
    expect(menu!.getAttribute('role')).toBe('listbox')
    expect(menu!.querySelector('li')!.classList.contains('vault-prop-option')).toBe(true)
    const input = inputOf(container)!
    expect(input.getAttribute('aria-expanded')).toBe('true')
    expect(input.getAttribute('aria-controls')).toBe(menu!.id)
    press(container, 'Escape')
    expect(document.querySelector('.vault-prop-menu.is-open')).toBeNull()
  })

  it('durante a carga o menu mostra "Carregando…", e criar já funciona', async () => {
    valuesReply = 'pending'
    const { container } = render(view([GENRES]))
    await open(container, 'genres')
    expect(menuOf(container)!.textContent).toBe('Carregando…')
    expect(inputOf(container)!.getAttribute('aria-expanded')).toBe('true')

    typeIn(container, 'Ave')
    expect(optionTexts(container)).toEqual(['Criar Ave'])
    await respondGet({ status: 200, body: { values: ['Aventura'] } })
    expect(menuOf(container)!.textContent).not.toContain('Carregando…')
    expect(optionTexts(container)).toEqual(['Aventura', 'Criar Ave'])
    press(container, 'ArrowDown')
    press(container, 'Enter')
    expect(editorChips(container)).toEqual(['RPG', 'Indie', 'Aventura'])
  })

  it('GET com erro (500): sem sugestões, mas Enter ainda cria o item', async () => {
    valuesReply = { status: 500, body: { error: 'falhou' } }
    const { container } = render(view([GENRES]))
    await open(container, 'genres')
    expect(menuOf(container)).toBeNull()
    typeIn(container, 'Novo')
    expect(optionTexts(container)).toEqual(['Criar Novo'])
    press(container, 'Enter')
    expect(editorChips(container)).toEqual(['RPG', 'Indie', 'Novo'])
    press(container, 'Enter')
    expect(calls[0].body.value).toEqual(['RPG', 'Indie', 'Novo'])
  })

  it('refresh com o editor aberto mantém os itens e o texto, sem buscar de novo', async () => {
    const props = [GENRES, STATUS]
    const { container, rerender } = render(view(props))
    await open(container, 'genres')
    fireEvent.click(removeButton(container, 'Indie'))
    typeIn(container, 'meio digitado')
    const input = inputOf(container)!
    rerender(view(fresh(props)))
    await settle()
    expect(inputOf(container)).toBe(input)
    expect(input.value).toBe('meio digitado')
    expect(editorChips(container)).toEqual(['RPG'])
    expect(document.activeElement).toBe(input)
    expect(gets).toHaveLength(1)
  })

  it('valor parado: botão com os itens no nome acessível, e o clique num link de item não abre o editor', async () => {
    const related = prop('related', ['[[Notes/Other]]', 'x'])
    expect(related.html).toContain('<a ')
    const outer = vi.fn()
    // Como o ContentPanel: pega o clique no link e navega pelo router (preventDefault).
    const { container } = render(
      <div onClick={e => { e.preventDefault(); outer((e.target as Element).tagName) }}>
        {view([GENRES, related, prop('empty', [])])}
      </div>,
    )
    const editable = editableOf(container, 'genres')
    expect(editable.getAttribute('role')).toBe('button')
    expect(editable.getAttribute('tabindex')).toBe('0')
    expect(editable.getAttribute('aria-label')).toBe('Editar genres: RPG, Indie')
    // o texto visível de cada chip (o do link é o que o resolver mostra), separado por vírgula
    const link = editableOf(container, 'related').querySelector('a')!.textContent
    expect(editableOf(container, 'related').getAttribute('aria-label')).toBe(`Editar related: ${link}, x`)
    expect(editableOf(container, 'empty').getAttribute('aria-label')).toBe('Editar empty: Vazio')

    fireEvent.click(editableOf(container, 'related').querySelector('a')!)
    expect(editorOf(container)).toBeNull()
    expect(outer).toHaveBeenCalledWith('A')
    expect(gets).toHaveLength(0)

    await open(container, 'related')
    expect(editorChips(container)).toEqual(['Notes/Other', 'x'])
  })

  it('Enter com foco no valor parado abre o editor', async () => {
    const { container } = render(view([GENRES]))
    fireEvent.keyDown(editableOf(container, 'genres'), { key: 'Enter' })
    await settle()
    expect(inputOf(container)).not.toBeNull()
  })

  it('lista com quebra de linha num item fica sem controle', () => {
    const { container } = render(view([prop('genres', ['RPG', 'line one\nline two'])]))
    const row = rowOf(container, 'genres')
    expect(row.querySelector('.vault-prop-editable, [role="button"], [tabindex], input, button')).toBeNull()
    fireEvent.click(row.querySelector('.vault-prop-val')!)
    expect(editorOf(container)).toBeNull()
  })

  it('um editor por vez: abrir a lista troca o editor de texto, e o de texto troca a lista', async () => {
    const { container } = render(view([STATUS, GENRES]))
    fireEvent.click(editableOf(container, 'status'))
    await open(container, 'genres')
    expect(container.querySelector('input.vault-prop-input:not(.vault-prop-list-input)')).toBeNull()
    expect(editorOf(container)).not.toBeNull()
    const editing = container.querySelectorAll('.vault-prop.is-editing')
    expect(editing).toHaveLength(1)
    expect(editing[0]).toBe(rowOf(container, 'genres'))

    fireEvent.click(editableOf(container, 'status'))
    expect(editorOf(container)).toBeNull()
    expect(container.querySelectorAll('.vault-prop.is-editing')).toHaveLength(1)
    expect(calls).toHaveLength(0)
  })

  it('reabrir busca as sugestões de novo (uma vez por abertura)', async () => {
    const { container } = render(view([GENRES]))
    await open(container, 'genres')
    press(container, 'Escape')
    await open(container, 'genres')
    expect(gets).toHaveLength(2)
  })
})

describe('ListEditor', () => {
  const editor = (initial: string[] = ['RPG']) => {
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    const r = render(
      <I18nProvider locale="pt-BR">
        <ListEditor propKey="genres" slug="my-vault" initial={initial} label="genres" onCommit={onCommit} onCancel={onCancel} />
        <button type="button">fora</button>
      </I18nProvider>,
    )
    return { ...r, onCommit, onCancel, input: inputOf(r.container)!, outside: button(r.container, 'fora') }
  }

  it('Enter com o campo vazio entrega os itens, mesmo sem mudança (o pai decide)', async () => {
    const { input, onCommit, onCancel } = editor()
    await settle()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(['RPG'])
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('focusout para fora sem mudança cancela; com mudança, entrega os itens', async () => {
    const same = editor()
    await settle()
    focusOn(same.outside)
    expect(same.onCancel).toHaveBeenCalledTimes(1)
    expect(same.onCommit).not.toHaveBeenCalled()
    cleanup()

    const changed = editor()
    await settle()
    fireEvent.change(changed.input, { target: { value: 'Indie' } })
    fireEvent.keyDown(changed.input, { key: 'Enter' })
    focusOn(changed.outside)
    expect(changed.onCommit).toHaveBeenCalledTimes(1)
    expect(changed.onCommit).toHaveBeenCalledWith(['RPG', 'Indie'])
  })

  it('fecha uma vez só: Esc seguido de focusout chama só onCancel', async () => {
    const { input, outside, onCommit, onCancel } = editor()
    await settle()
    fireEvent.change(input, { target: { value: 'Indie' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Escape' })
    focusOn(outside)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('focusout com a janela sem foco não fecha nem entrega os itens', async () => {
    const { input, onCommit, onCancel } = editor()
    await settle()
    fireEvent.change(input, { target: { value: 'Indie' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    fireEvent.blur(input)
    expect(onCommit).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('durante a composição (IME), Enter e Backspace são da composição', async () => {
    const { input, onCommit } = editor()
    await settle()
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(input, { key: 'Backspace', isComposing: true })
    expect(onCommit).not.toHaveBeenCalled()
    expect(editorChips(document.body)).toEqual(['RPG'])
  })
})

describe('cor escolhida no editor de lista', () => {
  const COLORED: PageProperty = {
    key: 'genres', type: 'multitext', value: ['RPG'], html: '', colors: { RPG: 'purple', Zed: 'green', Novo: 'red' },
  }

  it('chip do editor, opção do menu e chip do "Criar" usam a cor escolhida', async () => {
    valuesReply = { status: 200, body: { values: ['RPG', 'Zed'] } }
    const { container } = render(view([COLORED]))
    await open(container, 'genres')
    await settle()
    expect(editorOf(container)!.querySelector<HTMLElement>(':scope > .vault-prop-chip')!.dataset.color).toBe('purple')
    const zed = optionsOf(container)[0].querySelector<HTMLElement>('.vault-prop-chip')!
    expect(zed.textContent).toBe('Zed')
    expect(zed.dataset.color).toBe('green')
    typeIn(container, ' Novo ')
    const last = optionsOf(container).at(-1)!.querySelector<HTMLElement>('.vault-prop-chip')!
    expect(last.textContent).toBe('Novo')
    expect(last.dataset.color).toBe('red')
    // sem cor escolhida, a cor segue sendo a de propertyColor
    typeIn(container, 'Outro')
    expect(optionsOf(container).at(-1)!.querySelector<HTMLElement>('.vault-prop-chip')!.dataset.color).toBe(propertyColor('genres', 'Outro'))
  })

  it('a linha provisória, depois de gravar, mantém a cor escolhida', async () => {
    valuesReply = { status: 200, body: { values: ['Zed'] } }
    const { container } = render(view([COLORED]))
    await open(container, 'genres')
    await settle()
    create(container, 'Zed')
    press(container, 'Enter')
    await settle()
    expect(calls).toHaveLength(1)
    const chips = Array.from(rowOf(container, 'genres').querySelectorAll<HTMLElement>('.vault-prop-val .vault-prop-chip'))
    expect(chips.map(c => [c.textContent, c.dataset.color])).toEqual([['RPG', 'purple'], ['Zed', 'green']])
  })
})
