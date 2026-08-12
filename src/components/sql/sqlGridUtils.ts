export interface VisibleRange {
  start: number
  end: number
}

export function calculateVisibleRange(
  rowCount: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan: number
): VisibleRange {
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(rowCount, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan)
  return { start, end }
}

export function calculateColumnMetrics(
  columns: string[],
  widths: Record<string, number>,
  pinned: string[],
  defaultWidth: number
): { totalWidth: number; pinnedLeft: Record<string, number>; columnLeft: Record<string, number>; columnWidth: Record<string, number> } {
  let totalWidth = 0
  const columnLeft: Record<string, number> = {}
  const columnWidth: Record<string, number> = {}
  for (const column of columns) {
    columnLeft[column] = totalWidth
    columnWidth[column] = widths[column] ?? defaultWidth
    totalWidth += columnWidth[column]
  }
  const pinnedLeft: Record<string, number> = {}
  let left = 0
  for (const column of pinned) {
    pinnedLeft[column] = left
    left += widths[column] ?? defaultWidth
  }
  return { totalWidth, pinnedLeft, columnLeft, columnWidth }
}
