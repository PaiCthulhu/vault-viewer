'use client'

import Link from 'next/link'
import { useI18n } from '@/components/i18n/I18nProvider'

interface VaultCardProps {
  slug: string
  name: string
  description: string
  coverImage: string | null
  pageCount: number
  folderCount: number
  lastBuilt: string | null
}

export function VaultCard({ slug, name, description, coverImage, pageCount, folderCount, lastBuilt }: VaultCardProps) {
  const { t } = useI18n()
  const imageUrl = coverImage
    ? `/vault-assets/${slug}/${coverImage}`
    : null

  function formatRelative(iso: string | null): string {
    if (!iso) return t('vaultCard.neverBuilt')
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return t('vaultCard.justNow')
    if (mins < 60) return t('vaultCard.minutesAgo', { n: mins })
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return t('vaultCard.hoursAgo', { n: hrs })
    return t('vaultCard.daysAgo', { n: Math.floor(hrs / 24) })
  }

  return (
    <Link
      href={`/vault/${slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border transition"
      style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
    >
      {/* Cover */}
      <div className="relative h-[200px] overflow-hidden" style={{ background: 'var(--bg)' }}>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={name}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-5xl opacity-20">📚</div>
        )}
        {/* Gradient over bottom 20% — z-index: 1 ensures it stays above img during scale transform */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ zIndex: 1, background: 'linear-gradient(to top, rgba(19,19,42,.9) 0%, rgba(19,19,42,.3) 20%, transparent 40%)' }}
        />
        <span
          className="absolute bottom-3 right-4 text-xs text-white/35"
          style={{ zIndex: 2 }}
          suppressHydrationWarning
        >
          {formatRelative(lastBuilt)}
        </span>
      </div>

      {/* Info */}
      <div className="flex flex-1 flex-col gap-2 p-5">
        <h2 className="text-xl font-bold tracking-tight text-[var(--text)]">{name}</h2>
        <p className="text-[0.88rem] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {description}
        </p>
        <div className="mt-1 flex items-center gap-3">
          {pageCount > 0 && <span className="text-[0.78rem]" style={{ color: 'var(--text-muted)' }}>{t('vaultCard.notes', { n: pageCount })}</span>}
          {folderCount > 0 && <span className="text-[0.78rem]" style={{ color: 'var(--text-muted)' }}>{t('vaultCard.folders', { n: folderCount })}</span>}
        </div>
        <div className="mt-auto pt-4">
          <span
            className="inline-block rounded-md border px-4 py-1.5 text-[0.85rem] font-semibold transition group-hover:bg-indigo-500/25"
            style={{ background: 'var(--accent-bg)', borderColor: 'rgba(99,102,241,0.3)', color: 'rgb(165,168,255)' }}
          >
            {t('vaultCard.open')}
          </span>
        </div>
      </div>
    </Link>
  )
}
