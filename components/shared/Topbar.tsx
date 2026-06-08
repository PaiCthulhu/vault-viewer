'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ThemeToggle } from './ThemeToggle'
import { LangToggle } from '@/components/shared/LangToggle'
import { useI18n } from '@/components/i18n/I18nProvider'

interface TopbarProps {
  username: string
  isAdmin: boolean
  vaultName?: string
  vaultSlug?: string
  pageName?: string
  onSidebarToggle?: () => void
  onGraphToggle?: () => void
}

export function Topbar({ username, isAdmin, vaultName, vaultSlug, pageName, onSidebarToggle, onGraphToggle }: TopbarProps) {
  const router = useRouter()
  const { t } = useI18n()

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  return (
    <header
      className="sticky top-0 z-20 flex h-[50px] shrink-0 items-center gap-2 border-b px-4 md:px-8"
      style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', backdropFilter: 'blur(8px)' }}
    >
      {/* Mobile: sidebar hamburger */}
      {onSidebarToggle && (
        <button
          onClick={onSidebarToggle}
          className="flex md:hidden h-8 w-8 items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text)]"
          aria-label={t('topbar.openSidebar')}
        >
          ☰
        </button>
      )}

      {/* Brand + breadcrumb */}
      <div className="flex min-w-0 items-center gap-1 text-[0.95rem] font-extrabold tracking-tight text-[var(--text)]">
        <Link href="/" className="shrink-0 hover:text-[var(--accent)]">Vault Viewer</Link>
        {vaultName && vaultSlug && (
          <>
            <span className="text-[var(--text-muted)] font-normal mx-1">/</span>
            <Link href={`/vault/${vaultSlug}`} className="font-normal text-sm text-[var(--text-muted)] hover:text-[var(--text)] shrink-0">
              {vaultName}
            </Link>
          </>
        )}
        {vaultName && !vaultSlug && (
          <span className="ml-2 font-normal text-[var(--text-muted)] text-sm shrink-0">/ {vaultName}</span>
        )}
        {pageName && (
          <>
            <span className="text-[var(--text-muted)] font-normal mx-1">/</span>
            <span className="font-normal text-sm text-[var(--text)] truncate">{pageName}</span>
          </>
        )}
      </div>

      <div className="ml-auto flex items-center gap-3">
        <ThemeToggle />
        <LangToggle />
        {isAdmin && (
          <a href="/admin" className="hidden md:block text-sm text-[var(--text-muted)] transition hover:text-[var(--text)]">
            {t('topbar.admin')}
          </a>
        )}
        <span className="hidden md:block text-sm text-[var(--text-muted)]">{t('topbar.userBadge', { username })}</span>
        <button
          onClick={handleLogout}
          className="text-sm text-[var(--text-muted)] transition hover:text-[var(--text)]"
        >
          {t('topbar.logout')}
        </button>

        {/* Mobile: graph button */}
        {onGraphToggle && (
          <button
            onClick={onGraphToggle}
            className="flex md:hidden h-8 w-8 items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text)]"
            aria-label={t('topbar.openGraph')}
          >
            ⬡
          </button>
        )}
      </div>
    </header>
  )
}
