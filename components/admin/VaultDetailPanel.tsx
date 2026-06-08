'use client'

import { useState, useEffect } from 'react'
import { slugify } from '@/lib/slugify'
import { useI18n } from '@/components/i18n/I18nProvider'
import type { VaultRow } from '@/lib/vault-admin'

interface Props {
  vault: VaultRow | null // null = new vault
  onClose: () => void
  onSaved: () => void
}

const labelCls = 'mb-1.5 block text-[0.72rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]'
const inputCls = 'w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[0.9rem] text-[var(--text)] outline-none focus:border-indigo-500/50'
const helperCls = 'mt-1 text-[0.72rem] text-[var(--text-muted)]'

export function VaultDetailPanel({ vault, onClose, onSaved }: Props) {
  const { t } = useI18n()
  const [name, setName] = useState(vault?.name ?? '')
  const [vaultPath, setVaultPath] = useState(vault?.path ?? '')
  const [description, setDescription] = useState(vault?.description ?? '')
  const [homePage, setHomePage] = useState(vault?.homePage ?? '')
  const [coverImage, setCoverImage] = useState(vault?.coverImage ?? '')
  const [titleProperty, setTitleProperty] = useState(vault?.titleProperty ?? '')
  const [coverProperty, setCoverProperty] = useState(vault?.coverProperty ?? '')

  const [saving, setSaving] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rebuildMsg, setRebuildMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    setName(vault?.name ?? '')
    setVaultPath(vault?.path ?? '')
    setDescription(vault?.description ?? '')
    setHomePage(vault?.homePage ?? '')
    setCoverImage(vault?.coverImage ?? '')
    setTitleProperty(vault?.titleProperty ?? '')
    setCoverProperty(vault?.coverProperty ?? '')
    setError(null)
    setRebuildMsg(null)
  }, [vault])

  const isNew = vault === null
  const slugPreview = isNew ? slugify(name) || '—' : vault.slug

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      if (!name.trim() || !vaultPath.trim()) {
        setError(t('admin.vaultDetail.requiredNamePath'))
        return
      }
      const payload = {
        name: name.trim(),
        path: vaultPath.trim(),
        description,
        homePage,
        coverImage,
        titleProperty,
        coverProperty: coverProperty.trim() === '' ? null : coverProperty.trim(),
      }
      const res = isNew
        ? await fetch('/api/admin/vaults', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/admin/vaults/${vault.slug}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? t('admin.vaultDetail.saveFailed'))
        return
      }
      onSaved()
    } catch {
      setError(t('admin.vaultDetail.saveNetworkError'))
    } finally {
      setSaving(false)
    }
  }

  async function handleRebuild() {
    if (isNew) return
    setRebuilding(true)
    setRebuildMsg(null)
    try {
      const res = await fetch(`/api/admin/vaults/${vault.slug}/rebuild`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        const tail = data.output ? String(data.output).trim().split('\n').pop() : ''
        setRebuildMsg({ kind: 'ok', text: t('admin.vaultDetail.buildDone', { tail: tail ? ' ' + tail : '' }) })
      } else {
        const detail =
          data.error || (data.output ? String(data.output).trim().split('\n').pop() : '') || t('admin.vaultDetail.buildFailedDefault')
        setRebuildMsg({ kind: 'error', text: t('admin.vaultDetail.buildFailed', { detail }) })
      }
    } catch {
      setRebuildMsg({ kind: 'error', text: t('admin.vaultDetail.buildNetworkError') })
    } finally {
      setRebuilding(false)
    }
  }

  async function handleDelete() {
    if (isNew) return
    if (!confirm(t('admin.vaultDetail.deleteConfirm', { name: vault.name, slug: vault.slug }))) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/vaults/${vault.slug}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? t('admin.vaultDetail.deleteFailed'))
        return
      }
      onSaved()
    } catch {
      setError(t('admin.vaultDetail.deleteNetworkError'))
    } finally {
      setSaving(false)
    }
  }

  const busy = saving || rebuilding

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-10 flex flex-col border-t-2 border-indigo-500"
      style={{ height: '46vh', background: 'var(--bg-secondary)', transition: 'none' }}
    >
      {/* Header */}
      <div className="flex flex-shrink-0 items-center gap-3 border-b px-6 py-3.5" style={{ borderColor: 'var(--border)' }}>
        <h3 className="text-[1rem] font-bold text-[var(--text)]">
          {isNew ? t('admin.vaultDetail.newTitle') : t('admin.vaultDetail.editTitle', { name: vault.name })}
        </h3>
        <button onClick={onClose} className="ml-auto text-lg text-[var(--text-muted)] hover:text-[var(--text)] px-2">✕</button>
      </div>

      {/* Body */}
      <div className="grid flex-1 grid-cols-2 gap-x-10 gap-y-4 overflow-auto px-6 py-5">
        <div>
          <label className={labelCls}>{t('admin.vaultDetail.name')}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </div>

        <div>
          <label className={labelCls}>{t('admin.vaultDetail.slug')}</label>
          <input value={slugPreview} readOnly className={`${inputCls} opacity-70`} />
          <p className={helperCls}>
            {isNew ? t('admin.vaultDetail.slugHelpNew') : t('admin.vaultDetail.slugHelpExisting')}
          </p>
        </div>

        <div>
          <label className={labelCls}>{t('admin.vaultDetail.path')}</label>
          <input value={vaultPath} onChange={(e) => setVaultPath(e.target.value)} className={inputCls} />
          <p className={helperCls}>{t('admin.vaultDetail.pathHelp')}</p>
        </div>

        <div>
          <label className={labelCls}>{t('admin.vaultDetail.home')}</label>
          <input value={homePage} onChange={(e) => setHomePage(e.target.value)} className={inputCls} />
          <p className={helperCls}>{t('admin.vaultDetail.homeHelp')}</p>
        </div>

        <div className="col-span-2">
          <label className={labelCls}>{t('admin.vaultDetail.description')}</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className={`${inputCls} resize-none`}
          />
        </div>

        <div>
          <label className={labelCls}>{t('admin.vaultDetail.cover')}</label>
          <input value={coverImage} onChange={(e) => setCoverImage(e.target.value)} className={inputCls} />
          <p className={helperCls}>{t('admin.vaultDetail.coverHelp')}</p>
        </div>

        <div>
          <label className={labelCls}>{t('admin.vaultDetail.titleProp')}</label>
          <input
            value={titleProperty}
            onChange={(e) => setTitleProperty(e.target.value)}
            placeholder={t('admin.vaultDetail.titlePropPlaceholder')}
            className={inputCls}
          />
          <p className={helperCls}>{t('admin.vaultDetail.titlePropHelp')}</p>
        </div>

        <div>
          <label className={labelCls}>{t('admin.vaultDetail.coverProp')}</label>
          <input
            value={coverProperty}
            onChange={(e) => setCoverProperty(e.target.value)}
            placeholder="cover"
            className={inputCls}
          />
          <p className={helperCls}>{t('admin.vaultDetail.coverPropHelp')}</p>
        </div>

        {rebuildMsg && (
          <div className="col-span-2">
            <p className={`text-[0.8rem] ${rebuildMsg.kind === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
              {rebuildMsg.text}
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex flex-shrink-0 items-center gap-2.5 border-t px-6 py-3" style={{ borderColor: 'var(--border)' }}>
        {error && <span className="text-sm text-red-400">{error}</span>}
        <button
          onClick={handleSave}
          disabled={busy}
          className="rounded-md bg-indigo-500 px-4 py-1.5 text-[0.88rem] font-semibold text-white transition hover:bg-indigo-600 disabled:opacity-60"
        >
          {saving ? t('common.saving') : t('common.save')}
        </button>
        <button
          onClick={handleRebuild}
          disabled={busy || isNew}
          title={isNew ? t('admin.vaultDetail.rebuildDisabled') : undefined}
          className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] px-4 py-1.5 text-[0.88rem] text-[var(--text-muted)] transition hover:bg-[var(--accent-bg)] disabled:opacity-60"
        >
          {rebuilding && (
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--text-muted)] border-t-transparent" />
          )}
          {rebuilding ? t('admin.vaultDetail.rebuilding') : t('admin.vaultDetail.rebuild')}
        </button>
        <button
          onClick={onClose}
          className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-4 py-1.5 text-[0.88rem] text-[var(--text-muted)] transition hover:bg-[var(--accent-bg)]"
        >
          {t('common.cancel')}
        </button>
        {!isNew && (
          <button
            onClick={handleDelete}
            disabled={busy}
            className="ml-auto rounded-md border border-red-500/20 bg-red-500/15 px-4 py-1.5 text-[0.88rem] text-red-300 transition hover:bg-red-500/25 disabled:opacity-60"
          >
            {t('admin.vaultDetail.delete')}
          </button>
        )}
      </div>
    </div>
  )
}
