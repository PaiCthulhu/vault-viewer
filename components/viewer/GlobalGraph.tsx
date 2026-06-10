'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useI18n } from '@/components/i18n/I18nProvider'
import type { BuildGraph } from '@/builder/types'
import type cytoscape from 'cytoscape'

interface GlobalGraphProps {
  slug: string
  graphData: BuildGraph
  currentPath: string
  onClose: () => void
}

export function GlobalGraph({ slug, graphData, currentPath, onClose }: GlobalGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cyRef = useRef<any>(null)
  const router = useRouter()
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)

  // Keep the latest onClose without making it an effect dependency — otherwise
  // every parent re-render (e.g. resizing the sidebar) would pass a new function
  // reference and rebuild the whole graph from scratch (expensive cose relayout).
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!containerRef.current) return

    setLoading(true)

    const elements = [
      ...graphData.nodes.map(n => ({
        data: {
          id: n.id,
          label: n.label,
          current: n.id === currentPath ? 1 : 0,
        },
      })),
      ...graphData.edges.map(e => ({
        data: { id: `${e.source}--${e.target}`, source: e.source, target: e.target },
      })),
    ]

    // Resolve concrete colors from the document — cytoscape does NOT support CSS vars.
    const styles = getComputedStyle(document.documentElement)
    const accent = styles.getPropertyValue('--accent').trim() || '#6366f1'
    const text = styles.getPropertyValue('--text').trim() || '#e2e8f0'

    let cancelled = false
    let raf1 = 0
    let raf2 = 0
    let observer: ResizeObserver | null = null

    function build() {
      import('cytoscape').then(({ default: cytoscape }) => {
      if (cancelled || !containerRef.current) return

      if (cyRef.current) cyRef.current.destroy()

      cyRef.current = cytoscape({
        container: containerRef.current,
        elements,
        style: [
          {
            selector: 'node',
            style: {
              'background-color': accent,
              label: 'data(label)' as string,
              color: text,
              'font-size': '5px' as unknown as string,
              width: 8,
              height: 8,
              'text-valign': 'bottom' as const,
              'text-margin-y': 2,
              'text-wrap': 'ellipsis' as const,
              'text-max-width': '60px' as unknown as string,
              opacity: 0.65,
            },
          },
          {
            selector: 'node[current > 0]',
            style: {
              'background-color': '#ffffff' as string,
              'border-color': accent,
              'border-width': 2,
              width: 14,
              height: 14,
              opacity: 1,
              'font-size': '8px' as unknown as string,
            },
          },
          {
            selector: 'edge',
            style: {
              width: 1,
              'line-color': 'rgba(99,102,241,0.2)' as string,
              'curve-style': 'bezier' as const,
              opacity: 0.5,
              'arrow-scale': 0.5,
              'target-arrow-shape': 'triangle' as const,
              'target-arrow-color': 'rgba(99,102,241,0.3)' as string,
            },
          },
        ],
        layout: {
          // Force-directed layout for the full graph. Non-deterministic per run,
          // but acceptable for an explicit global view (not the local graph).
          name: 'cose',
          animate: false,
          randomize: false,
          nodeRepulsion: 8000,
          idealEdgeLength: 60,
          gravity: 0.4,
          numIter: 1000,
        } as unknown as cytoscape.LayoutOptions,
      })

      // Fit the whole graph into the viewport once laid out.
      cyRef.current.fit(undefined, 30)

      // Layout (cose with animate:false) is synchronous and has completed by now;
      // the fit has been applied — reveal the graph and drop the loading overlay.
      if (!cancelled) setLoading(false)

      cyRef.current.on('tap', 'node', (event: { target: { id: () => string } }) => {
        const id = event.target.id()
        onCloseRef.current()
        router.push(`/vault/${slug}/${id.split('/').map(encodeURIComponent).join('/')}`)
      })

      // Sidebar/panel resizes change the container width without a window
      // resize. Re-measure + re-center the camera (the same trick as the local
      // graph) WITHOUT recomputing the layout.
      observer = new ResizeObserver(() => {
        const cy = cyRef.current
        if (!cy) return
        cy.resize()
        cy.center()
      })
      observer.observe(containerRef.current)
      })
    }

    // cytoscape is likely already cached (from the local graph), so import()
    // resolves in a microtask and the synchronous cose layout would block before
    // the browser paints the loading overlay. Defer the heavy work two frames so
    // the "Carregando N nós…" overlay paints first.
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(build)
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      observer?.disconnect()
      if (cyRef.current) {
        cyRef.current.destroy()
        cyRef.current = null
      }
    }
  }, [graphData, currentPath, slug, router])

  return (
    <div className="global-graph" style={{ position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            fontSize: '1.1rem',
            pointerEvents: 'none',
          }}
        >
          {t('graph.loading', { count: graphData.nodes.length })}
        </div>
      )}
    </div>
  )
}
