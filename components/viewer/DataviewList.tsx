'use client'

import { useState, useMemo } from 'react'
import { useI18n } from '@/components/i18n/I18nProvider'

interface DataviewListProps {
  items: unknown[]
  vault: string
}

export function DataviewList({ items }: DataviewListProps) {
  const { t } = useI18n()
  const [search, setSearch] = useState('')

  const stringItems = useMemo(() => items.map(i => String(i ?? '')), [items])

  const filtered = useMemo(() => {
    if (!search) return stringItems
    const q = search.toLowerCase()
    return stringItems.filter(s => s.toLowerCase().includes(q))
  }, [stringItems, search])

  return (
    <div className="dv-wrapper">
      <div className="dv-controls">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('dv.filterList')}
          className="dv-search"
        />
      </div>
      <ul className="dv-list">
        {filtered.map((item, i) => (
          <li key={i} dangerouslySetInnerHTML={{ __html: item }} />
        ))}
      </ul>
      <p className="dv-count">{t(filtered.length === 1 ? 'dv.itemsOne' : 'dv.itemsMany', { count: filtered.length })}</p>
    </div>
  )
}
