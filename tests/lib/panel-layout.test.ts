import { describe, it, expect } from 'vitest'
import {
  clampWidth,
  defaultLayout,
  parseLayout,
  serializeLayout,
  PANEL_MIN_WIDTH,
  PANEL_MAX_WIDTH,
  type PanelLayout,
} from '../../lib/panel-layout'

describe('clampWidth', () => {
  it('returns the width unchanged when within bounds', () => {
    expect(clampWidth(300)).toBe(300)
  })

  it('clamps below the minimum up to PANEL_MIN_WIDTH', () => {
    expect(clampWidth(10)).toBe(PANEL_MIN_WIDTH)
  })

  it('clamps above the maximum down to PANEL_MAX_WIDTH', () => {
    expect(clampWidth(9999)).toBe(PANEL_MAX_WIDTH)
  })

  it('rounds fractional widths', () => {
    expect(clampWidth(300.7)).toBe(301)
  })
})

describe('defaultLayout', () => {
  it('derives widths from the 22% / 24% viewport percentages', () => {
    const layout = defaultLayout(2000)
    expect(layout.sidebarWidth).toBe(440) // 22% of 2000
    expect(layout.graphWidth).toBe(480) // 24% of 2000
    expect(layout.sidebarCollapsed).toBe(false)
    expect(layout.graphCollapsed).toBe(false)
  })

  it('clamps the derived widths into the allowed range on small viewports', () => {
    const layout = defaultLayout(500) // 22% = 110, 24% = 120 — both below min
    expect(layout.sidebarWidth).toBe(PANEL_MIN_WIDTH)
    expect(layout.graphWidth).toBe(PANEL_MIN_WIDTH)
  })
})

describe('parseLayout', () => {
  const viewport = 2000

  it('falls back to the default layout when raw is null', () => {
    expect(parseLayout(null, viewport)).toEqual(defaultLayout(viewport))
  })

  it('falls back to the default layout when raw is invalid JSON', () => {
    expect(parseLayout('{not json', viewport)).toEqual(defaultLayout(viewport))
  })

  it('reads and clamps a stored layout', () => {
    const raw = JSON.stringify({
      sidebarWidth: 9999,
      graphWidth: 250,
      sidebarCollapsed: true,
      graphCollapsed: false,
    })
    const layout = parseLayout(raw, viewport)
    expect(layout.sidebarWidth).toBe(PANEL_MAX_WIDTH)
    expect(layout.graphWidth).toBe(250)
    expect(layout.sidebarCollapsed).toBe(true)
    expect(layout.graphCollapsed).toBe(false)
  })

  it('uses default widths for missing or non-numeric fields', () => {
    const raw = JSON.stringify({ sidebarCollapsed: true })
    const layout = parseLayout(raw, viewport)
    const def = defaultLayout(viewport)
    expect(layout.sidebarWidth).toBe(def.sidebarWidth)
    expect(layout.graphWidth).toBe(def.graphWidth)
    expect(layout.sidebarCollapsed).toBe(true)
    expect(layout.graphCollapsed).toBe(false)
  })
})

describe('serializeLayout', () => {
  it('round-trips through parseLayout', () => {
    const layout: PanelLayout = {
      sidebarWidth: 300,
      graphWidth: 320,
      sidebarCollapsed: true,
      graphCollapsed: false,
    }
    expect(parseLayout(serializeLayout(layout), 2000)).toEqual(layout)
  })
})
