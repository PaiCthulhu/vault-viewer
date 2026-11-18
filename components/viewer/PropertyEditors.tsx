'use client'

import { useEffect, useId, useMemo, useRef, useState, type MouseEvent, type Ref } from 'react'
import { useI18n } from '@/components/i18n/I18nProvider'
import type { RelationEntry } from '@/builder/types'
import { fetchPropertyOptions, fetchPropertyValues } from '@/lib/property-client'
import { chipColor, type ChosenColors } from '@/lib/property-color'
import {
  candidateOf, relationCreate, relationEnterPick, relationExclude, removeHints,
} from '@/lib/property-relation'
import { itemLabel } from '@/lib/wikilink-label'
import {
  MAX_PROPERTY_TEXT, enterPick, menuEntries, menuModel, sameValue,
  type MenuModel, type ScalarEditorType,
} from '@/lib/property-edit'

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

// Menu de opções (lista e seleção única): "Carregando", as sugestões, a linha "Mais n" e o
// "Criar". Só desenha: o estado (texto, opção ativa, itens) é de quem o usa. `active` é o
// índice em [sugestões..., "Criar"], o mesmo das setas e do Enter; `onPick` recebe o valor.
export function OptionMenu({ id, label, menuRef, loading, model, active, optionId, onPick, propKey, colors, createNote }: {
  id: string
  label: string
  menuRef?: Ref<HTMLUListElement>
  loading: boolean
  model: MenuModel
  active: number
  optionId(i: number): string
  onPick(value: string): void
  propKey: string
  colors?: ChosenColors
  // Relação: o "Criar" é uma nota nova (`[[nome]]`), e o chip mostra o nome, não o `[[...]]`.
  createNote?: boolean
}) {
  const { t } = useI18n()
  // `i` é o índice em [sugestões..., "Criar"].
  function renderOption(value: string, create: boolean, i: number) {
    const chip = (
      <span className="vault-prop-chip" data-color={chipColor(propKey, value, colors)}>
        {create && !createNote ? value : itemLabel(value)}
      </span>
    )
    // O "Criar" mostra o texto digitado cru (o chip é o que ele vai ser; o nome só aparece
    // depois de criado). O modelo da frase vem sem variáveis e é partido em `{value}`.
    // Em relação, o modelo é o de "Criar nota {name}".
    const [before, after = ''] = create
      ? t(createNote ? 'properties.edit.createNote' : 'properties.edit.create').split(createNote ? '{name}' : '{value}')
      : []
    return (
      <li
        key={(create ? '+' : '=') + value}
        id={optionId(i)}
        role="option"
        aria-selected={i === active}
        className={'vault-prop-option' + (i === active ? ' is-active' : '')}
        onMouseDown={keepFocus}
        onClick={() => onPick(value)}
      >
        {create ? <>{before}{chip}{after}</> : chip}
      </li>
    )
  }

  return (
    <ul ref={menuRef} id={id} className="vault-prop-menu is-open" role="listbox" aria-label={label}>
      {loading ? (
        <li className="vault-prop-option is-loading" role="option" aria-disabled="true" aria-selected="false">
          {t('properties.edit.loading')}
        </li>
      ) : null}
      {model.suggested.map((v, i) => renderOption(v, false, i))}
      {/* Não é opção: sem id, fora do índice das setas, sem clique. */}
      {model.hidden > 0 ? (
        <li className="vault-prop-option is-more" role="option" aria-disabled="true" aria-selected="false">
          {t('properties.edit.more', { n: model.hidden })}
        </li>
      ) : null}
      {model.create !== null ? renderOption(model.create, true, model.suggested.length) : null}
    </ul>
  )
}

