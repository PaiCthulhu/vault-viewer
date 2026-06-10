'use client'

import { useEffect, useRef } from 'react'
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
}

export function Topbar({ username, isAdmin, vaultName, vaultSlug, pageName }: TopbarProps) {
  const router = useRouter()
  const { t } = useI18n()
  const headerRef = useRef<HTMLElement>(null)

  // Expose the header's actual height as --topbar-h so the mobile drawers can
  // start below it (the header is taller on mobile, where it stacks into two rows).
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const apply = () => document.documentElement.style.setProperty('--topbar-h', `${el.offsetHeight}px`)
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  return (
    <header
      ref={headerRef}
      className="sticky top-0 z-20 flex shrink-0 flex-col gap-1 border-b px-4 py-2 md:h-[50px] md:flex-row md:items-center md:gap-2 md:py-0 md:px-8"
      style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', backdropFilter: 'blur(8px)' }}
    >
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

      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 md:ml-auto md:flex-nowrap md:justify-normal">
        <ThemeToggle />
        <LangToggle />
        {isAdmin && (
          <a href="/admin" className="text-xs text-[var(--text-muted)] transition hover:text-[var(--text)] md:text-sm">
            {t('topbar.admin')}
          </a>
        )}
        <span className="text-xs text-[var(--text-muted)] md:text-sm">{t('topbar.userBadge', { username })}</span>
        <button
          onClick={handleLogout}
          className="text-xs text-[var(--text-muted)] transition hover:text-[var(--text)] md:text-sm"
        >
          {t('topbar.logout')}
        </button>
      </div>
    </header>
  )
}
