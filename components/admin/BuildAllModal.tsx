'use client'

import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/components/i18n/I18nProvider'
import { summarizeStatuses, type BuildStatus } from '@/lib/build-all-status'

interface VaultRef {
  slug: string
  name: string
}

interface Props {
  vaults: VaultRef[]
  onClose: () => void
  onFinished: () => void
}

interface Row {
  slug: string
  name: string
  status: BuildStatus
  detail?: string
}

function lastLine(output: unknown): string {
  if (!output) return ''
  return String(output).trim().split('\n').pop() ?? ''
}

export function BuildAllModal({ vaults, onClose, onFinished }: Props) {
  const { t } = useI18n()
  const [rows, setRows] = useState<Row[]>(
    vaults.map((v) => ({ slug: v.slug, name: v.name, status: 'pending' as BuildStatus })),
  )
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const unloadGuard = useRef<((e: BeforeUnloadEvent) => void) | null>(null)

  // Safety net: detach the beforeunload guard if the modal unmounts mid-build.
  useEffect(() => {
    return () => {
      if (unloadGuard.current) {
        window.removeEventListener('beforeunload', unloadGuard.current)
        unloadGuard.current = null
      }
    }
  }, [])

  function patch(slug: string, changes: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.slug === slug ? { ...r, ...changes } : r)))
  }

  async function runBuild() {
    setPhase('running')
    // Attach synchronously so the guard covers the very first vault.
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    unloadGuard.current = handler
    window.addEventListener('beforeunload', handler)
    try {
      for (const v of vaults) {
        patch(v.slug, { status: 'building', detail: undefined })
        try {
          const res = await fetch(`/api/admin/vaults/${v.slug}/rebuild`, { method: 'POST' })
          const data = await res.json().catch(() => ({}))
          if (res.ok && data.ok) {
            patch(v.slug, { status: 'ok' })
          } else {
            patch(v.slug, { status: 'error', detail: data.error || lastLine(data.output) })
          }
        } catch {
          patch(v.slug, { status: 'error', detail: t('admin.buildAll.errNetwork') })
        }
      }
    } finally {
      window.removeEventListener('beforeunload', handler)
      unloadGuard.current = null
      setPhase('done')
    }
  }

  function handleClose() {
    if (phase === 'running') return
    if (phase === 'done') onFinished()
    onClose()
  }

  const summary = summarizeStatuses(rows.map((r) => r.status))

  const statusLabel: Record<BuildStatus, string> = {
    pending: t('admin.buildAll.statusPending'),
    building: t('admin.buildAll.statusBuilding'),
    ok: t('admin.buildAll.statusOk'),
    error: t('admin.buildAll.statusError'),
  }
  const statusColor: Record<BuildStatus, string> = {
    pending: 'text-[var(--text-muted)]',
    building: 'text-[var(--text)]',
    ok: 'text-emerald-400',
    error: 'text-red-400',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border shadow-xl"
        style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex flex-shrink-0 items-center gap-3 border-b px-5 py-3.5" style={{ borderColor: 'var(--border)' }}>
          <h3 className="text-[1rem] font-bold text-[var(--text)]">{t('admin.buildAll.title')}</h3>
          <button
            onClick={handleClose}
            disabled={phase === 'running'}
            className="ml-auto px-2 text-lg text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          <p className="mb-3 text-[0.85rem] text-[var(--text-muted)]">
            {phase === 'done'
              ? t('admin.buildAll.summary', { ok: summary.ok, error: summary.error })
              : t('admin.buildAll.intro', { count: vaults.length })}
          </p>
          <ul className="flex flex-col gap-1.5">
            {rows.map((r) => (
              <li
                key={r.slug}
                className="flex items-center gap-2 rounded-md border px-3 py-2 text-[0.85rem]"
                style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
              >
                {r.status === 'building' && (
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--text-muted)] border-t-transparent" />
                )}
                <span className="font-semibold text-[var(--text)]">{r.name}</span>
                <span className="text-xs text-[var(--text-muted)]">{r.slug}</span>
                <span className={`ml-auto ${statusColor[r.status]}`}>{statusLabel[r.status]}</span>
              </li>
            ))}
          </ul>
          {rows.some((r) => r.status === 'error' && r.detail) && (
            <ul className="mt-3 flex flex-col gap-1">
              {rows
                .filter((r) => r.status === 'error' && r.detail)
                .map((r) => (
                  <li key={r.slug} className="text-[0.72rem] text-red-400">
                    {r.name}: {r.detail}
                  </li>
                ))}
            </ul>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center justify-end gap-2.5 border-t px-5 py-3" style={{ borderColor: 'var(--border)' }}>
          {phase === 'idle' && (
            <>
              <button
                onClick={handleClose}
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-4 py-1.5 text-[0.88rem] text-[var(--text-muted)] transition hover:bg-[var(--accent-bg)]"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={runBuild}
                className="rounded-md bg-indigo-500 px-4 py-1.5 text-[0.88rem] font-semibold text-white transition hover:bg-indigo-600"
              >
                {t('admin.buildAll.confirm')}
              </button>
            </>
          )}
          {phase === 'running' && (
            <span className="flex items-center gap-2 text-[0.88rem] text-[var(--text-muted)]">
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--text-muted)] border-t-transparent" />
              {t('admin.buildAll.building')} ({summary.done}/{summary.total})
            </span>
          )}
          {phase === 'done' && (
            <button
              onClick={handleClose}
              className="rounded-md bg-indigo-500 px-4 py-1.5 text-[0.88rem] font-semibold text-white transition hover:bg-indigo-600"
            >
              {t('admin.buildAll.close')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
