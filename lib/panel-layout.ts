/**
 * Pure helpers for the viewer's resizable/collapsible side panels.
 * React wiring lives in `components/viewer/usePanelLayout.ts`; the math and
 * persistence parsing are kept here so they can be unit-tested in isolation.
 */

export const PANEL_MIN_WIDTH = 180
export const PANEL_MAX_WIDTH = 520

/** Width (px) of a collapsed panel's rail, just enough to show the expand handle. */
export const PANEL_COLLAPSED_RAIL = 14

/** localStorage key holding the serialized {@link PanelLayout}. */
export const PANEL_LAYOUT_KEY = 'vv:panel-layout'

/** Initial-width percentages, matching the pre-resize fixed Tailwind layout. */
export const SIDEBAR_PERCENT = 0.22
export const GRAPH_PERCENT = 0.24

export interface PanelLayout {
  sidebarWidth: number
  graphWidth: number
  sidebarCollapsed: boolean
  graphCollapsed: boolean
}

/** Round and clamp a width into the allowed `[PANEL_MIN_WIDTH, PANEL_MAX_WIDTH]` range. */
export function clampWidth(width: number): number {
  return Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Math.round(width)))
}

/** Default layout derived from the viewport width via the legacy percentages. */
export function defaultLayout(viewportWidth: number): PanelLayout {
  return {
    sidebarWidth: clampWidth(viewportWidth * SIDEBAR_PERCENT),
    graphWidth: clampWidth(viewportWidth * GRAPH_PERCENT),
    sidebarCollapsed: false,
    graphCollapsed: false,
  }
}

/** Parse a stored layout, clamping widths and falling back to defaults for bad/missing data. */
export function parseLayout(raw: string | null, viewportWidth: number): PanelLayout {
  const def = defaultLayout(viewportWidth)
  if (!raw) return def

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return def
  }
  if (!parsed || typeof parsed !== 'object') return def
  const obj = parsed as Record<string, unknown>

  return {
    sidebarWidth: typeof obj.sidebarWidth === 'number' ? clampWidth(obj.sidebarWidth) : def.sidebarWidth,
    graphWidth: typeof obj.graphWidth === 'number' ? clampWidth(obj.graphWidth) : def.graphWidth,
    sidebarCollapsed: obj.sidebarCollapsed === true,
    graphCollapsed: obj.graphCollapsed === true,
  }
}

export function serializeLayout(layout: PanelLayout): string {
  return JSON.stringify(layout)
}
