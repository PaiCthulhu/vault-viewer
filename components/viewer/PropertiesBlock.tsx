'use client'

import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '@/components/i18n/I18nProvider'
import type { PageProperty, PropertyType, PropertyValue } from '@/builder/types'
import { ConfirmReplace, ListEditor, ScalarEditor, SelectEditor } from '@/components/viewer/PropertyEditors'
import { patchProperty } from '@/lib/property-client'
import {
  MAX_PROPERTY_TEXT, initialChecked, initialItems, initialText, isEditable, isListType, listDraftValue,
  provisionalRow, sameValue, textDraftValue, visibleText, type ScalarEditorType,
} from '@/lib/property-edit'
import {
  NO_LOCAL_PROPERTIES, localWins, mergeProperties, pruneLocalProperties, staleValues, withLocal,
  type LocalProperties, type LocalProperty,
} from '@/lib/property-local'

// Bloco Propriedades, montado no segmento `properties` (o slot que o builder deixa no HTML).
// Usa a mesma marcação e as mesmas classes do <details> que o builder gravava no HTML, para
// o CSS de antes servir, e acrescenta o rótulo de valor vazio e o cadeado das linhas
// travadas. Com `edit`, quem edita o vault muda os valores ali mesmo; sem `edit`, a saída é
// a de leitura, sem controle nenhum.

// O valor vem escapado pelo builder. Memoizado pelo `html`: um refresh com o mesmo valor
// não reaplica o innerHTML, e o nó fica como estava.
const PropValue = memo(function PropValue({ html, className }: { html: string; className?: string }) {
  const inner = useMemo(() => ({ __html: html }), [html])
  const ref = useRef<HTMLSpanElement>(null)
  // Link externo abre em nova aba, como os da nota. O efeito do ContentPanel só roda quando
  // o HTML da página muda; um valor novo que chega num refresh com o mesmo corpo cai aqui.
  useEffect(() => {
    ref.current?.querySelectorAll<HTMLAnchorElement>('a[href^="http://"], a[href^="https://"]').forEach(a => {
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener noreferrer')
    })
  }, [html])
  return <span ref={ref} className={className} dangerouslySetInnerHTML={inner} />
})

// Cadeado de uma linha travada. A dica sai do motivo; um motivo que este código não conhece
// cai na dica genérica, para o cadeado nunca aparecer sem texto.
const LOCK_HINTS: Record<string, string> = {
  readonly: 'properties.locked.readonly',
  object: 'properties.locked.object',
  image: 'properties.locked.image',
}

function LockIcon({ reason }: { reason: string }) {
  const { t } = useI18n()
  const hint = t(Object.hasOwn(LOCK_HINTS, reason) ? LOCK_HINTS[reason] : 'properties.locked')
  return (
    <span className="vault-prop-lock" role="img" data-lock={reason} title={hint} aria-label={hint}>
      <svg
        aria-hidden="true" viewBox="0 0 24 24" width="1em" height="1em" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      >
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
    </span>
  )
}

// Vazia: sem valor, lista vazia ou HTML vazio.
const isEmpty = (p: PageProperty) =>
  p.value === null || (Array.isArray(p.value) && p.value.length === 0) || p.html === ''

export interface PropertiesEditContext {
  slug: string
  // Caminho da nota, sem `.md`.
  pagePath: string
}

// O que está aberto. Um por vez: abrir outro troca este, e uma confirmação pendente some
// sem gravar. `base` é a linha mostrada quando o editor abriu: o `expected` da gravação.
type Active =
  | { key: string; mode: 'edit'; base: PageProperty }
  | { key: string; mode: 'confirm'; base: PageProperty; value: PropertyValue }

interface Notice {
  key: string
  errorKey: string
}

function scalarType(type: PropertyType): ScalarEditorType | null {
  return type === 'text' || type === 'number' || type === 'date' || type === 'datetime' ? type : null
}

// O valor de uma linha `select` aparado, ou null quando vazio, em branco ou não for texto.
function selectInitial(p: PageProperty): string | null {
  return typeof p.value === 'string' && p.value.trim() !== '' ? p.value.trim() : null
}

// Há texto selecionado (não colapsado) que começa ou termina dentro de `el`.
function selectsInside(el: Element): boolean {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed) return false
  return [sel.anchorNode, sel.focusNode].some(n => n !== null && el.contains(n))
}

