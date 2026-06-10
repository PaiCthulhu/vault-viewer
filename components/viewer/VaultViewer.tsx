'use client'

import { useState, useEffect } from 'react'
import { useI18n } from '@/components/i18n/I18nProvider'
import { Topbar } from '@/components/shared/Topbar'
import { SidebarPanel } from './SidebarPanel'
import { ContentPanel } from './ContentPanel'
import { GraphPanel } from './GraphPanel'
import { GlobalGraph } from './GlobalGraph'
import { DrawerOverlay } from './DrawerOverlay'
import { PanelResizer, PanelRail } from './PanelResizer'
import { MobilePanelFab } from './MobilePanelFab'
import { usePanelLayout } from './usePanelLayout'
import { PANEL_COLLAPSED_RAIL } from '@/lib/panel-layout'
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
  const {
    layout,
    hydrated,
    setSidebarWidth,
    setGraphWidth,
    toggleSidebarCollapsed,
    toggleGraphCollapsed,
  } = usePanelLayout()

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
      />

      <div className="vault-panels flex flex-1 min-h-0 flex-row overflow-hidden">
        {/* Sidebar — hidden on mobile by default, drawer via .is-open.
            On desktop: resizable (PanelResizer) and collapsible to a rail. */}
        <aside
          className={`vault-sidebar relative hidden md:flex md:flex-col${sidebarOpen ? ' is-open' : ''}${hydrated && layout.sidebarCollapsed ? ' is-collapsed' : ''}`}
          style={{
            height: '100%',
            ...(hydrated
              ? { ['--panel-w' as string]: `${layout.sidebarCollapsed ? PANEL_COLLAPSED_RAIL : layout.sidebarWidth}px` }
              : {}),
          }}
        >
          <div className="vault-panel-body">
            <SidebarPanel
              slug={vault.slug}
              currentPath={page.path}
              pages={pagesIndex}
              tree={tree}
              onOpenGlobalGraph={() => setGlobalGraph(true)}
            />
          </div>
          <PanelRail side="left" onExpand={toggleSidebarCollapsed} label={t('panel.expandSidebar')} />
        </aside>

        {/* Resize divider between sidebar and content (desktop only; hidden when
            the sidebar is collapsed — the rail handles re-expanding then). */}
        {!(hydrated && layout.sidebarCollapsed) && (
          <PanelResizer
            side="left"
            width={layout.sidebarWidth}
            onResize={setSidebarWidth}
            onCollapse={toggleSidebarCollapsed}
            resizeLabel={t('panel.resize')}
            collapseLabel={t('panel.collapseSidebar')}
          />
        )}

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

        {/* Resize divider between content and graph panel (desktop only; hidden
            while the global graph is open or the panel is collapsed). */}
        {!globalGraph && !(hydrated && layout.graphCollapsed) && (
          <PanelResizer
            side="right"
            width={layout.graphWidth}
            onResize={setGraphWidth}
            onCollapse={toggleGraphCollapsed}
            resizeLabel={t('panel.resize')}
            collapseLabel={t('panel.collapseGraph')}
          />
        )}

        {/* Graph panel — hidden on mobile by default, drawer via .is-open.
            Hidden entirely while the global graph view is active (redundant). */}
        {!globalGraph && (
          <aside
            className={`vault-graph-panel relative hidden md:flex md:flex-col${graphOpen ? ' is-open' : ''}${hydrated && layout.graphCollapsed ? ' is-collapsed' : ''}`}
            style={{
              height: '100%',
              ...(hydrated
                ? { ['--panel-w' as string]: `${layout.graphCollapsed ? PANEL_COLLAPSED_RAIL : layout.graphWidth}px` }
                : {}),
            }}
          >
            <div className="vault-panel-body">
              <GraphPanel
                slug={vault.slug}
                graphData={graphData}
                currentPath={page.path}
                toc={toc}
              />
            </div>
            <PanelRail side="right" onExpand={toggleGraphCollapsed} label={t('panel.expandGraph')} />
          </aside>
        )}
      </div>

      {/* Mobile: floating edge buttons that open the drawers (replaces the old
          crowded topbar ☰ / ⬡ buttons). Hidden while the global graph is open. */}
      {!globalGraph && (
        <>
          <MobilePanelFab
            side="left"
            label={t('topbar.openSidebar')}
            hidden={sidebarOpen}
            onClick={() => { setGraphOpen(false); setSidebarOpen(true) }}
          >
            ☰
          </MobilePanelFab>
          <MobilePanelFab
            side="right"
            label={t('topbar.openGraph')}
            hidden={graphOpen}
            onClick={() => { setSidebarOpen(false); setGraphOpen(true) }}
          >
            ⬡
          </MobilePanelFab>
        </>
      )}

      {/* Mobile overlay */}
      {(sidebarOpen || graphOpen) && <DrawerOverlay onClick={closeAll} />}
    </div>
  )
}
