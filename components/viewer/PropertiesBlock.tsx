'use client'

import { memo, useEffect, useMemo, useRef } from 'react'
import { useI18n } from '@/components/i18n/I18nProvider'
import type { PageProperty } from '@/builder/types'

// Bloco Propriedades de leitura, montado no segmento `properties` (o slot que o builder
// deixa no HTML). Versão mínima: a mesma marcação e as mesmas classes do <details> que o
// builder gravava no HTML, para o CSS de antes servir.

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

// Fechado por padrão, sem estado React para `open`: o React não toca no atributo, então
// um <details> aberto continua aberto quando a página recebe propriedades novas.
export function PropertiesBlock({ properties }: { properties: PageProperty[] }) {
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
            <span className="vault-prop-key">{p.key}</span>
            <PropValue html={p.html} />
          </div>
        ))}
      </div>
    </details>
  )
}
