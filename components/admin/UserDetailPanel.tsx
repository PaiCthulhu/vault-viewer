'use client'

import { useState, useEffect } from 'react'
import { useI18n } from '@/components/i18n/I18nProvider'
import type { UserPublic, VaultConfig } from '@/types'

interface Props {
  user: UserPublic | null    // null = new user
  vaults: VaultConfig[]
  onClose: () => void
  onSaved: () => void
}

export function UserDetailPanel({ user, vaults, onClose, onSaved }: Props) {
  const { t } = useI18n()
  const [username, setUsername] = useState(user?.username ?? '')
  const [password, setPassword] = useState('')
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>(user?.vaultSlugs ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setUsername(user?.username ?? '')
    setPassword('')
    setSelectedSlugs(user?.vaultSlugs ?? [])
    setError(null)
  }, [user])

  function toggleSlug(slug: string) {
    setSelectedSlugs((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
    )
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      if (user) {
        // Update existing user
        if (username || password) {
          const res = await fetch(`/api/admin/users/${user.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username || undefined, password: password || undefined }),
          })
          if (!res.ok) { setError((await res.json()).error); return }
        }
        // Update permissions
        await fetch(`/api/admin/users/${user.id}/permissions`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vaultSlugs: selectedSlugs }),
        })
      } else {
        // Create new user
        if (!username || !password) { setError(t('admin.userDetail.required')); return }
        const res = await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        })
        if (!res.ok) { setError((await res.json()).error); return }
        const { user: created } = await res.json()
        await fetch(`/api/admin/users/${created.id}/permissions`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vaultSlugs: selectedSlugs }),
        })
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!user || !confirm(t('admin.userDetail.deleteConfirm', { name: user.username }))) return
    await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' })
    onSaved()
  }

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-10 flex flex-col border-t-2 border-indigo-500"
      style={{ height: '40vh', background: 'var(--bg-secondary)', transition: 'none' }}
    >
      {/* Header */}
      <div className="flex flex-shrink-0 items-center gap-3 border-b px-6 py-3.5" style={{ borderColor: 'var(--border)' }}>
        <h3 className="text-[1rem] font-bold text-[var(--text)]">
          {user ? t('admin.userDetail.editTitle', { name: user.username }) : t('admin.userDetail.newTitle')}
        </h3>
        <button onClick={onClose} className="ml-auto text-lg text-[var(--text-muted)] hover:text-[var(--text)] px-2">✕</button>
      </div>

      {/* Body */}
      <div className="flex flex-1 gap-10 overflow-auto px-6 py-5">
        <div className="flex flex-col gap-4 min-w-[220px]">
          <div>
            <label className="mb-1.5 block text-[0.72rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
              {t('admin.userDetail.username')}
            </label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-[220px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[0.9rem] text-[var(--text)] outline-none focus:border-indigo-500/50"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[0.72rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
              {user ? t('admin.userDetail.newPassword') : t('admin.userDetail.password')}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-[220px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[0.9rem] text-[var(--text)] outline-none focus:border-indigo-500/50"
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 min-w-[220px]">
          <label className="text-[0.72rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
            {t('admin.userDetail.vaultsAccess')}
          </label>
          {vaults.map((v) => {
            const on = selectedSlugs.includes(v.slug)
            return (
              <button
                key={v.slug}
                onClick={() => toggleSlug(v.slug)}
                className={`flex w-[220px] items-center gap-3 rounded-md border px-3 py-2 text-[0.88rem] transition ${
                  on ? 'border-indigo-500/30 bg-indigo-500/12 text-[var(--text)]' : 'border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)]'
                }`}
              >
                <span className={`flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded text-[11px] border ${on ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-[var(--border)]'}`}>
                  {on ? '✓' : ''}
                </span>
                {v.name}
              </button>
            )
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="flex flex-shrink-0 items-center gap-2.5 border-t px-6 py-3" style={{ borderColor: 'var(--border)' }}>
        {error && <span className="text-sm text-red-400">{error}</span>}
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-indigo-500 px-4 py-1.5 text-[0.88rem] font-semibold text-white transition hover:bg-indigo-600 disabled:opacity-60"
        >
          {saving ? t('common.saving') : t('common.save')}
        </button>
        <button
          onClick={onClose}
          className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-4 py-1.5 text-[0.88rem] text-[var(--text-muted)] transition hover:bg-[var(--accent-bg)]"
        >
          {t('common.cancel')}
        </button>
        {user && !user.isAdmin && (
          <button
            onClick={handleDelete}
            className="ml-auto rounded-md border border-red-500/20 bg-red-500/15 px-4 py-1.5 text-[0.88rem] text-red-300 transition hover:bg-red-500/25"
          >
            {t('admin.userDetail.delete')}
          </button>
        )}
      </div>
    </div>
  )
}
