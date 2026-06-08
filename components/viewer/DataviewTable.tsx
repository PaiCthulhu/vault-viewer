'use client'

import { useState, useMemo } from 'react'
import { useI18n } from '@/components/i18n/I18nProvider'

interface DataviewTableProps {
  columns: string[]
  rows: unknown[][]
  vault: string
}

export function DataviewTable({ columns, rows }: DataviewTableProps) {
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState<number | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const stringRows = useMemo(
    () => rows.map(row => row.map(cell => String(cell ?? ''))),
    [rows],
  )

  const filtered = useMemo(() => {
    let r = stringRows
    if (search) {
      const q = search.toLowerCase()
      r = r.filter(row => row.some(cell => cell.toLowerCase().includes(q)))
    }
    if (sortCol !== null) {
      const idx = sortCol
      r = [...r].sort((a, b) =>
        sortDir === 'asc'
          ? (a[idx] ?? '').localeCompare(b[idx] ?? '', 'pt-BR')
          : (b[idx] ?? '').localeCompare(a[idx] ?? '', 'pt-BR'),
      )
    }
    return r
  }, [stringRows, search, sortCol, sortDir])

  function toggleSort(i: number) {
    if (sortCol === i) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortCol(i); setSortDir('asc') }
  }

  return (
    <div className="dv-wrapper">
      <div className="dv-controls">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('dv.filterTable')}
          className="dv-search"
        />
      </div>
      <div className="dv-table-scroll">
        <table className="dv-table">
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th key={i} onClick={() => toggleSort(i)}>
                  {col}
                  {sortCol === i ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} dangerouslySetInnerHTML={{ __html: cell }} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="dv-count">{t(filtered.length === 1 ? 'dv.resultsOne' : 'dv.resultsMany', { count: filtered.length })}</p>
    </div>
  )
}
