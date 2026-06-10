'use client'

import { useState, useEffect, type ReactNode } from 'react'
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
  /** Optional control rendered on the right of the header (e.g. the graph's expand button). */
  action?: ReactNode
}

function SectionHeader({ title, open, onToggle, action }: SectionHeaderProps) {
  return (
    <div className="flex items-center border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex flex-1 items-center p-3 text-left"
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
      {action}
    </div>
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
      {/* Grafo local — expand (magnifier) button lives in the header so it works
          on touch (mobile) too, not just on hover. */}
      <SectionHeader
        title={t('graph.local')}
        open={!collapsed.graph}
        onToggle={() => toggle('graph')}
        action={
          !collapsed.graph ? (
            <button
              onClick={() => setExpanded(true)}
              title={t('graph.expand')}
              aria-label={t('graph.expand')}
              className="mr-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text-muted)' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
            >
              🔍
            </button>
          ) : undefined
        }
      />
      {!collapsed.graph && (
        <div className="shrink-0" style={{ height: '30%', minHeight: 180, maxHeight: '30%' }}>
          <GraphCanvas
            slug={slug}
            graphData={graphData}
            currentPath={currentPath}
          />
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
            className="graph-lightbox-box relative flex flex-col overflow-hidden rounded-lg border"
            style={{
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
