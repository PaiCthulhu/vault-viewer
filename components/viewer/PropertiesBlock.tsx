'use client'

import { memo, useEffect, useMemo, useRef } from 'react'
import { useI18n } from '@/components/i18n/I18nProvider'
import type { PageProperty } from '@/builder/types'

// Bloco Propriedades (somente leitura por enquanto), montado no segmento `properties` (o
// slot que o builder deixa no HTML). Usa a mesma marcação e as mesmas classes do <details>
// que o builder gravava no HTML, para o CSS de antes servir, e acrescenta o rótulo de valor
// vazio e o cadeado das linhas travadas. A edição das propriedades vai morar aqui.

// O valor vem escapado pelo builder. Memoizado pelo `html`: um refresh com o mesmo valor
// não reaplica o innerHTML, e o nó fica como estava.
const PropValue = memo(function PropValue({ html }: { html: string }) {
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
  return <span ref={ref} className="vault-prop-val" dangerouslySetInnerHTML={inner} />
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

// Fechado por padrão, sem estado React para `open`: o React não toca no atributo, então
// um <details> aberto continua aberto quando a página recebe propriedades novas.
// `showLocks`: o cadeado só interessa a quem pode editar; o leitor não o vê.
export function PropertiesBlock({ properties, showLocks = true }: { properties: PageProperty[]; showLocks?: boolean }) {
  const { t } = useI18n()
  return (
    <details className="vault-properties">
      <summary className="vault-properties-summary">
        <span className="vault-properties-chevron">▸</span>
        <span>{t('properties.title')}</span>
      </summary>
      <div className="vault-properties-body">
        {properties.map(p => (
          <div key={p.key} className="vault-prop">
            <span className="vault-prop-key">
              {p.key}
              {showLocks && p.locked ? <LockIcon reason={p.locked} /> : null}
            </span>
            {isEmpty(p)
              ? <span className="vault-prop-val vault-prop-empty">{t('properties.empty')}</span>
              : <PropValue html={p.html} />}
          </div>
        ))}
      </div>
    </details>
  )
}
