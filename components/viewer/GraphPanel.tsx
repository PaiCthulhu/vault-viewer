'use client'

import { useState, useEffect } from 'react'
import { useI18n } from '@/components/i18n/I18nProvider'
import { GraphCanvas } from './GraphCanvas'
import { BacklinksList } from './BacklinksList'
import { TocList } from './TocList'
import type { BuildGraph } from '@/builder/types'
import type { TocEntry } from '@/lib/toc'

interface GraphPanelProps {
  slug: string
  graphData: BuildGraph
  currentPath: string
  toc: TocEntry[]
}

// Module-level collapse store: survives SPA navigation remounts (GraphPanel
// remounts on every navigation), but resets on a full page reload / re-login
// since the module is re-imported fresh.
type SectionKey = 'graph' | 'toc' | 'backlinks'
const collapsed: Record<SectionKey, boolean> = { graph: false, toc: false, backlinks: false }

interface SectionHeaderProps {
  title: string
  open: boolean
  onToggle: () => void
}

function SectionHeader({ title, open, onToggle }: SectionHeaderProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center p-3 border-b shrink-0 text-left"
      style={{ borderColor: 'var(--border)' }}
    >
      <span
        className="mr-1.5 text-[0.7rem] leading-none"
        style={{ color: 'var(--text-muted)' }}
        aria-hidden
      >
        {open ? '▾' : '▸'}
      </span>
      <span className="text-[0.75rem] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        {title}
      </span>
    </button>
  )
}

export function GraphPanel({ slug, graphData, currentPath, toc }: GraphPanelProps) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  // Mirror the module-level store into React state for reactivity.
  const [, force] = useState(0)
  const toggle = (k: SectionKey) => {
    collapsed[k] = !collapsed[k]
    force(n => n + 1)
  }

  // Close the expanded graph on Escape.
  useEffect(() => {
    if (!expanded) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setExpanded(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [expanded])

  return (
    <div className="flex h-full flex-col" style={{ borderLeft: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
      {/* Grafo local */}
      <SectionHeader title={t('graph.local')} open={!collapsed.graph} onToggle={() => toggle('graph')} />
      {!collapsed.graph && (
        // Graph area — the expand (magnifier) button reveals on hover.
        <div className="group relative shrink-0" style={{ height: '30%', minHeight: 180, maxHeight: '30%' }}>
          <GraphCanvas
            slug={slug}
            graphData={graphData}
            currentPath={currentPath}
          />
          <button
            onClick={() => setExpanded(true)}
            title={t('graph.expand')}
            aria-label={t('graph.expand')}
            className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-md border opacity-0 transition group-hover:opacity-100"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text-muted)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
          >
            🔍
          </button>
        </div>
      )}

      {/* Índice + Mencionado em scroll together while the graph stays put. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Índice — hidden entirely when there are no entries. */}
        {toc.length > 0 && (
          <>
            <SectionHeader title={t('toc.title')} open={!collapsed.toc} onToggle={() => toggle('toc')} />
            {!collapsed.toc && <TocList toc={toc} headless />}
          </>
        )}

        {/* Mencionado em — always visible (informative even when empty). */}
        <SectionHeader title={t('backlinks.title')} open={!collapsed.backlinks} onToggle={() => toggle('backlinks')} />
        {!collapsed.backlinks && (
          <BacklinksList
            slug={slug}
            currentPath={currentPath}
            graphData={graphData}
            headless
          />
        )}
      </div>

      {/* Expanded graph lightbox */}
      {expanded && (
        <div
          className="vault-lightbox"
          onClick={() => setExpanded(false)}
        >
          <div
            className="relative flex flex-col overflow-hidden rounded-lg border"
            style={{
              width: '88vw',
              height: '88vh',
              background: 'var(--bg)',
              borderColor: 'var(--border)',
              cursor: 'default',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div
              className="flex shrink-0 items-center border-b px-4 py-2.5"
              style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}
            >
              <p className="text-[0.75rem] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                {t('graph.local')}
              </p>
              <button
                onClick={() => setExpanded(false)}
                title={t('graph.close')}
                aria-label={t('graph.close')}
                className="ml-auto text-lg leading-none transition"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <GraphCanvas
                slug={slug}
                graphData={graphData}
                currentPath={currentPath}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
