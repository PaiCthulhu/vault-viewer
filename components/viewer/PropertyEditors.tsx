'use client'

import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useI18n } from '@/components/i18n/I18nProvider'
import { normalizeForSearch } from '@/lib/gallery-search'
import { fetchPropertyValues } from '@/lib/property-client'
import { propertyColor } from '@/lib/property-color'
import { MAX_PROPERTY_TEXT, sameValue, type ScalarEditorType } from '@/lib/property-edit'

// Controles de edição do bloco Propriedades. Eles só coletam o que o usuário escolheu: o
// PropertiesBlock valida, confirma e grava.

const INPUT_TYPES: Record<ScalarEditorType, string> = {
  text: 'text',
  number: 'number',
  date: 'date',
  datetime: 'datetime-local',
}

// Número ou data que o navegador não entende ("1e", "1-2", data pela metade) chega com o
// `value` vazio, e vazio limpa o valor. Vai no lugar um texto que `textDraftValue` recusa
// para número e data, e a linha mostra o erro do tipo em vez de apagar o que havia. O tipo
// texto nunca tem entrada ruim.
const BAD_INPUT = '?'

// Campo de um valor escalar. Não controlado: o texto digitado mora no próprio input, e um
// refresh da página não o toca.
//
// `unchanged`: o campo tem o mesmo texto que mostrou ao abrir. Ele é comparado com o
// `value` lido logo depois de montar, já sanitizado pelo navegador, e não com `initial`: um
// texto com espaços em volta, ou que o input reescreve, não conta como mudança. O blur sem
// mudança cancela; o Enter sem mudança chega ao pai, que só fecha (ou confirma a troca de
// um valor fora do tipo, que é o que o Enter pede ali).
export function ScalarEditor({ type, initial, label, onCommit, onCancel }: {
  type: ScalarEditorType
  initial: string
  label: string
  onCommit(text: string, info: { unchanged: boolean }): void
  onCancel(): void
}) {
  // Fecha uma vez só. O Enter e o Esc tiram o input da tela, e o navegador pode disparar o
  // blur logo em seguida: sem isto, esse blur gravaria de novo, ou gravaria depois do Esc.
  const closed = useRef(false)
  const shown = useRef<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // O Chrome gira o número com a roda do mouse quando o input está focado, e o blur gravaria
  // o valor girado sem querer. Listener nativo e não passivo: o `onWheel` do React é passivo,
  // e nele o preventDefault é ignorado. Sem foco, a roda segue rolando a página.
  useEffect(() => {
    const input = inputRef.current
    if (type !== 'number' || !input) return
    const onWheel = (e: WheelEvent) => {
      if (document.activeElement === input) e.preventDefault()
    }
    input.addEventListener('wheel', onWheel, { passive: false })
    return () => input.removeEventListener('wheel', onWheel)
  }, [type])

  function finish(input: HTMLInputElement, how: 'enter' | 'blur' | 'escape') {
    if (closed.current) return
    closed.current = true
    if (how === 'escape') return onCancel()
    if (input.validity.badInput) return onCommit(BAD_INPUT, { unchanged: false })
    const unchanged = input.value === shown.current
    if (unchanged && how === 'blur') return onCancel()
    onCommit(input.value, { unchanged })
  }

  return (
    <input
      ref={el => {
        inputRef.current = el
        if (el && shown.current === null) shown.current = el.value
      }}
      className="vault-prop-input"
      type={INPUT_TYPES[type]}
      defaultValue={initial}
      aria-label={label}
      autoFocus
      // Sem maxLength: ele cortaria a colagem em silêncio, e o `textDraftValue` recusa o texto
      // grande demais com o aviso.
      // Sem inputMode: o teclado "decimal" do iOS não tem a tecla de menos.
      step={type === 'number' ? 'any' : undefined}
      onKeyDown={e => {
        // Durante a composição (IME), Enter e Esc são da composição.
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(e.currentTarget, 'enter')
        } else if (e.key === 'Escape') {
          e.preventDefault()
          finish(e.currentTarget, 'escape')
        }
      }}
      onBlur={e => {
        // Alt-tab ou troca de aba também disparam blur: a janela sem foco não é "terminei", e
        // gravaria o texto pela metade. O editor fica aberto, e o navegador devolve o foco.
        if (!document.hasFocus()) return
        finish(e.currentTarget, 'blur')
      }}
    />
  )
}

// O mousedown num botão ou num item do menu tiraria o foco do campo, e o focusout fecharia
// o editor antes do click.
const keepFocus = (e: MouseEvent) => e.preventDefault()

interface ListOption {
  value: string
  create: boolean
}

// Sugestões mostradas de uma vez (sem contar o "Criar"). Uma chave com milhares de valores
// faria um menu enorme; o resto aparece digitando para filtrar.
const MAX_SUGGESTIONS = 50

