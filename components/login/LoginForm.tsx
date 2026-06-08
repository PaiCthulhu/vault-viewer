'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useI18n } from '@/components/i18n/I18nProvider'

export function LoginForm() {
  const { t } = useI18n()
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const data = await res.json()

      if (!res.ok) {
        // Use the localized message rather than the server's (pt-BR) text.
        void data
        setError(t('login.invalid'))
        return
      }

      router.push('/')
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-0">
      <h2 className="mb-1.5 text-2xl font-bold tracking-tight" style={{ color: 'var(--text)' }}>{t('login.heading')}</h2>
      <p className="mb-8 text-sm" style={{ color: 'var(--text-muted)' }}>
        {t('login.subtitle')}
      </p>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="mb-5">
        <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
          {t('login.username')}
        </label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoComplete="username"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-3 text-base text-[var(--text)] outline-none transition focus:border-indigo-500/60 focus:bg-indigo-500/5"
        />
      </div>

      <div className="mb-5">
        <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
          {t('login.password')}
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-3 text-base text-[var(--text)] outline-none transition focus:border-indigo-500/60 focus:bg-indigo-500/5"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="mt-2 w-full rounded-lg bg-indigo-500 py-3.5 text-base font-semibold text-white transition hover:bg-indigo-600 disabled:opacity-60"
      >
        {loading ? t('login.submitting') : t('login.submit')}
      </button>
    </form>
  )
}
