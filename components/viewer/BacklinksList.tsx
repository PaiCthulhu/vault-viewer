'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useI18n } from '@/components/i18n/I18nProvider'
import type { BuildGraph } from '@/builder/types'

interface BacklinksListProps {
  slug: string
  currentPath: string
  graphData: BuildGraph
  /** When true, render only the body without the internal "Mencionado em" header. */
  headless?: boolean
}

export function BacklinksList({ slug, currentPath, graphData, headless }: BacklinksListProps) {
  const router = useRouter()
  const { t } = useI18n()

  const backlinks = useMemo(() => {
    const sourceIds = graphData.edges
      .filter(e => e.target === currentPath)
      .map(e => e.source)
    return sourceIds
      .map(id => graphData.nodes.find(n => n.id === id))
      .filter((n): n is NonNullable<typeof n> => n !== undefined)
  }, [graphData, currentPath])

  if (backlinks.length === 0) {
    // Headless: GraphPanel keeps the section visible, so show an empty state.
    if (headless) {
      return (
        <div className="px-4 py-3">
          <p className="text-[0.8rem]" style={{ color: 'var(--text-muted)' }}>
            {t('backlinks.empty')}
          </p>
        </div>
      )
    }
    return null
  }

  return (
    <div className={headless ? 'px-4 py-3' : 'px-4 py-3 border-t'} style={headless ? undefined : { borderColor: 'var(--border)' }}>
      {!headless && (
        <p className="text-[0.75rem] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
          {t('backlinks.title')}
        </p>
      )}
      <ul className="space-y-1">
        {backlinks.map(node => (
          <li key={node.id}>
            <button
              onClick={() => router.push(`/vault/${slug}/${node.id.split('/').map(encodeURIComponent).join('/')}`)}
              className="text-[0.83rem] text-left w-full hover:underline"
              style={{ color: 'rgb(165,168,255)' }}
            >
              {node.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
