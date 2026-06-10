'use client'

interface MobilePanelFabProps {
  side: 'left' | 'right'
  onClick: () => void
  label: string
  /** Hidden while its own drawer is open (the overlay handles closing). */
  hidden?: boolean
  children: React.ReactNode
}

/**
 * Floating action button pinned to a screen edge, mobile only (`md:hidden`).
 * Replaces the old crowded topbar ☰ / ⬡ buttons: left opens the foldertree
 * drawer, right opens the graph drawer.
 */
export function MobilePanelFab({ side, onClick, label, hidden, children }: MobilePanelFabProps) {
  if (hidden) return null
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`vault-fab vault-fab-${side}`}
    >
      {children}
    </button>
  )
}
