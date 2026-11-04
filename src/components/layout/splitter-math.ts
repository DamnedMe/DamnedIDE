// Pure drag math for ResizableSplitter (React-free, so it runs under node checks).

export interface DragSplitOptions {
  minSize: number
  maxSize?: number
  /** width (horizontal) or height (vertical) of the whole splitter */
  containerSize: number
  /** raw size below which the first pane snaps closed; default minSize / 2 */
  collapseAt?: number
  /** only callers that pass onCollapse can be collapsed by a drag */
  collapsible: boolean
}

/**
 * Size of the first pane for a raw drag size (start size + mouse delta):
 * clamped to [minSize, maxSize] and to [40, container - 40]; `collapse` is
 * true when a collapsible pane is dragged past the snap threshold.
 */
export function dragSplitSize(raw: number, o: DragSplitOptions): { size: number; collapse: boolean } {
  const threshold = o.collapseAt ?? Math.round(o.minSize / 2)
  let size = Math.max(o.minSize, raw)
  if (o.maxSize !== undefined) size = Math.min(o.maxSize, size)
  size = Math.max(40, Math.min(o.containerSize - 40, size))
  return { size, collapse: o.collapsible && raw < threshold }
}