// Seleção múltipla de uma propriedade de lista (multitext, tags, aliases): os itens como
// chips, um campo para buscar ou criar e o menu de sugestões, que são os valores que o vault
// já usa nessa chave (uma busca por abertura). Os itens e o texto moram aqui até fechar: um
// refresh da página não os toca.
//
// Fecha uma vez só, como o ScalarEditor. Sair (o foco vai para fora do editor) sem mudar os
// itens cancela; o Enter com o campo vazio entrega os itens ao pai, que compara com os de
// antes (fecha sem chamada, ou confirma a troca de um valor fora do tipo).
export function ListEditor({ propKey, slug, initial, label, colors, relation, onCommit, onCancel }: {
  propKey: string
  slug: string
  colors?: ChosenColors
  // Linha de relação: as sugestões são as notas da pasta e criar é `[[nome]]`.
  relation?: boolean
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
  // O índice de relação (candidatos e o que cada item resolve); `null` sem relação ou sem índice.
  const [rel, setRel] = useState<RelationEntry | null>(null)

  useEffect(() => {
    let alive = true
    const done = (values: string[] | null, relationEntry: RelationEntry | null) => {
      if (!alive) return
      setSuggestions(values)
      setRel(relationEntry)
      // As opções mudaram de lugar: a ativa apontaria para outra.
      setActive(-1)
    }
    if (relation) {
      void fetchPropertyOptions(slug, propKey).then(o =>
        done(o ? (o.relation?.candidates.map(c => c.link) ?? []) : null, o?.relation ?? null))
    } else {
      void fetchPropertyValues(slug, propKey).then(values => done(values, null))
    }
    return () => {
      alive = false
    }
  }, [slug, propKey, relation])

  // Normalizadas uma vez por carga, não a cada tecla.
  const entries = useMemo(() => menuEntries(suggestions ?? []), [suggestions])

  const query = text.trim()
  const baseModel = menuModel(entries, text, relation
    ? { exclude: relationExclude(rel, items), taken: items }
    : { exclude: items, taken: items })
  // Na relação o "Criar" é a nota nova (`[[nome]]`), nunca o texto cru.
  const model = relation ? { ...baseModel, create: relationCreate(text, rel, items) } : baseModel
  // Na ordem do menu, e o índice das setas: as sugestões, depois o "Criar".
  const options = model.create !== null ? [...model.suggested, model.create] : model.suggested
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

  // Pelo índice: um valor do disco pode ter item repetido.
  function remove(index: number) {
    setItems(items.filter((_, i) => i !== index))
    setActive(-1)
  }

  // Dois chips de mesmo nome (`[[A]]` e `[[B|A]]`) não se distinguem pelo nome: o × leva uma dica.
  const hints = removeHints(items, item => (relation && rel ? candidateOf(item, rel) : null) ?? item)

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
        <span key={i + '\u0000' + item} className="vault-prop-chip" data-color={chipColor(propKey, item, colors)}>
          {itemLabel(item)}
          <button
            type="button"
            className="vault-prop-chip-remove"
            aria-label={hints[i] !== null
              ? t('properties.edit.removeAt', { value: itemLabel(item), path: hints[i] })
              : t('properties.edit.remove', { value: itemLabel(item) })}
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
            if (current >= 0) add(options[current])
            else if (query !== '') {
              if (relation) {
                // Nota já escolhida: só limpa o campo, como na lista comum. Nome que não serve
                // (ou de uma nota da pasta, que o menu já mostra): nada entra e o texto fica.
                const pick = relationEnterPick(entries, text, items, rel)
                if (pick !== null) add('value' in pick ? pick.value : '')
              } else {
                // Já entre os itens: não entra nada, só limpa o campo.
                const pick = enterPick(entries, text, items)
                add(pick.chosen ? '' : pick.value)
              }
            }
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
        <OptionMenu
          id={menuId} label={label} menuRef={menuRef} loading={loading} model={model}
          active={current} optionId={optionId} onPick={add} propKey={propKey} colors={colors}
          createNote={relation}
        />
      ) : null}
    </div>
  )
}

