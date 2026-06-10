'use client'

import { useI18n } from '@/components/i18n/I18nProvider'

// Language switcher. Renders a select over all registered locales, so adding a
// new locale (in lib/i18n) makes it appear here automatically.
export function LangToggle({ className = '' }: { className?: string }) {
  const { locale, setLocale, locales, t } = useI18n()

  // Only show the switcher when more than one locale is available.
  if (locales.length < 2) return null

  return (
    <select
      value={locale}
      onChange={e => setLocale(e.target.value)}
      aria-label={t('lang.toggle')}
      title={t('lang.toggle')}
      className={`rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-1.5 py-1 text-xs text-[var(--text-muted)] transition hover:text-[var(--text)] md:px-2 md:py-1.5 md:text-sm ${className}`}
    >
      {locales.map(l => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  )
}
