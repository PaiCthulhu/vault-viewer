'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createPageWatcher, isUserBusy, type PageWatcher as Watcher, type WatchStatus } from '@/lib/page-watch'

// Sem resposta em 10 s a consulta é abandonada (conta como "sem novidade"); senão uma
// requisição pendurada deixaria o vigia travado para sempre.
const FETCH_TIMEOUT_MS = 10_000

// Vigia da aba: dá router.refresh() quando um rebuild muda a página aberta.
// A lógica de quando consultar mora em lib/page-watch.ts; aqui só se liga ao documento.
export function PageWatcher({ slug, pagePath, version }: { slug: string; pagePath: string; version: string }): null {
  const router = useRouter()
  const versionRef = useRef(version)
  const watcherRef = useRef<Watcher | null>(null)
  const lastInteractionRef = useRef(-Infinity)

  // Declarado antes do efeito do vigia: ele lê a versão atual ao ser recriado.
  useEffect(() => {
    versionRef.current = version
  }, [version])

  useEffect(() => {
    const url = '/api/vault/' + encodeURIComponent(slug) + '/page-version?path=' + encodeURIComponent(pagePath)
    const fetchStatus = async (): Promise<WatchStatus | null> => {
      // AbortController + setTimeout (e não AbortSignal.timeout) para o relógio falso dos testes valer.
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
      try {
        const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal })
        if (!res.ok) return null
        const body = (await res.json()) as Partial<WatchStatus> | null
        // Corpo fora do formato (ex.: {}) é falha, não versão nova.
        if (!body || (typeof body.version !== 'string' && body.version !== null) || typeof body.building !== 'boolean') return null
        return { version: body.version, building: body.building }
      } catch {
        return null
      } finally {
        clearTimeout(timer)
      }
    }

    // Criado aqui dentro: stop() é terminal e o StrictMode roda efeito, limpeza, efeito.
    const watcher = createPageWatcher(versionRef.current, {
      fetchStatus,
      refresh: () => router.refresh(),
      isVisible: () => document.visibilityState === 'visible',
      isBusy: () => isUserBusy(document, lastInteractionRef.current, Date.now()),
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: h => clearTimeout(h as ReturnType<typeof setTimeout>),
    })
    watcherRef.current = watcher

    const onVisibility = () => {
      if (document.visibilityState === 'visible') watcher.becameVisible()
      else watcher.becameHidden()
    }
    const onFocus = () => watcher.becameVisible()
    const onInteraction = () => {
      lastInteractionRef.current = Date.now()
    }
    const interactionEvents = ['keydown', 'input', 'change', 'pointerdown'] as const

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    for (const ev of interactionEvents) document.addEventListener(ev, onInteraction, true)

    watcher.start()

    return () => {
      watcher.stop()
      watcherRef.current = null
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      for (const ev of interactionEvents) document.removeEventListener(ev, onInteraction, true)
    }
  }, [slug, pagePath, router])

  useEffect(() => {
    watcherRef.current?.setVersion(version)
  }, [version])

  return null
}
