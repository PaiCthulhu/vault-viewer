'use client'

import { useI18n } from '@/components/i18n/I18nProvider'
import type { TocEntry } from '@/lib/toc'

interface TocListProps {
  toc: TocEntry[]
  /** When true, render only the body without the internal "Índice" header. */
  headless?: boolean
}

export function TocList({ toc, headless }: TocListProps) {
  const { t } = useI18n()
  if (toc.length === 0) return null

  const minLevel = Math.min(...toc.map(e => e.level))

  function handleClick(e: React.MouseEvent, id: string) {
    e.preventDefault()
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="px-4 py-3">
      {!headless && (
        <p className="text-[0.75rem] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
          {t('toc.title')}
        </p>
      )}
      <ul className="space-y-0.5">
        {toc.map((entry, i) => (
          <li key={`${entry.id}-${i}`}>
            <a
              href={`#${entry.id}`}
              onClick={e => handleClick(e, entry.id)}
              title={entry.text}
              className="toc-entry block w-full truncate text-left text-[0.8rem] transition-colors"
              style={{ color: 'var(--text-muted)', paddingLeft: `${(entry.level - minLevel) * 12}px` }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
