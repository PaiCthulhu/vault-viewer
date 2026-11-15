'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useI18n } from '@/components/i18n/I18nProvider'
import { nextPollDelay, MIN_REFRESH_GAP_MS, MAX_REFRESHES } from '@/lib/page-status-poll'

interface Props {
  slug: string
  pagePath: string
  mode: 'generating' | 'updating'
}

// Consulta a rota de status até a página ficar pronta. Em `ready` ou `missing` chama
// router.refresh() e segue consultando: o servidor devolve a página sem pendência e este
// componente deixa de ser montado.
export function PageStatusNotice({ slug, pagePath, mode }: Props) {
  const router = useRouter()
  const { t } = useI18n()
  const [gaveUp, setGaveUp] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let refreshes = 0
    let lastRefreshAt = -Infinity
    const start = Date.now()
    const url = `/api/vault/${encodeURIComponent(slug)}/page-status?path=${encodeURIComponent(pagePath)}`

    async function poll() {
      try {
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) return
        const { state } = (await res.json()) as { state?: string }
        if (cancelled || (state !== 'ready' && state !== 'missing')) return
        // Teto: no mínimo 5 s entre refreshes e no máximo 3 sem o componente desmontar.
        if (Date.now() - lastRefreshAt < MIN_REFRESH_GAP_MS) return
        refreshes++
        lastRefreshAt = Date.now()
        router.refresh()
      } catch {
        // falha de rede: tenta de novo na próxima rodada
      }
    }

    function schedule() {
      const delay = nextPollDelay(Date.now() - start)
      if (delay === null || refreshes >= MAX_REFRESHES) {
        setGaveUp(true)
        return
      }
      timer = setTimeout(async () => {
        await poll()
        if (!cancelled) schedule()
      }, delay)
    }

    schedule()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [slug, pagePath, router])

  if (mode === 'updating') {
    if (gaveUp) return null
    // Sobreposta e sem altura no layout: ao sumir, o texto não pula.
    return (
      <div className="page-status-overlay">
        <div className="page-status-pill" role="status" aria-live="polite">
          <span className="page-status-spinner" aria-hidden="true" />
          {t('pending.updating')}
        </div>
      </div>
    )
  }

  return (
    <div className="vault-article page-status-block" role="status" aria-live="polite">
      {!gaveUp && <span className="page-status-spinner" aria-hidden="true" />}
      <span>{gaveUp ? t('pending.giveUp') : t('pending.generating')}</span>
    </div>
  )
}
