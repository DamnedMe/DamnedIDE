import type { SqlColumnInfo, SqlDiagramData } from '../../types/sql'

export interface TableLayout {
  name: string
  columns: SqlColumnInfo[]
  visibleColumns: SqlColumnInfo[]
  hiddenColumnCount: number
  x: number
  y: number
  w: number
  h: number
  colY: (column: SqlColumnInfo) => number
}

export function layoutSqlDiagram(data: SqlDiagramData): TableLayout[] {
  const columnHeight = 20
  const headerHeight = 26
  const padding = 60
  const maxCardColumns = 8
  const tables = data.tables.map(table => {
    const width = Math.min(260, Math.max(170, 20 + Math.max(
      ...table.columns.map(column => column.name.length + column.type.length + 4),
      12
    ) * 7))
    return {
      name: table.name,
      columns: table.columns,
      visibleColumns: table.columns.slice(0, maxCardColumns),
      hiddenColumnCount: Math.max(0, table.columns.length - maxCardColumns),
      w: width,
      h: headerHeight + Math.min(table.columns.length, maxCardColumns) * columnHeight + (table.columns.length > maxCardColumns ? 22 : 6),
      x: 0,
      y: 0
    }
  })
  const tableIndex = new Map(tables.map((table, index) => [table.name, index]))
  const adjacency = new Map<number, Set<number>>()

  for (const edge of data.edges) {
    const from = tableIndex.get(edge.table)
    const to = tableIndex.get(edge.referencedTable)
    if (from === undefined || to === undefined) continue
    if (!adjacency.has(from)) adjacency.set(from, new Set())
    if (!adjacency.has(to)) adjacency.set(to, new Set())
    adjacency.get(from)!.add(to)
    adjacency.get(to)!.add(from)
  }

  // Traverse connected tables together, starting from relationship hubs. The
  // resulting order preserves local context without turning cyclic schemas
  // into an unusable hundreds-of-thousands-pixel strip.
  const remaining = new Set(tables.map((_, index) => index))
  const ordered: number[] = []
  while (remaining.size > 0) {
    let start = -1
    let bestDegree = -1
    for (const index of remaining) {
      const degree = adjacency.get(index)?.size || 0
      if (degree > bestDegree || (degree === bestDegree && (start < 0 || tables[index].name.localeCompare(tables[start].name) < 0))) {
        start = index
        bestDegree = degree
      }
    }
    const queue = [start]
    remaining.delete(start)
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor]
      ordered.push(current)
      const neighbours = [...(adjacency.get(current) || [])]
        .filter(index => remaining.has(index))
        .sort((left, right) => (adjacency.get(right)?.size || 0) - (adjacency.get(left)?.size || 0)
          || tables[left].name.localeCompare(tables[right].name))
      for (const neighbour of neighbours) {
        remaining.delete(neighbour)
        queue.push(neighbour)
      }
    }
  }

  const columnCount = Math.max(1, Math.ceil(Math.sqrt(tables.length * 1.45)))
  const rowCount = Math.ceil(tables.length / columnCount)
  const columnWidths = Array.from({ length: columnCount }, () => 0)
  const rowHeights = Array.from({ length: rowCount }, () => 0)
  ordered.forEach((index, position) => {
    const column = position % columnCount
    const row = Math.floor(position / columnCount)
    columnWidths[column] = Math.max(columnWidths[column], tables[index].w)
    rowHeights[row] = Math.max(rowHeights[row], tables[index].h)
  })
  const columnX: number[] = []
  const rowY: number[] = []
  let cursorX = padding
  for (let column = 0; column < columnCount; column++) {
    columnX[column] = cursorX
    cursorX += columnWidths[column] + 90
  }
  let cursorY = padding
  for (let row = 0; row < rowCount; row++) {
    rowY[row] = cursorY
    cursorY += rowHeights[row] + 64
  }
  ordered.forEach((index, position) => {
    tables[index].x = columnX[position % columnCount]
    tables[index].y = rowY[Math.floor(position / columnCount)]
  })

  return tables.map(table => ({
    ...table,
    colY: (column: SqlColumnInfo) => {
      const index = table.columns.indexOf(column)
      return index < maxCardColumns
        ? headerHeight + Math.max(0, index) * columnHeight + columnHeight / 2
        : table.h - 11
    }
  }))
}