// Seleção múltipla de uma propriedade de lista (multitext, tags, aliases): os itens como
// chips, um campo para buscar ou criar e o menu de sugestões, que são os valores que o vault
// já usa nessa chave (uma busca por abertura). Os itens e o texto moram aqui até fechar: um
// refresh da página não os toca.
//
// Fecha uma vez só, como o ScalarEditor. Sair (o foco vai para fora do editor) sem mudar os
// itens cancela; o Enter com o campo vazio entrega os itens ao pai, que compara com os de
// antes (fecha sem chamada, ou confirma a troca de um valor fora do tipo).
export function ListEditor({ propKey, slug, initial, label, onCommit, onCancel }: {
  propKey: string
  slug: string
  initial: string[]
  label: string
  onCommit(items: string[]): void
  onCancel(): void
}) {
  const { t } = useI18n()
  const menuId = useId()
  const closed = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)
  // Os itens de quando abriu, para saber se mudou: `initial` chega novo a cada render do pai.
  const [start] = useState(initial)
  const [items, setItems] = useState(initial)
  const [text, setText] = useState('')
  const [active, setActive] = useState(-1)
  // O texto do campo passou do limite ao tentar adicionar: o aviso fica até o texto mudar.
  const [tooLong, setTooLong] = useState(false)
  // `undefined`: carregando; `null`: a busca falhou (sem sugestões, e criar continua).
  const [suggestions, setSuggestions] = useState<string[] | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    void fetchPropertyValues(slug, propKey).then(values => {
      if (!alive) return
      setSuggestions(values)
      // As opções mudaram de lugar: a ativa apontaria para outra.
      setActive(-1)
    })
    return () => {
      alive = false
    }
  }, [slug, propKey])

  // Normalizadas uma vez por carga, não a cada tecla.
  const normalized = useMemo(
    () => (suggestions ?? []).map(value => ({ value, search: normalizeForSearch(value) })),
    [suggestions],
  )

  const query = text.trim()
  const needle = normalizeForSearch(query)
  const found = normalized.filter(s => !items.includes(s.value) && s.search.includes(needle))
  // O valor igual ao digitado (ignorando caixa e acento) vem primeiro: com o limite, ele não
  // pode ficar de fora do menu, onde o "Criar" também não aparece para ele.
  const matches = needle === ''
    ? found
    : [...found.filter(s => s.search === needle), ...found.filter(s => s.search !== needle)]
  // As que ficaram de fora do limite: a linha "Mais n" no fim das sugestões, que não é opção
  // (fica fora de `options`, então as setas e o Enter nunca a pegam).
  const hidden = Math.max(0, matches.length - MAX_SUGGESTIONS)
  const suggested: ListOption[] = matches
    .slice(0, MAX_SUGGESTIONS)
    .map(s => ({ value: s.value, create: false }))
  const createOption: ListOption | null =
    query !== '' && !items.includes(query) && !(suggestions ?? []).includes(query)
      ? { value: query, create: true }
      : null
  // Na ordem do menu, e o índice das setas: as sugestões, depois o "Criar".
  const options = createOption ? [...suggested, createOption] : suggested
  const loading = suggestions === undefined
  const open = loading || options.length > 0
  const current = active < options.length ? active : -1
  const optionId = (i: number) => `${menuId}-${i}`

  // A opção ativa pelas setas fica à vista no menu, que rola.
  useEffect(() => {
    if (current >= 0) menuRef.current?.querySelector('.is-active')?.scrollIntoView?.({ block: 'nearest' })
  }, [current])

  function finish(how: 'enter' | 'leave' | 'escape') {
    if (closed.current) return
    closed.current = true
    if (how === 'escape') return onCancel()
    if (how === 'leave' && sameValue(items, start)) return onCancel()
    onCommit(items)
  }

  // Item repetido não entra (comparação exata; os itens e as sugestões já vêm aparados).
  // Item grande demais também não: o texto fica no campo, para encurtar, com o aviso. O pai
  // ainda recusa ao gravar (um item assim pode vir do disco).
  function add(value: string) {
    if (value.trim().length > MAX_PROPERTY_TEXT) {
      setTooLong(true)
      return
    }
    setText('')
    setActive(-1)
    setTooLong(false)
    if (value !== '' && !items.includes(value)) setItems([...items, value])
  }

  // O que o Enter sem opção ativa adiciona. O valor que já existe igual ao digitado, ignorando
  // caixa e acento ("acao" e "Ação"), vence a query, para o Enter não criar um quase-duplicado
  // que passaria a ser sugerido a todo editor do vault: se já está entre os itens, não entra
  // nada (`''` limpa o campo); se é uma sugestão, entra a sugestão. O "Criar" fica nas setas,
  // para quem quer mesmo o valor sem acento. Não pega a primeira opção do menu: "RPG" não vira
  // "RPG Tático".
  function enterValue(): string {
    if (items.some(i => normalizeForSearch(i) === needle)) return ''
    const exact = normalized.find(s => s.value === query)
    return (exact ?? normalized.find(s => s.search === needle))?.value ?? query
  }

  // Pelo índice: um valor do disco pode ter item repetido.
  function remove(index: number) {
    setItems(items.filter((_, i) => i !== index))
    setActive(-1)
  }

  // `i` é o índice em `options`, o mesmo das setas e do Enter.
  function renderOption(o: ListOption, i: number) {
    return (
      <li
        key={(o.create ? '+' : '=') + o.value}
        id={optionId(i)}
        role="option"
        aria-selected={i === current}
        className={'vault-prop-option' + (i === current ? ' is-active' : '')}
        onMouseDown={keepFocus}
        onClick={() => add(o.value)}
      >
        {o.create ? t('properties.edit.create', { value: o.value }) : o.value}
      </li>
    )
  }

  return (
    <div
      className="vault-prop-multiselect"
      onMouseDown={e => {
        // Clique num chip, no espaço entre eles ou no menu: o foco fica no campo.
        if (e.target !== inputRef.current) e.preventDefault()
      }}
      onKeyDown={e => {
        // Esc vale também com o foco num ×.
        if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
          e.preventDefault()
          finish('escape')
        }
      }}
      onBlur={e => {
        // focusout: o foco que vai para um × do próprio editor não fecha.
        const next = e.relatedTarget
        if (next instanceof Node && e.currentTarget.contains(next)) return
        // Alt-tab ou troca de aba também dispara focusout (com relatedTarget nulo): a janela
        // sem foco não é "terminei". O editor fica aberto, e o navegador devolve o foco ao campo.
        if (!document.hasFocus()) return
        finish('leave')
      }}
    >
      {items.map((item, i) => (
        <span key={i + '\u0000' + item} className="vault-prop-chip" data-color={propertyColor(propKey, item)}>
          {item}
          <button
            type="button"
            className="vault-prop-chip-remove"
            aria-label={t('properties.edit.remove', { value: item })}
            onMouseDown={keepFocus}
            onClick={() => {
              // Pelo teclado o foco estava no ×, que sai da tela: volta ao campo antes.
              inputRef.current?.focus()
              remove(i)
            }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        className="vault-prop-input vault-prop-list-input"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        // Fechado, o menu não está no DOM: o aria-controls apontaria para um id ausente.
        aria-controls={open ? menuId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={current >= 0 ? optionId(current) : undefined}
        placeholder={t('properties.edit.listPlaceholder')}
        autoFocus
        // Sem maxLength: ele cortaria a colagem em silêncio. O `add` recusa o item grande demais
        // com o aviso.
        value={text}
        onChange={e => {
          setText(e.target.value)
          setActive(-1)
          setTooLong(false)
        }}
        onKeyDown={e => {
          // Durante a composição (IME), as teclas são da composição.
          if (e.nativeEvent.isComposing) return
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const n = options.length
            if (n === 0) return
            if (e.key === 'ArrowDown') setActive((current + 1) % n)
            else setActive(current <= 0 ? n - 1 : current - 1)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            if (current >= 0) add(options[current].value)
            else if (query !== '') add(enterValue())
            else finish('enter')
          } else if (e.key === 'Backspace' && text === '' && items.length > 0) {
            e.preventDefault()
            remove(items.length - 1)
          }
        }}
      />
      {/* Dentro da caixa, numa linha própria: o menu abre logo abaixo dela e não o cobre. */}
      {tooLong ? <span className="vault-prop-error" role="alert">{t('properties.error.tooLong')}</span> : null}
      {open ? (
        <ul ref={menuRef} id={menuId} className="vault-prop-menu is-open" role="listbox" aria-label={label}>
          {loading ? (
            <li className="vault-prop-option is-loading" role="option" aria-disabled="true" aria-selected="false">
              {t('properties.edit.loading')}
            </li>
          ) : null}
          {suggested.map((o, i) => renderOption(o, i))}
          {/* Não é opção: sem id, fora do índice das setas, sem clique. */}
          {hidden > 0 ? (
            <li className="vault-prop-option is-more" role="option" aria-disabled="true" aria-selected="false">
              {t('properties.edit.more', { n: hidden })}
            </li>
          ) : null}
          {createOption ? renderOption(createOption, suggested.length) : null}
        </ul>
      ) : null}
    </div>
  )
}

// Confirmação de troca de um valor que não é do tipo da propriedade, dentro da própria
// linha (nunca `confirm()`). Quem põe o foco no Cancelar é o PropertiesBlock, e só quando o
// foco já estava na linha: quem saiu do editor clicando em outro lugar não o perde.
export function ConfirmReplace({ typeLabel, onConfirm, onCancel }: {
  typeLabel: string
  onConfirm(): void
  onCancel(): void
}) {
  const { t } = useI18n()
  const textId = useId()
  return (
    <div
      className="vault-prop-confirm"
      role="group"
      aria-labelledby={textId}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
    >
      <span id={textId}>{t('properties.edit.mismatch', { type: typeLabel })}</span>
      <button type="button" className="vault-prop-btn is-primary" onClick={onConfirm}>
        {t('properties.edit.replace')}
      </button>
      <button type="button" className="vault-prop-btn" onClick={onCancel}>{t('common.cancel')}</button>
    </div>
  )
}
