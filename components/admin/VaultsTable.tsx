'use client'

import { useI18n } from '@/components/i18n/I18nProvider'
import type { VaultRow } from '@/lib/vault-admin'

interface Props {
  vaults: VaultRow[]
  selectedSlug: string | null
  onSelect: (vault: VaultRow) => void
}

export function VaultsTable({ vaults, selectedSlug, onSelect }: Props) {
  const { t, locale } = useI18n()
  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-[0.9rem]">
        <thead>
          <tr className="sticky top-0 border-b" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
            <th className="px-4 py-2.5 text-left text-[0.72rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{t('admin.vaults.colName')}</th>
            <th className="px-4 py-2.5 text-left text-[0.72rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{t('admin.vaults.colPath')}</th>
            <th className="px-4 py-2.5 text-left text-[0.72rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{t('admin.vaults.colHome')}</th>
            <th className="px-4 py-2.5 text-left text-[0.72rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{t('admin.vaults.colPages')}</th>
            <th className="px-4 py-2.5 text-left text-[0.72rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{t('admin.vaults.colLastBuild')}</th>
          </tr>
        </thead>
        <tbody>
          {vaults.map((v) => (
            <tr
              key={v.slug}
              onClick={() => onSelect(v)}
              className="cursor-pointer border-b transition"
              style={{
                borderColor: 'var(--border)',
                background: selectedSlug === v.slug ? 'rgba(99,102,241,0.1)' : undefined,
              }}
              onMouseEnter={(e) => { if (selectedSlug !== v.slug) (e.currentTarget as HTMLElement).style.background = 'rgba(127,127,127,0.06)' }}
              onMouseLeave={(e) => { if (selectedSlug !== v.slug) (e.currentTarget as HTMLElement).style.background = '' }}
            >
              <td className="px-4 py-3">
                <div className="font-semibold text-[var(--text)]">{v.name}</div>
                <div className="text-xs text-[var(--text-muted)]">{v.slug}</div>
              </td>
              <td className="max-w-[280px] truncate px-4 py-3 text-sm text-[var(--text-muted)]" title={v.path}>
                {v.path}
              </td>
              <td className="px-4 py-3 text-sm text-[var(--text-muted)]">{v.homePage || '—'}</td>
              <td className="px-4 py-3 text-sm text-[var(--text-muted)]">{v.pageCount ?? '—'}</td>
              <td className="px-4 py-3 text-sm text-[var(--text-muted)]">
                {v.builtAt ? new Date(v.builtAt).toLocaleString(locale) : t('common.never')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
