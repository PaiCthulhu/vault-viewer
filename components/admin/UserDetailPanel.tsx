'use client'

import { useState, useEffect } from 'react'
import { useI18n } from '@/components/i18n/I18nProvider'
import type { UserPublic, VaultConfig, VaultLevel } from '@/types'

// Map e não objeto: um slug como `constructor` ou `__proto__` não pode cair no protótipo
function levelsOf(user: UserPublic | null): Map<string, VaultLevel> {
  return new Map((user?.vaults ?? []).map((v) => [v.slug, v.level]))
}

const LEVEL_OPTIONS: { level: VaultLevel | null; key: string }[] = [
  { level: null, key: 'admin.userDetail.levelNone' },
  { level: 'reader', key: 'admin.userDetail.levelReader' },
  { level: 'editor', key: 'admin.userDetail.levelEditor' },
]

interface Props {
  user: UserPublic | null    // null = new user
  vaults: VaultConfig[]
  onClose: () => void
  onSaved: () => void
}

export function UserDetailPanel({ user, vaults, onClose, onSaved }: Props) {
  const { t } = useI18n()
  const [username, setUsername] = useState(user?.username ?? '')
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [password, setPassword] = useState('')
  const [levels, setLevels] = useState<Map<string, VaultLevel>>(() => levelsOf(user))
  // Usuário criado pelo POST cujas permissões falharam: o painel passa a editá-lo
  const [created, setCreated] = useState<{ id: number; username: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setUsername(user?.username ?? '')
    setDisplayName(user?.displayName ?? '')
    setPassword('')
    setLevels(levelsOf(user))
    setCreated(null)
    setError(null)
  }, [user])

  const editName = user?.username ?? created?.username ?? null

  // Ausente = sem acesso
  function setLevel(slug: string, level: VaultLevel | null) {
    setLevels((prev) => {
      const next = new Map(prev)
      if (level) next.set(slug, level)
      else next.delete(slug)
      return next
    })
  }

  async function errorOf(res: Response): Promise<string> {
    const data = await res.json().catch(() => ({}))
    return data?.error ?? String(res.status)
  }

  // Devolve true se gravou; senão mostra o erro (com a mensagem da etapa) e devolve false
  async function savePermissions(id: number, failedKey: string): Promise<boolean> {
    const res = await fetch(`/api/admin/users/${id}/permissions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vaults: [...levels].map(([slug, level]) => ({ slug, level })),
      }),
    })
    if (res.ok) return true
    setError(t(failedKey, { error: await errorOf(res) }))
    return false
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const editId = user?.id ?? created?.id ?? null
      if (editId !== null) {
        // Usuário existente (ou recém-criado cujas permissões falharam)
        const res = await fetch(`/api/admin/users/${editId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: username || undefined,
            password: password || undefined,
            displayName,
          }),
        })
        if (!res.ok) { setError(await errorOf(res)); return }
        // O título acompanha o nome que o usuário criado tem agora
        if (!user && username) setCreated({ id: editId, username })
        const failedKey = user ? 'admin.userDetail.permissionsFailed' : 'admin.userDetail.createdPermissionsFailed'
        if (!(await savePermissions(editId, failedKey))) return
      } else {
        // Create new user
        if (!username || !password) { setError(t('admin.userDetail.required')); return }
        const res = await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, displayName }),
        })
        if (!res.ok) { setError(await errorOf(res)); return }
        const { user: newUser } = await res.json()
        setCreated({ id: newUser.id, username: newUser.username ?? username })
        if (!(await savePermissions(newUser.id, 'admin.userDetail.createdPermissionsFailed'))) return
      }
      onSaved()
    } catch {
      setError(t('admin.userDetail.saveNetworkError'))
    } finally {
      setSaving(false)
    }
  }

  // Com usuário já criado, fechar recarrega a lista para ele aparecer
  function handleClose() {
    if (created !== null) onSaved()
    else onClose()
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
          {editName !== null ? t('admin.userDetail.editTitle', { name: editName }) : t('admin.userDetail.newTitle')}
        </h3>
        <button onClick={handleClose} className="ml-auto text-lg text-[var(--text-muted)] hover:text-[var(--text)] px-2">✕</button>
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
              {t('admin.userDetail.displayName')}
            </label>
            <input
              value={displayName}
              maxLength={80}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-[220px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[0.9rem] text-[var(--text)] outline-none focus:border-indigo-500/50"
            />
            <p className="mt-1 w-[220px] text-[0.72rem] text-[var(--text-muted)]">
              {t('admin.userDetail.displayNameHelp')}
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-[0.72rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
              {editName !== null ? t('admin.userDetail.newPassword') : t('admin.userDetail.password')}
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
          {vaults.map((v) => (
            <div key={v.slug} className="flex items-center gap-3">
              <span title={v.name} className="w-[140px] truncate text-[0.88rem] text-[var(--text)]">{v.name}</span>
              <div
                role="radiogroup"
                aria-label={v.name}
                className="inline-flex overflow-hidden rounded-md border border-[var(--border)]"
              >
                {LEVEL_OPTIONS.map((o) => {
                  const on = (levels.get(v.slug) ?? null) === o.level
                  return (
                    <button
                      key={o.key}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setLevel(v.slug, o.level)}
                      className={`px-2.5 py-1 text-[0.8rem] transition ${
                        on ? 'bg-indigo-500 text-white' : 'bg-[var(--bg)] text-[var(--text-muted)] hover:bg-[var(--accent-bg)]'
                      }`}
                    >
                      {t(o.key)}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
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
          onClick={handleClose}
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
