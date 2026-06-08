'use client'

interface DrawerOverlayProps {
  onClick: () => void
}

export function DrawerOverlay({ onClick }: DrawerOverlayProps) {
  return (
    <div
      onClick={onClick}
      className="fixed inset-0 z-40 md:hidden"
      style={{ background: 'rgba(0,0,0,0.45)' }}
    />
  )
}