// Para onde o foco volta quando o editor ou a confirmação fecha pelo teclado: o Cancelar de
// uma confirmação aberta, senão o controle da linha.
const FOCUS_CONFIRM = '.vault-prop-confirm .vault-prop-btn:not(.is-primary)'
const FOCUS_CONTROL = '.vault-prop-editable, input.vault-prop-checkbox'

// Fechado por padrão, sem estado React para `open`: o React não toca no atributo, então
// um <details> aberto continua aberto quando a página recebe propriedades novas.
// `showLocks`: o cadeado só interessa a quem pode editar; o leitor não o vê.
export function PropertiesBlock({ properties, showLocks = true, edit }: {
  properties: PageProperty[]
  showLocks?: boolean
  edit?: PropertiesEditContext
}) {
  const { t } = useI18n()

  const [local, setLocal] = useState<LocalProperties>(NO_LOCAL_PROPERTIES)
  const [active, setActive] = useState<Active | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  // Chegou um `properties` novo (refresh depois do build): esquece o local que ele já traz.
  const [seen, setSeen] = useState(properties)
  if (seen !== properties) {
    setSeen(properties)
    setLocal(l => pruneLocalProperties(properties, l))
  }

  // O `properties` mais recente, para o que roda depois de um `await` (a resposta da API
  // pode chegar depois de um refresh).
  const serverRef = useRef(properties)
  useEffect(() => {
    serverRef.current = properties
  }, [properties])

  const rows = useMemo(() => mergeProperties(properties, local), [properties, local])

  // A linha cujo editor ou confirmação fechou com o foco dentro (Enter, Esc, um botão pelo
  // teclado). O input ou o botão some da tela, e o foco cairia no body. Quando fechou pelo
  // blur (o usuário clicou em outro lugar), o foco já está indo para lá e fica onde está.
  const bodyRef = useRef<HTMLDivElement>(null)
  const focusRow = useRef<HTMLElement | null>(null)
  // Se já havia texto selecionado no valor quando o botão desceu: então o click é sobre uma
  // seleção que já existia (o Chromium só a desfaz depois do click) e abre o editor.
  const selectedAtDown = useRef(false)
  useEffect(() => {
    const row = focusRow.current
    if (!row) return
    focusRow.current = null
    const now = document.activeElement
    if (!row.isConnected || (now && now !== document.body && !row.contains(now))) return
    const target = row.querySelector<HTMLElement>(FOCUS_CONFIRM) ?? row.querySelector<HTMLElement>(FOCUS_CONTROL)
    target?.focus()
  })

  function rememberFocus() {
    const el = document.activeElement
    focusRow.current = el instanceof HTMLElement && bodyRef.current?.contains(el) ? el.closest('.vault-prop') : null
  }

  const isSaving = (key: string) => local.get(key)?.saving === true

  function openEditor(p: PageProperty) {
    if (isSaving(p.key)) return
    setNotice(null)
    setActive({ key: p.key, mode: 'edit', base: p })
  }

  function cancel() {
    rememberFocus()
    setActive(null)
  }

  function commitText(base: PageProperty, type: ScalarEditorType, text: string, unchanged: boolean) {
    rememberFocus()
    // Enter sem mexer no campo: nada a gravar. Numa linha fora do tipo, segue para a
    // confirmação: ali o Enter é o pedido de converter o valor.
    if (unchanged && !base.mismatch) {
      setActive(null)
      return
    }
    const draft = textDraftValue(type, text)
    if (!draft.ok) {
      setActive(null)
      setNotice({ key: base.key, errorKey: draft.errorKey })
      return
    }
    commitValue(base, draft.value)
  }

  // Lista: sem mudança (os mesmos itens, na mesma ordem) é como o Enter sem mudança do
  // texto: fecha, ou segue para a confirmação numa linha fora do tipo.
  function commitList(base: PageProperty, items: string[]) {
    rememberFocus()
    // O campo não corta a colagem (sem maxLength): o item grande demais é recusado aqui, com o
    // mesmo aviso do texto.
    if (items.some(i => i.trim().length > MAX_PROPERTY_TEXT)) {
      setActive(null)
      setNotice({ key: base.key, errorKey: 'properties.error.tooLong' })
      return
    }
    if (!base.mismatch && sameValue(items, initialItems(base))) {
      setActive(null)
      return
    }
    commitValue(base, listDraftValue(items))
  }

  // Seleção única: o mesmo valor de antes (aparado) só fecha, sem chamada; o × manda `null`.
  function commitSelect(base: PageProperty, value: string | null) {
    rememberFocus()
    if (value === null) return commitValue(base, null)
    if (value === selectInitial(base)) {
      setActive(null)
      return
    }
    const draft = textDraftValue('text', value)
    if (!draft.ok) {
      setActive(null)
      setNotice({ key: base.key, errorKey: draft.errorKey })
      return
    }
    commitValue(base, draft.value)
  }

  // O valor já pronto para gravar. Um valor fora do tipo pede confirmação antes; o mesmo
  // valor de antes só fecha, sem chamada.
  function commitValue(base: PageProperty, value: PropertyValue) {
    if (base.mismatch) setActive({ key: base.key, mode: 'confirm', base, value })
    else if (sameValue(value, base.value)) setActive(null)
    else void save(base, value)
  }

  function toggle(p: PageProperty) {
    if (isSaving(p.key)) return
    const value = !initialChecked(p)
    if (p.mismatch) {
      rememberFocus()
      setNotice(null)
      setActive({ key: p.key, mode: 'confirm', base: p, value })
    } else {
      void save(p, value)
    }
  }

  // Mostra o valor novo na hora e grava. A linha provisória fica até a resposta; depois, a
  // que a API devolveu, enquanto o servidor ainda mostrar um valor de antes (`stale`).
  async function save(base: PageProperty, value: PropertyValue) {
    if (!edit) return
    const key = base.key
    const serverAtStart = serverRef.current
    const serverRow = serverAtStart.find(p => p.key === key)
    const prev = local.get(key)
    const entry: LocalProperty = {
      row: provisionalRow(base, value),
      stale: staleValues(prev, serverRow, base),
      saving: true,
    }
    setLocal(l => withLocal(l, key, entry))
    setActive(null)
    setNotice(null)

    const res = await patchProperty(edit.slug, {
      path: edit.pagePath, key, value, expected: base.value, confirm: base.mismatch === true || undefined,
    })
    // Comparado com o servidor de agora: se o build já trouxe o valor, o local sai. Sem refresh
    // desde que a gravação começou, a entrada fica mesmo que o servidor (a linha de antes) já
    // seja igual ao valor: o build da gravação anterior ainda pode chegar com um valor
    // intermediário (marcar e desmarcar), e sem a entrada ele apareceria por alguns segundos.
    // Quem a tira é o `pruneLocalProperties`, quando chega um `properties` que já a alcançou.
    const now = serverRef.current.find(p => p.key === key)
    const refreshed = serverRef.current !== serverAtStart
    const keep = (e: LocalProperty) => (!refreshed || (now && localWins(e, now)) ? e : undefined)
    if (res.ok) {
      const saved = res.property
      setLocal(l => withLocal(l, key, keep({ row: saved, stale: entry.stale, saving: false })))
    } else if (res.status === 409 && res.property) {
      // O valor mudou em outro lugar: a linha mostra o que está no disco, e o próximo editor
      // parte dele (e o manda como `expected`).
      const current = res.property
      setLocal(l => withLocal(l, key, keep({ row: current, stale: entry.stale, saving: false })))
      setNotice({ key, errorKey: res.errorKey })
    } else {
      setLocal(l => withLocal(l, key, prev))
      setNotice({ key, errorKey: res.errorKey })
    }
  }

  function renderRow(p: PageProperty) {
    const keyCell = (
      <span className="vault-prop-key">
        {p.key}
        {showLocks && p.locked ? <LockIcon reason={p.locked} /> : null}
      </span>
    )
    const message = edit && notice?.key === p.key
      ? <span className="vault-prop-error" role="alert">{t(notice.errorKey)}</span>
      : null

    const editable = edit !== undefined && isEditable(p)
    if (!editable) {
      const value = isEmpty(p)
        ? <span className="vault-prop-val vault-prop-empty">{t('properties.empty')}</span>
        : <PropValue html={p.html} className="vault-prop-val" />
      return (
        <div key={p.key} className="vault-prop">
          {keyCell}
          {message ? <div className="vault-prop-val-wrap">{value}{message}</div> : value}
        </div>
      )
    }

    const saving = isSaving(p.key)
    const mine = active?.key === p.key ? active : null
    const scalar = scalarType(p.type)
    const shown = isEmpty(p)
      ? <span className="vault-prop-empty">{t('properties.empty')}</span>
      : <PropValue html={p.html} />

    let value: ReactNode
    if (p.type === 'checkbox') {
      value = (
        <span className="vault-prop-val">
          {/* aria-disabled, e não disabled, durante o salvamento: um checkbox desabilitado perde
              o foco de quem o marcou pelo teclado. O `toggle` ignora o clique, e o input
              controlado volta sozinho ao valor mostrado. */}
          <input
            type="checkbox" className="vault-prop-checkbox" checked={initialChecked(p)}
            aria-disabled={saving || undefined} aria-label={p.key} onChange={() => toggle(p)}
          />
          {/* Fora do tipo (`done: yes`): o valor de verdade fica ao lado, apagado. */}
          {p.mismatch && !isEmpty(p) ? <span className="vault-prop-current">{shown}</span> : null}
        </span>
      )
    } else if (mine?.mode === 'edit' && p.select) {
      const base = mine.base
      value = (
        <SelectEditor
          propKey={p.key} slug={edit.slug} initial={selectInitial(base)} colors={p.colors}
          label={t('properties.edit.label', { key: p.key })}
          onCommit={v => commitSelect(base, v)} onCancel={cancel}
        />
      )
    } else if (mine?.mode === 'edit' && scalar) {
      const base = mine.base
      value = (
        <ScalarEditor
          type={scalar} initial={initialText(base)} label={t('properties.edit.label', { key: p.key })}
          onCommit={(text, { unchanged }) => commitText(base, scalar, text, unchanged)} onCancel={cancel}
        />
      )
    } else if (mine?.mode === 'edit' && isListType(p.type)) {
      const base = mine.base
      value = (
        <ListEditor
          propKey={p.key} slug={edit.slug} initial={initialItems(base)} colors={p.colors}
          label={t('properties.edit.label', { key: p.key })}
          onCommit={items => commitList(base, items)} onCancel={cancel}
        />
      )
    } else if (mine?.mode === 'confirm') {
      value = <span className="vault-prop-val vault-prop-current">{shown}</span>
    } else {
      value = (
        <div
          className="vault-prop-val vault-prop-editable"
          role="button"
          tabIndex={0}
          // O nome leva o valor: sem ele, o leitor de tela anunciaria só "Editar <chave>".
          aria-label={t('properties.edit.open', {
            key: p.key, value: isEmpty(p) ? t('properties.empty') : visibleText(p.html),
          })}
          aria-disabled={saving || undefined}
          onMouseDown={e => { selectedAtDown.current = selectsInside(e.currentTarget) }}
          onClick={e => {
            const hadSelection = selectedAtDown.current
            selectedAtDown.current = false
            // Clique num link do valor é do link: o ContentPanel navega.
            if (e.target instanceof Element && e.target.closest('a')) return
            // Arrastar sobre o texto do valor (para copiar) termina num click: abrir o editor
            // apagaria a seleção. Só a seleção feita neste gesto segura o clique; um clique
            // sobre uma seleção que já existia abre. Enter e Espaço abrem sempre.
            if (!hadSelection && selectsInside(e.currentTarget)) return
            openEditor(p)
          }}
          onKeyDown={e => {
            if (e.target !== e.currentTarget) return
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              openEditor(p)
            }
          }}
        >
          {shown}
        </div>
      )
    }

    return (
      <div
        key={p.key}
        className={'vault-prop' + (mine ? ' is-editing' : '') + (saving ? ' is-saving' : '')}
        aria-busy={saving ? 'true' : undefined}
      >
        {keyCell}
        <div className="vault-prop-val-wrap">
          {value}
          {saving ? <span className="vault-prop-saving">{t('properties.edit.saving')}</span> : null}
          {mine?.mode === 'confirm' ? (
            <ConfirmReplace
              typeLabel={t('properties.type.' + mine.base.type)}
              onConfirm={() => {
                rememberFocus()
                void save(mine.base, mine.value)
              }}
              onCancel={cancel}
            />
          ) : null}
          {message}
        </div>
      </div>
    )
  }

  return (
    <details className="vault-properties">
      <summary className="vault-properties-summary">
        <span className="vault-properties-chevron">▸</span>
        <span>{t('properties.title')}</span>
      </summary>
      <div ref={bodyRef} className="vault-properties-body">
        {rows.map(renderRow)}
      </div>
    </details>
  )
}