// O encanamento do combobox (busca das sugestões, modelo, opção ativa, scroll, blur/alt-tab e teclado)
// espelha o do ListEditor: uma correção num precisa ser conferida no outro.
// Seleção única de uma propriedade `select` (declarada no .vaultwright): o valor atual como
// um chip com ×, um campo para buscar ou criar e o menu com os valores que o vault já usa
// nessa chave. Escolher (clique ou Enter) entrega o valor ao pai na hora; o × entrega `null`.
//
// Fecha uma vez só, como o ListEditor. O valor atual fica entre as opções (escolhê-lo só
// fecha, o pai compara), mas não pode ser "criado" de novo. Sair sem escolher cancela; o
// Enter com o campo vazio entrega o valor de antes (o pai fecha sem chamada).
export function SelectEditor({ propKey, slug, initial, colors, label, onCommit, onCancel }: {
  propKey: string
  slug: string
  initial: string | null
  colors?: ChosenColors
  label: string
  onCommit(value: string | null): void
  onCancel(): void
}) {
  const { t } = useI18n()
  const menuId = useId()
  const closed = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)
  const [text, setText] = useState('')
  const [active, setActive] = useState(-1)
  // O texto passou do limite ao tentar escolher: o aviso fica até o texto mudar.
  const [tooLong, setTooLong] = useState(false)
  // `undefined`: carregando; `null`: a busca falhou (sem sugestões, e criar continua).
  const [suggestions, setSuggestions] = useState<string[] | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    void fetchPropertyValues(slug, propKey).then(values => {
      if (!alive) return
      setSuggestions(values)
      setActive(-1)
    })
    return () => {
      alive = false
    }
  }, [slug, propKey])

  const entries = useMemo(() => menuEntries(suggestions ?? []), [suggestions])
  const chosen = initial ? [initial] : []

  const query = text.trim()
  const model = menuModel(entries, text, { exclude: [], taken: chosen })
  const options = model.create !== null ? [...model.suggested, model.create] : model.suggested
  const loading = suggestions === undefined
  const open = loading || options.length > 0
  const current = active < options.length ? active : -1
  const optionId = (i: number) => `${menuId}-${i}`

  useEffect(() => {
    if (current >= 0) menuRef.current?.querySelector('.is-active')?.scrollIntoView?.({ block: 'nearest' })
  }, [current])

  function finish(how: 'commit' | 'cancel', value: string | null = null) {
    if (closed.current) return
    closed.current = true
    if (how === 'cancel') return onCancel()
    onCommit(value)
  }

  // Texto grande demais não grava: fica no campo, para encurtar, com o aviso. O pai ainda
  // recusa ao gravar.
  function pick(value: string) {
    if (value.trim().length > MAX_PROPERTY_TEXT) {
      setTooLong(true)
      return
    }
    finish('commit', value)
  }

  return (
    <div
      className="vault-prop-multiselect vault-prop-select"
      onMouseDown={e => {
        if (e.target !== inputRef.current) e.preventDefault()
      }}
      onKeyDown={e => {
        if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
          e.preventDefault()
          finish('cancel')
        }
      }}
      onBlur={e => {
        const next = e.relatedTarget
        if (next instanceof Node && e.currentTarget.contains(next)) return
        // Alt-tab ou troca de aba: a janela sem foco não é "terminei".
        if (!document.hasFocus()) return
        finish('cancel')
      }}
    >
      {initial ? (
        <span className="vault-prop-chip" data-color={chipColor(propKey, initial, colors)}>
          {itemLabel(initial)}
          <button
            type="button"
            className="vault-prop-chip-remove"
            aria-label={t('properties.edit.remove', { value: itemLabel(initial) })}
            onMouseDown={keepFocus}
            // Grava na hora, sem devolver o foco ao campo: o editor fecha e o `rememberFocus` do
            // `commitSelect` devolve o foco à linha.
            onClick={() => finish('commit', null)}
          >
            ×
          </button>
        </span>
      ) : null}
      <input
        ref={inputRef}
        className="vault-prop-input vault-prop-list-input"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={current >= 0 ? optionId(current) : undefined}
        placeholder={t('properties.edit.listPlaceholder')}
        autoFocus
        value={text}
        onChange={e => {
          setText(e.target.value)
          setActive(-1)
          setTooLong(false)
        }}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const n = options.length
            if (n === 0) return
            if (e.key === 'ArrowDown') setActive((current + 1) % n)
            else setActive(current <= 0 ? n - 1 : current - 1)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            if (current >= 0) pick(options[current])
            else if (query !== '') pick(enterPick(entries, text, chosen).value)
            else finish('commit', initial)
          }
        }}
      />
      {tooLong ? <span className="vault-prop-error" role="alert">{t('properties.error.tooLong')}</span> : null}
      {open ? (
        <OptionMenu
          id={menuId} label={label} menuRef={menuRef} loading={loading} model={model}
          active={current} optionId={optionId} onPick={pick} propKey={propKey} colors={colors}
        />
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
