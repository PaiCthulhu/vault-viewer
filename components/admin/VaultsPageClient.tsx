'use client'

import { useState, useCallback } from 'react'
import { Topbar } from '@/components/shared/Topbar'
import { AdminSidebar } from './AdminSidebar'
import { VaultsTable } from './VaultsTable'
import { VaultDetailPanel } from './VaultDetailPanel'
import { useI18n } from '@/components/i18n/I18nProvider'
import type { VaultRow } from '@/lib/vault-admin'

interface Props {
  initialVaults: VaultRow[]
  currentUsername: string
  isAdmin: boolean
}

export function VaultsPageClient({ initialVaults, currentUsername, isAdmin }: Props) {
  const { t } = useI18n()
  const [vaults, setVaults] = useState(initialVaults)
  const [selected, setSelected] = useState<VaultRow | null | 'new'>(null)

  const refresh = useCallback(async () => {
    const res = await fetch('/api/admin/vaults')
    if (res.ok) {
      const data = await res.json()
      setVaults(data.vaults)
    }
    setSelected(null)
  }, [])

  const panelVault = selected === 'new' ? null : selected

  return (
    <div className="flex h-screen flex-col overflow-hidden" style={{ background: 'var(--bg)' }}>
      <Topbar username={currentUsername} isAdmin={isAdmin} />
      <div className="flex flex-1 overflow-hidden">
        <AdminSidebar />
        <main className="relative flex flex-1 flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="flex flex-shrink-0 items-center gap-3 border-b px-5 py-3.5" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
            <h2 className="text-[1.05rem] font-bold text-[var(--text)] mr-auto">{t('admin.vaults.title')}</h2>
            <button
              onClick={() => setSelected('new')}
              className="rounded-md bg-indigo-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-600 transition"
            >
              {t('admin.vaults.new')}
            </button>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-auto" style={{ background: 'var(--bg)' }}>
            <VaultsTable
              vaults={vaults}
              selectedSlug={selected && selected !== 'new' ? selected.slug : null}
              onSelect={(v) => setSelected(v)}
            />
          </div>

          {/* Detail panel (slide up via height) */}
          {selected !== null && (
            <VaultDetailPanel
              vault={panelVault}
              onClose={() => setSelected(null)}
              onSaved={refresh}
            />
          )}
        </main>
      </div>
    </div>
  )
}
