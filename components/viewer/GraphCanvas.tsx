'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useI18n } from '@/components/i18n/I18nProvider'
import type { BuildGraph } from '@/builder/types'
import type cytoscape from 'cytoscape'

interface GraphCanvasProps {
  slug: string
  graphData: BuildGraph
  currentPath: string
}

export function GraphCanvas({ slug, graphData, currentPath }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cyRef = useRef<any>(null)
  const router = useRouter()
  const { t } = useI18n()

  // Compute the local neighborhood around the current page.
  const local = useMemo(() => {
    const hasNode = graphData.nodes.some(n => n.id === currentPath)
    if (!hasNode) return null

    // First-degree neighbors (either direction).
    const firstDegree = new Set<string>()
    for (const e of graphData.edges) {
      if (e.source === currentPath) firstDegree.add(e.target)
      if (e.target === currentPath) firstDegree.add(e.source)
    }

    if (firstDegree.size === 0) return null

    // Obsidian-style local graph: just the current node and its direct
    // neighbors (who points to it + who it points to).
    const visible = new Set<string>([currentPath, ...firstDegree])

    const nodes = graphData.nodes.filter(n => visible.has(n.id))
    const edges = graphData.edges.filter(e => visible.has(e.source) && visible.has(e.target))

    return { nodes, edges }
  }, [graphData, currentPath])

  useEffect(() => {
    if (!containerRef.current || !local) return

    const elements = [
      ...local.nodes.map(n => ({
        data: {
          id: n.id,
          label: n.label,
          current: n.id === currentPath ? 1 : 0,
        },
      })),
      ...local.edges.map(e => ({
        data: { id: `${e.source}--${e.target}`, source: e.source, target: e.target },
      })),
    ]

    // Resolve concrete colors from the document — cytoscape does NOT support CSS vars.
    const styles = getComputedStyle(document.documentElement)
    const accent = styles.getPropertyValue('--accent').trim() || '#6366f1'
    const text = styles.getPropertyValue('--text').trim() || '#e2e8f0'

    import('cytoscape').then(({ default: cytoscape }) => {
      if (!containerRef.current) return

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
              'font-size': '7px' as unknown as string,
              width: 10,
              height: 10,
              'text-valign': 'bottom' as const,
              'text-margin-y': 3,
              'text-wrap': 'ellipsis' as const,
              'text-max-width': '80px' as unknown as string,
              opacity: 0.65,
            },
          },
          {
            selector: 'node[current > 0]',
            style: {
              'background-color': '#ffffff' as string,
              'border-color': accent,
              'border-width': 2,
              width: 16,
              height: 16,
              opacity: 1,
              'font-size': '9px' as unknown as string,
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
          // Deterministic layout: current node centered, neighbors around it.
          // (cose is force-directed and rearranges differently on each load.)
          name: 'concentric',
          animate: false,
          concentric: (n: { data: (k: string) => unknown }) =>
            (n.data('current') as number) > 0 ? 2 : 1,
          levelWidth: () => 1,
          minNodeSpacing: 28,
          spacingFactor: 1.1,
        } as unknown as cytoscape.LayoutOptions,
      })

      cyRef.current.on('tap', 'node', (event: { target: { id: () => string } }) => {
        const id = event.target.id()
        router.push(`/vault/${slug}/${id.split('/').map(encodeURIComponent).join('/')}`)
      })
    })

    return () => {
      if (cyRef.current) {
        cyRef.current.destroy()
        cyRef.current = null
      }
    }
  }, [local, currentPath, slug, router])

  if (!local) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-[0.8rem]" style={{ color: 'var(--text-muted)' }}>
          {t('graph.noConnections')}
        </p>
      </div>
    )
  }

  return <div ref={containerRef} className="graph-canvas" />
}
