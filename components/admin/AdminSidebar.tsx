'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useI18n } from '@/components/i18n/I18nProvider'

export function AdminSidebar() {
  const pathname = usePathname()
  const { t } = useI18n()
  const items = [
    { href: '/admin', label: t('admin.nav.users') },
    { href: '/admin/vaults', label: t('admin.nav.vaults') },
    { href: '/', label: t('admin.nav.back') },
  ]
  return (
    <aside className="flex w-[200px] flex-shrink-0 flex-col border-r px-2 py-4 gap-1" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
      <p className="mb-2 px-3 text-[0.68rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{t('admin.nav.section')}</p>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`rounded-md px-3 py-2 text-[0.88rem] transition ${
            pathname === item.href
              ? 'bg-indigo-500/18 font-semibold text-indigo-300'
              : 'text-[var(--text-muted)] hover:bg-[var(--accent-bg)] hover:text-[var(--text)]'
          }`}
        >
          {item.label}
        </Link>
      ))}
    </aside>
  )
}
