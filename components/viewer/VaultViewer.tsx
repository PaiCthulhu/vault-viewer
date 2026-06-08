'use client'

import { useState, useEffect } from 'react'
import { useI18n } from '@/components/i18n/I18nProvider'
import { Topbar } from '@/components/shared/Topbar'
import { SidebarPanel } from './SidebarPanel'
import { ContentPanel } from './ContentPanel'
import { GraphPanel } from './GraphPanel'
import { GlobalGraph } from './GlobalGraph'
import { DrawerOverlay } from './DrawerOverlay'
import type { PageMeta, BuildGraph, PageSummary } from '@/builder/types'
import type { TreeNode } from '@/lib/vault-tree'
import type { VaultConfig } from '@/types'
import type { HtmlSegment } from '@/lib/parse-html-segments'
import type { TocEntry } from '@/lib/toc'

interface VaultViewerProps {
  vault: VaultConfig
  page: PageMeta
  segments: HtmlSegment[]
  toc: TocEntry[]
  pagesIndex: PageSummary[]
  tree: TreeNode[]
  graphData: BuildGraph
  username: string
  isAdmin: boolean
}

export function VaultViewer({
  vault,
  page,
  segments,
  toc,
  pagesIndex,
  tree,
  graphData,
  username,
  isAdmin,
}: VaultViewerProps) {
  const { t } = useI18n()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [graphOpen, setGraphOpen] = useState(false)
  const [globalGraph, setGlobalGraph] = useState(false)

  // Close the global graph view on Escape.
  useEffect(() => {
    if (!globalGraph) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setGlobalGraph(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [globalGraph])

  const isWidePage = Array.isArray(page.frontmatter?.cssclasses)
    ? (page.frontmatter.cssclasses as string[]).includes('wide-page')
    : String(page.frontmatter?.cssclasses ?? '').includes('wide-page')

  function closeAll() {
    setSidebarOpen(false)
    setGraphOpen(false)
  }

  return (
    <div className="flex flex-col" style={{ height: '100vh', background: 'var(--bg)' }}>
      <Topbar
        username={username}
        isAdmin={isAdmin}
        vaultName={vault.name}
        vaultSlug={vault.slug}
        pageName={page.title}
        onSidebarToggle={() => { setGraphOpen(false); setSidebarOpen(o => !o) }}
        onGraphToggle={() => { setSidebarOpen(false); setGraphOpen(o => !o) }}
      />

      <div className="vault-panels flex flex-1 min-h-0 flex-row overflow-hidden">
        {/* Sidebar — hidden on mobile by default, drawer via .is-open */}
        <aside
          className={`vault-sidebar hidden md:flex md:flex-col md:w-[22%] md:min-w-[190px] md:max-w-[310px]${sidebarOpen ? ' is-open' : ''}`}
          style={{ height: '100%' }}
        >
          <SidebarPanel
            slug={vault.slug}
            currentPath={page.path}
            pages={pagesIndex}
            tree={tree}
            onOpenGlobalGraph={() => setGlobalGraph(true)}
          />
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 overflow-hidden">
          {globalGraph ? (
            <div className="global-graph-wrap">
              <div className="global-graph-toolbar">
                <span className="global-graph-title">{t('graph.global')}</span>
                <button
                  className="global-graph-close"
                  onClick={() => setGlobalGraph(false)}
                  title={t('graph.closeEsc')}
                >
                  {t('graph.closeLabel')}
                </button>
              </div>
              <div className="global-graph-body">
                <GlobalGraph
                  slug={vault.slug}
                  graphData={graphData}
                  currentPath={page.path}
                  onClose={() => setGlobalGraph(false)}
                />
              </div>
            </div>
          ) : (
            <ContentPanel
              segments={segments}
              css={page.css}
              isWidePage={isWidePage}
              slug={vault.slug}
            />
          )}
        </main>

        {/* Graph panel — hidden on mobile by default, drawer via .is-open.
            Hidden entirely while the global graph view is active (redundant). */}
        {!globalGraph && (
          <aside
            className={`vault-graph-panel hidden md:flex md:flex-col md:w-[24%] md:min-w-[210px] md:max-w-[340px]${graphOpen ? ' is-open' : ''}`}
            style={{ height: '100%' }}
          >
            <GraphPanel
              slug={vault.slug}
              graphData={graphData}
              currentPath={page.path}
              toc={toc}
            />
          </aside>
        )}
      </div>

      {/* Mobile overlay */}
      {(sidebarOpen || graphOpen) && <DrawerOverlay onClick={closeAll} />}
    </div>
  )
}
