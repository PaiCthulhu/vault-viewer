'use client'

import { useState, useCallback } from 'react'
import { Topbar } from '@/components/shared/Topbar'
import { AdminSidebar } from './AdminSidebar'
import { UsersTable } from './UsersTable'
import { UserDetailPanel } from './UserDetailPanel'
import { useI18n } from '@/components/i18n/I18nProvider'
import type { UserPublic, VaultConfig } from '@/types'

interface Props {
  initialUsers: UserPublic[]
  vaults: VaultConfig[]
  currentUsername: string
  isAdmin: boolean
}

export function AdminPageClient({ initialUsers, vaults, currentUsername, isAdmin }: Props) {
  const { t } = useI18n()
  const [users, setUsers] = useState(initialUsers)
  const [selected, setSelected] = useState<UserPublic | null | 'new'>(null)

  const refreshUsers = useCallback(async () => {
    const res = await fetch('/api/admin/users')
    if (res.ok) {
      const data = await res.json()
      setUsers(data.users)
    }
    setSelected(null)
  }, [])

  const panelUser = selected === 'new' ? null : selected

  return (
    <div className="flex h-screen flex-col overflow-hidden" style={{ background: 'var(--bg)' }}>
      <Topbar username={currentUsername} isAdmin={isAdmin} />
      <div className="flex flex-1 overflow-hidden">
        <AdminSidebar />
        <main className="relative flex flex-1 flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="flex flex-shrink-0 items-center gap-3 border-b px-5 py-3.5" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
            <h2 className="text-[1.05rem] font-bold text-[var(--text)] mr-auto">{t('admin.users.title')}</h2>
            <button
              onClick={() => setSelected('new')}
              className="rounded-md bg-indigo-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-600 transition"
            >
              {t('admin.users.new')}
            </button>
          </div>

          {/* Scrollable content: users table */}
          <div className="flex-1 overflow-auto" style={{ background: 'var(--bg)' }}>
            <UsersTable
              users={users}
              selectedId={selected && selected !== 'new' ? selected.id : null}
              onSelect={(u) => setSelected(u)}
            />
          </div>

          {/* Detail panel (slide up via height) */}
          {selected !== null && (
            <UserDetailPanel
              user={panelUser}
              vaults={vaults}
              onClose={() => setSelected(null)}
              onSaved={refreshUsers}
            />
          )}
        </main>
      </div>
    </div>
  )
}
