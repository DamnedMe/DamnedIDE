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
): { totalWidth: number; pinnedLeft: Record<string, number>; columnLeft: Record<string, number>; columnWidth: Record<string, number>; railWidth: number } {
  const widthOf = (column: string): number => widths[column] ?? defaultWidth
  // Pinned columns live in a fixed rail on the left, ordered like the result.
  // They are removed from the scrolling flow, so the columns before them take
  // the space they leave free instead of being hidden under the pinned ones.
  const pinnedLeft: Record<string, number> = {}
  let railWidth = 0
  for (const column of columns) {
    if (!pinned.includes(column)) continue
    pinnedLeft[column] = railWidth
    railWidth += widthOf(column)
  }
  let totalWidth = railWidth
  const columnLeft: Record<string, number> = {}
  const columnWidth: Record<string, number> = {}
  for (const column of columns) {
    columnWidth[column] = widthOf(column)
    if (pinned.includes(column)) continue
    columnLeft[column] = totalWidth
    totalWidth += columnWidth[column]
  }
  return { totalWidth, pinnedLeft, columnLeft, columnWidth, railWidth }
}
