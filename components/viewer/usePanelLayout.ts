'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  clampWidth,
  defaultLayout,
  parseLayout,
  serializeLayout,
  PANEL_LAYOUT_KEY,
  type PanelLayout,
} from '@/lib/panel-layout'

// Viewport used only for the deterministic first (SSR + pre-hydration) render.
// Real width/localStorage are read in useEffect after mount; until then the CSS
// percentage fallbacks (`var(--panel-w, 22%)`) keep the layout looking correct.
const SSR_VIEWPORT = 1920

export interface UsePanelLayout {
  layout: PanelLayout
  /** False until localStorage/viewport have been read on the client. */
  hydrated: boolean
  setSidebarWidth: (w: number) => void
  setGraphWidth: (w: number) => void
  toggleSidebarCollapsed: () => void
  toggleGraphCollapsed: () => void
}

export function usePanelLayout(): UsePanelLayout {
  const [layout, setLayout] = useState<PanelLayout>(() => defaultLayout(SSR_VIEWPORT))
  const [hydrated, setHydrated] = useState(false)

  // Load persisted layout (or derive from the real viewport) once on the client.
  useEffect(() => {
    const raw = window.localStorage.getItem(PANEL_LAYOUT_KEY)
    setLayout(parseLayout(raw, window.innerWidth))
    setHydrated(true)
  }, [])

  // Persist after hydration so the SSR fallback never clobbers stored values.
  useEffect(() => {
    if (!hydrated) return
    window.localStorage.setItem(PANEL_LAYOUT_KEY, serializeLayout(layout))
  }, [layout, hydrated])

  const setSidebarWidth = useCallback((w: number) => {
    setLayout((l) => ({ ...l, sidebarWidth: clampWidth(w) }))
  }, [])

  const setGraphWidth = useCallback((w: number) => {
    setLayout((l) => ({ ...l, graphWidth: clampWidth(w) }))
  }, [])

  const toggleSidebarCollapsed = useCallback(() => {
    setLayout((l) => ({ ...l, sidebarCollapsed: !l.sidebarCollapsed }))
  }, [])

  const toggleGraphCollapsed = useCallback(() => {
    setLayout((l) => ({ ...l, graphCollapsed: !l.graphCollapsed }))
  }, [])

  return { layout, hydrated, setSidebarWidth, setGraphWidth, toggleSidebarCollapsed, toggleGraphCollapsed }
}
