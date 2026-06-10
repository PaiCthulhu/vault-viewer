'use client'

import { useRef, useState } from 'react'

type Side = 'left' | 'right'

interface PanelResizerProps {
  /** 'left' = sits between sidebar and content (resizes sidebar);
   *  'right' = sits between content and graph panel (resizes graph). */
  side: Side
  width: number
  onResize: (w: number) => void
  onCollapse: () => void
  resizeLabel: string
  collapseLabel: string
}

/**
 * A thin draggable divider rendered as a flex sibling *between* two panels
 * (desktop only — `hidden md:flex`). Dragging it resizes the adjacent panel;
 * the always-visible chevron button collapses that panel to its rail.
 */
export function PanelResizer({ side, width, onResize, onCollapse, resizeLabel, collapseLabel }: PanelResizerProps) {
  const drag = useRef<{ startX: number; startW: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { startX: e.clientX, startW: width }
    setDragging(true)
    document.body.classList.add('vault-resizing')
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return
    const delta = e.clientX - drag.current.startX
    const next = side === 'left' ? drag.current.startW + delta : drag.current.startW - delta
    onResize(next)
  }

  function endDrag(e: React.PointerEvent) {
    if (!drag.current) return
    drag.current = null
    setDragging(false)
    document.body.classList.remove('vault-resizing')
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* pointer already released */
    }
  }

  return (
    <div
      className={`vault-resizer${dragging ? ' is-dragging' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      role="separator"
      aria-orientation="vertical"
      title={resizeLabel}
      aria-label={resizeLabel}
    >
      <button
        type="button"
        className="vault-resizer-collapse vault-pill"
        // Don't let a click on the chevron start a drag.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onCollapse()
        }}
        aria-label={collapseLabel}
        title={collapseLabel}
      >
        {side === 'left' ? '‹' : '›'}
      </button>
    </div>
  )
}

interface PanelRailProps {
  side: Side
  onExpand: () => void
  label: string
}

/**
 * The full-height rail shown in place of a collapsed panel (desktop only).
 * Clicking anywhere on it re-expands the panel to its last width.
 */
export function PanelRail({ side, onExpand, label }: PanelRailProps) {
  return (
    <button
      type="button"
      className={`vault-panel-rail vault-panel-rail-${side}`}
      onClick={onExpand}
      aria-label={label}
      title={label}
    >
      <span className="vault-pill" aria-hidden="true">{side === 'left' ? '›' : '‹'}</span>
    </button>
  )
}
