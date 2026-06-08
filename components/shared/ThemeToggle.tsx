'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { useI18n } from '@/components/i18n/I18nProvider'

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const { t } = useI18n()
  const [mounted, setMounted] = useState(false)

  // Avoid hydration mismatch — only render after client mount
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  const isDark = theme === 'dark'

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={`rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1.5 text-sm text-[var(--text-muted)] transition hover:text-[var(--text)] ${className}`}
      aria-label={t('theme.toggle')}
    >
      {isDark ? t('theme.light') : t('theme.dark')}
    </button>
  )
}
