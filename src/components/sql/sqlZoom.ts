// Per-section zoom of the SQL workbench (object explorer, query editor, output):
// pure math, no React/DOM, checked by scripts/sql-zoom.check.ts.
// The zoom multiplies the IDE font size; its bounds keep the resulting text
// between SQL_ZOOM_MIN_FONT and SQL_ZOOM_MAX_FONT px, so the % shown to the user
// always matches the real size and fixed-height chrome stays usable.

export const SQL_ZOOM_STEP = 1.1
export const SQL_ZOOM_MIN_FONT = 8
export const SQL_ZOOM_MAX_FONT = 32

export interface SqlZoomBounds {
  min: number
  max: number
}

/** Zoom range for an IDE font size; 100% is always allowed. */
export function sqlZoomBounds(fontSize: number): SqlZoomBounds {
  return {
    min: Math.min(1, SQL_ZOOM_MIN_FONT / fontSize),
    max: Math.max(1, SQL_ZOOM_MAX_FONT / fontSize)
  }
}

export function clampSqlZoom(zoom: number, bounds: SqlZoomBounds): number {
  return Math.min(bounds.max, Math.max(bounds.min, zoom))
}

/**
 * One zoom step in or out (direction > 0 = in). Rounded to 3 decimals so that
 * stepping in and back out returns exactly to the starting value.
 */
export function stepSqlZoom(current: number, direction: number, bounds: SqlZoomBounds): number {
  const next = direction > 0 ? current * SQL_ZOOM_STEP : current / SQL_ZOOM_STEP
  return clampSqlZoom(Math.round(next * 1000) / 1000, bounds)
}

/** A persisted zoom value, or 1 when it is missing or invalid. */
export function normalizeSqlZoom(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1
}
