'use client'

import { useI18n } from '@/components/i18n/I18nProvider'
import type { UserPublic } from '@/types'

interface Props {
  users: UserPublic[]
  selectedId: number | null
  onSelect: (user: UserPublic) => void
}

export function UsersTable({ users, selectedId, onSelect }: Props) {
  const { t } = useI18n()
  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-[0.9rem]">
        <thead>
          <tr className="sticky top-0 border-b" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
            <th className="px-4 py-2.5 text-left text-[0.72rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{t('admin.users.colUser')}</th>
            <th className="px-4 py-2.5 text-left text-[0.72rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{t('admin.users.colRole')}</th>
            <th className="px-4 py-2.5 text-left text-[0.72rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{t('admin.users.colVaults')}</th>
            <th className="px-4 py-2.5 text-left text-[0.72rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{t('admin.users.colCreated')}</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr
              key={u.id}
              onClick={() => onSelect(u)}
              className="cursor-pointer border-b transition"
              style={{
                borderColor: 'var(--border)',
                background: selectedId === u.id ? 'rgba(99,102,241,0.1)' : undefined,
              }}
              onMouseEnter={(e) => { if (selectedId !== u.id) (e.currentTarget as HTMLElement).style.background = 'rgba(127,127,127,0.06)' }}
              onMouseLeave={(e) => { if (selectedId !== u.id) (e.currentTarget as HTMLElement).style.background = '' }}
            >
              <td className="px-4 py-3 font-semibold text-[var(--text)]">{u.username}</td>
              <td className="px-4 py-3">
                <span className={`rounded px-2.5 py-0.5 text-xs font-semibold ${u.isAdmin ? 'bg-indigo-500/20 text-indigo-300' : 'bg-[var(--bg-secondary)] text-[var(--text-muted)]'}`}>
                  {u.isAdmin ? t('admin.users.roleAdmin') : t('admin.users.roleReader')}
                </span>
              </td>
              <td className="px-4 py-3">
                {u.isAdmin ? (
                  <span className="text-[var(--text-muted)] text-sm">{t('admin.users.allVaults')}</span>
                ) : u.vaultSlugs.length > 0 ? (
                  u.vaultSlugs.map((s) => (
                    <span key={s} className="mr-1.5 inline-block rounded border border-indigo-500/25 bg-indigo-500/12 px-2 py-0.5 text-xs text-indigo-300">
                      {s}
                    </span>
                  ))
                ) : (
                  <span className="text-[var(--text-muted)] text-sm">{t('admin.users.noVaults')}</span>
                )}
              </td>
              <td className="px-4 py-3 text-[var(--text-muted)] text-sm">
                {new Date(u.createdAt).toLocaleDateString('pt-BR')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
