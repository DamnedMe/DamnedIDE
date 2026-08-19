import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SqlExecutionResult, SqlForeignKeyInfo, SqlQueryResult } from '../../types/sql'
import { Table2, Download, ZoomIn, ZoomOut, KeyRound, Link2, Pin, X, Timer, AlertTriangle, FileCode2, Trash2, Check, Pencil, Filter, ArrowUp, ArrowDown } from 'lucide-react'
import { buildDeleteStatement, buildUpdateStatement, parseEditedValue } from './sqlForm'
import { calculateColumnMetrics, calculateVisibleRange } from './sqlGridUtils'
import { SqlGridFilter, SqlGridFilterOperator, SqlGridQueryState } from '../../types/sql'

interface ResultViewerProps {
  execution: SqlExecutionResult | null
  getResultTableName?: () => string | undefined
  onJoinRequest?: (fk: SqlForeignKeyInfo) => void
  onFilterRequest?: (col: string, value: unknown) => void
  onClear?: () => void
  /** executes a statement (UPDATE/DELETE) and refreshes the grid on success */
  onExecuteSql?: (query: string) => Promise<boolean>
  /** asks the panel to confirm and run a DELETE statement */
  onDeleteRequest?: (query: string) => void
  gridQueryState?: SqlGridQueryState | null
  gridQuerySupported?: { supported: boolean; reason?: string }
  onGridQueryStateChange?: (state: SqlGridQueryState) => void
}

const PK_COLOR = '#e3b341'
const PK_BG = 'rgba(227, 179, 65, 0.10)'
const FK_COLOR = '#c678dd'
const FK_BG = 'rgba(198, 120, 221, 0.10)'
const JOIN_DIVIDER = '2px solid #e5a33e'
const DEFAULT_COL_W = 160
const ROW_H = 26
const ROW_WINDOW_BUFFER = 8
const ROW_WINDOW_GUARD = 2
const DEFAULT_FONT_SIZE = 11
const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 20

function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const lines = [columns.map(esc).join(',')]
  for (const row of rows) lines.push(columns.map((c) => esc(row[c])).join(','))
  return lines.join('\r\n')
}

function toSqlInserts(table: string, columns: string[], rows: Record<string, unknown>[], colTypes: Record<string, string>): string {
  const lit = (col: string, v: unknown): string => {
    if (v === null || v === undefined) return 'NULL'
    if (colTypes[col] === 'date' && v instanceof Date) {
      const p = (n: number) => String(n).padStart(2, '0')
      return `'${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}'`
    }
    if (colTypes[col] === 'number' || colTypes[col] === 'bigint' || colTypes[col] === 'boolean') return String(v)
    return `N'${String(v).replace(/'/g, "''")}'`
  }
  const names = columns.map(c => `[${c}]`).join(', ')
  const values = rows.map(r => `(${columns.map(c => lit(c, r[c])).join(', ')})`)
  const chunks: string[] = []
  for (let i = 0; i < values.length; i += 50) {
    chunks.push(`INSERT INTO ${table} (${names})\nVALUES\n${values.slice(i, i + 50).join(',\n')};`)
  }
  return chunks.join('\n\n')
}

function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0') + '00'
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${p(d.getFullYear())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${ms}`
}

interface VisibleResultColumn {
  column: string
  index: number
  left: number
  width: number
}

interface ResultGridRowProps {
  index: number
  row: Record<string, unknown>
  rowHeight: number
  totalWidth: number
  selected: boolean
  visibleColumns: VisibleResultColumn[]
  primaryKeys: Set<string>
  foreignKeys: Set<string>
  foreignKeyInfo: Map<string, SqlForeignKeyInfo>
  pinned: string[]
  pinnedLeft: Record<string, number>
  scrollLeft: number
  joinStartIndex: number
  editing: { row: number; col: string; value: string } | null
  editable: boolean
  savingEdit: boolean
  onFilterRequest?: (col: string, value: unknown) => void
  onJoinRequest?: (fk: SqlForeignKeyInfo) => void
  formatValue: (col: string, value: unknown) => string
  isDoubleClick: (row: number, col: string) => boolean
  onRowClick: (event: React.MouseEvent, row: number, selected: boolean) => void
  onRowContextMenu: (event: React.MouseEvent, row: number) => void
  onStartEdit: (row: number, col: string, value: string) => void
  onEditValueChange: (value: string) => void
  onCommitEdit: () => void
  onCancelEdit: () => void
}

const ResultGridRow = memo(function ResultGridRow({
  index, row, rowHeight, totalWidth, selected, visibleColumns, primaryKeys, foreignKeys,
  foreignKeyInfo, pinned, pinnedLeft, scrollLeft, joinStartIndex, editing, editable,
  savingEdit, onFilterRequest, onJoinRequest, formatValue, isDoubleClick, onRowClick,
  onRowContextMenu, onStartEdit, onEditValueChange, onCommitEdit, onCancelEdit
}: ResultGridRowProps) {
  return (
    <div
      data-result-row={index}
      role="row"
      onClick={(event) => onRowClick(event, index, selected)}
      onContextMenu={(event) => onRowContextMenu(event, index)}
      style={{
        position: 'absolute', top: index * rowHeight, left: 0, width: totalWidth, height: rowHeight,
        background: selected ? 'var(--accent-bg)' : (index % 2 === 0 ? 'transparent' : 'var(--bg-subtle)'),
        cursor: 'pointer'
      }}
    >
      {visibleColumns.map(({ column: col, index: ci, left: columnLeft, width }) => {
        const raw = row[col]
        const isNull = raw === null || raw === undefined
        const text = formatValue(col, raw)
        const fk = foreignKeyInfo.get(col)
        const isPk = primaryKeys.has(col)
        const accent = isPk
          ? { color: PK_COLOR, bg: PK_BG }
          : foreignKeys.has(col) ? { color: FK_COLOR, bg: FK_BG } : null
        const clickable = (isPk && !!onFilterRequest) || (!!fk && !!onJoinRequest)
        const isPinned = pinned.includes(col)
        const isEditingCell = editing?.row === index && editing.col === col
        return (
          <div
            key={col}
            role="gridcell"
            aria-label={text}
            data-result-column={col}
            data-null-cell={isNull ? 'true' : undefined}
            onClick={isPk && onFilterRequest
              ? (event) => {
                  if (event.ctrlKey || event.metaKey || event.shiftKey || isDoubleClick(index, col)) return
                  event.stopPropagation()
                  onFilterRequest(col, raw)
                }
              : fk && onJoinRequest
                ? (event) => {
                    if (isDoubleClick(index, col)) return
                    event.stopPropagation()
                    onJoinRequest(fk)
                  }
                : undefined}
            onDoubleClick={(event) => {
              event.stopPropagation()
              if (editable && !savingEdit) onStartEdit(index, col, raw == null ? '' : String(raw))
            }}
            title={isPk && onFilterRequest
              ? (editable ? 'double-click to edit · ' : '') + `click: filter by ${col} = ${raw === null ? 'NULL' : String(raw)}`
              : fk && onJoinRequest
                ? (editable ? 'double-click to edit · ' : '') + `click: left join ${fk.referencedTable} on ${fk.referencedColumn}`
                : editable ? 'double-click to edit' : undefined}
            data-tip-desc="primary key: click to filter · foreign key: click to join"
            style={{
              padding: '0 8px', height: rowHeight, display: 'flex', alignItems: 'center',
              borderLeft: ci === joinStartIndex ? JOIN_DIVIDER : undefined,
              borderRight: isPinned ? '1px solid var(--border-color)' : undefined,
              color: isNull ? 'var(--text-secondary)' : 'var(--text-primary)',
              background: isNull
                ? 'rgba(127, 140, 155, 0.18)'
                : isPinned ? (accent?.bg || 'var(--bg-card)') : (accent?.bg || 'transparent'),
              fontStyle: isNull ? 'italic' : undefined,
              whiteSpace: 'nowrap', width, minWidth: width, maxWidth: width, boxSizing: 'border-box',
              overflow: 'hidden', textOverflow: 'ellipsis',
              cursor: clickable ? 'pointer' : (editable ? 'text' : 'inherit'),
              textDecorationLine: fk && onJoinRequest ? 'underline' : 'none',
              textDecorationStyle: 'dotted', textDecorationColor: fk ? FK_COLOR : undefined,
              position: 'absolute', left: isPinned ? scrollLeft + (pinnedLeft[col] || 0) : columnLeft,
              zIndex: isPinned ? 2 : undefined,
              boxShadow: isPinned ? '2px 0 0 0 var(--border-color)' : undefined
            }}
          >
            {isEditingCell ? (
              <input
                autoFocus
                value={editing.value}
                onChange={(event) => onEditValueChange(event.target.value)}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === 'Enter') onCommitEdit()
                  if (event.key === 'Escape') onCancelEdit()
                }}
                onBlur={onCancelEdit}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                spellCheck={false}
                style={{
                  position: 'absolute', inset: 0, width: '100%', height: '100%', padding: '0 6px',
                  boxSizing: 'border-box', background: 'var(--bg-input)', border: '1px solid var(--accent-color)',
                  borderRadius: '2px', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
                  fontSize: 'inherit', outline: 'none'
                }}
              />
            ) : (
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>{text}</span>
            )}
          </div>
        )
      })}
    </div>
  )
})

function GridFilterDialog({ column, dataType, x, y, initial, onApply, onClose }: {
  column: string
  dataType: string
  x: number
  y: number
  initial?: SqlGridFilter
  onApply: (filter: SqlGridFilter | null) => void
  onClose: () => void
}) {
  const numeric = /^(?:number|bigint|int|decimal|numeric|float|real|money|smallmoney|tinyint|smallint)$/i.test(dataType)
  const boolean = /^(?:boolean|bit)$/i.test(dataType)
  const date = /date|time/i.test(dataType)
  const defaultOperator: SqlGridFilterOperator = numeric || date ? 'eq' : 'contains'
  const [operator, setOperator] = useState<SqlGridFilterOperator>(initial?.operator || defaultOperator)
  const [value, setValue] = useState(initial?.value || (boolean ? '1' : ''))
  const [secondValue, setSecondValue] = useState(initial?.secondValue || '')
  const noValue = operator === 'isNull' || operator === 'isNotNull'
  const options: Array<[SqlGridFilterOperator, string]> = boolean
    ? [['eq', 'is'], ['neq', 'is not'], ['isNull', 'is NULL'], ['isNotNull', 'is not NULL']]
    : numeric || date
      ? [['eq', 'equals'], ['neq', 'not equal'], ['gt', 'greater than'], ['gte', 'greater or equal'], ['lt', 'less than'], ['lte', 'less or equal'], ['between', 'between'], ['isNull', 'is NULL'], ['isNotNull', 'is not NULL']]
      : [['eq', 'equals'], ['neq', 'not equal'], ['contains', 'contains'], ['startsWith', 'starts with'], ['isNull', 'is NULL'], ['isNotNull', 'is not NULL']]
  return (
    <div role="dialog" aria-label={`filter ${column}`} style={{
      position: 'fixed', left: Math.min(x, window.innerWidth - 270), top: Math.min(y, window.innerHeight - 215), zIndex: 180,
      width: 255, padding: 10, background: 'var(--bg-card)', border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', fontFamily: 'var(--font-mono)'
    }} onKeyDown={event => { if (event.key === 'Escape') onClose() }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 9 }}>
        <Filter size={10} color="var(--accent-color)" /><strong style={{ marginLeft: 6, fontSize: 10, flex: 1 }}>{column}</strong>
        <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>{dataType}</span>
      </div>
      <select autoFocus aria-label="filter operator" value={operator} onChange={event => setOperator(event.target.value as SqlGridFilterOperator)} style={{ width: '100%', height: 27, padding: '0 6px', background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: 3, fontSize: 9 }}>
        {options.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
      {!noValue && (
        <div style={{ display: 'flex', gap: 5, marginTop: 7 }}>
          {boolean ? (
            <select aria-label="filter value" value={value} onChange={event => setValue(event.target.value)} style={{ width: '100%', height: 27, background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}><option value="1">true</option><option value="0">false</option></select>
          ) : (
            <input aria-label="filter value" type={date ? 'datetime-local' : numeric ? 'number' : 'text'} value={value} onChange={event => setValue(event.target.value)} style={{ minWidth: 0, flex: 1, height: 27, padding: '0 6px', background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: 3, fontSize: 9 }} />
          )}
          {operator === 'between' && <input aria-label="second filter value" type={date ? 'datetime-local' : 'number'} value={secondValue} onChange={event => setSecondValue(event.target.value)} style={{ minWidth: 0, flex: 1, height: 27, padding: '0 6px', background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: 3, fontSize: 9 }} />}
        </div>
      )}
      <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end', marginTop: 10 }}>
        {initial && <button onClick={() => onApply(null)} style={{ ...tinyGridButton, marginRight: 'auto', color: 'var(--error-color)' }}>remove filter</button>}
        <button onClick={onClose} style={tinyGridButton}>cancel</button>
        <button aria-label="apply filter" disabled={!noValue && (value === '' || (operator === 'between' && secondValue === ''))} onClick={() => onApply({ column, dataType, operator, value, secondValue })} style={{ ...tinyGridButton, borderColor: 'var(--accent-color)', color: 'var(--accent-color)' }}>apply</button>
      </div>
    </div>
  )
}

const tinyGridButton: React.CSSProperties = {
  height: 25, padding: '0 8px', background: 'transparent', border: '1px solid var(--border-color)',
  color: 'var(--text-secondary)', borderRadius: 3, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 9
}

export function ResultViewer({ execution, getResultTableName, onJoinRequest, onFilterRequest, onClear, onExecuteSql, onDeleteRequest, gridQueryState, gridQuerySupported, onGridQueryStateChange }: ResultViewerProps) {
  const [activeSet, setActiveSet] = useState(0)
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE)
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const [colWidths, setColWidths] = useState<Record<string, number>>({})
  const [pinned, setPinned] = useState<string[]>([])
  const [scrollLeft, setScrollLeft] = useState(0)
  const [viewportH, setViewportH] = useState(0)
  const [viewportW, setViewportW] = useState(0)
  const [rowWindow, setRowWindow] = useState({ start: 0, end: 0 })
  const [editing, setEditing] = useState<{ row: number; col: string; value: string } | null>(null)
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; row: number } | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [filterEditor, setFilterEditor] = useState<{ column: string; x: number; y: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const resizeRef = useRef<{ col: string; startX: number; startW: number } | null>(null)
  const rafRef = useRef<number | null>(null)
  const scrollRafRef = useRef<number | null>(null)
  const pendingScrollTopRef = useRef(0)
  const pendingScrollLeftRef = useRef(0)
  const rowWindowRef = useRef({ start: 0, end: 0 })
  const filterReturnFocusRef = useRef<HTMLButtonElement | null>(null)
  // double-click guard: the PK/FK single-click action must not fire when the
  // user double-clicks a cell to edit it
  const lastCellClickRef = useRef<{ time: number; row: number; col: string } | null>(null)

  const results = execution?.results || []
  const result = results[Math.min(activeSet, Math.max(0, results.length - 1))] as SqlQueryResult | undefined

  // Reset selection/tab when a new execution arrives.
  useEffect(() => {
    setSelectedRows(new Set())
    setActiveSet(0)
    setScrollLeft(0)
    setEditing(null)
    setRowMenu(null)
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
      scrollRef.current.scrollLeft = 0
    }
  }, [execution])

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const updateViewport = () => {
      setViewportH(el.clientHeight)
      setViewportW(el.clientWidth)
    }
    const observer = new ResizeObserver(updateViewport)
    observer.observe(el)
    updateViewport()
    return () => observer.disconnect()
  }, [execution])

  const colTypes = result?.colTypes || {}
  const primaryKeys = useMemo(() => new Set(result?.primaryKeys || []), [result])
  const foreignKeys = useMemo(() => new Set(result?.foreignKeys || []), [result])
  const fkInfoMap = useMemo(() => new Map<string, SqlForeignKeyInfo>(
    (result?.foreignKeyInfo || []).map(f => [f.column, f])
  ), [result])

  const baseCols = useMemo(() => new Set(result?.baseTableColumns || []), [result])
  const joinStartIndex = result && result.baseTableColumns && result.baseTableColumns.length > 0
    ? result.columns.findIndex(c => !baseCols.has(c))
    : -1

  const rows = result?.rows || []
  const columns = result?.columns || []

  const zoomScale = fontSize / DEFAULT_FONT_SIZE
  const rowHeight = Math.max(22, Math.round(ROW_H * zoomScale))
  const defaultColumnWidth = Math.round(DEFAULT_COL_W * zoomScale)
  const scaledColWidths = useMemo(
    () => Object.fromEntries(Object.entries(colWidths).map(([column, width]) => [column, Math.round(width * zoomScale)])),
    [colWidths, zoomScale]
  )

  const updateRowWindow = useCallback((nextScrollTop: number, force = false) => {
    const visible = calculateVisibleRange(rows.length, nextScrollTop, viewportH, rowHeight, 0)
    const current = rowWindowRef.current
    const approachingTop = current.start > 0 && visible.start < current.start + ROW_WINDOW_GUARD
    const approachingBottom = current.end < rows.length && visible.end > current.end - ROW_WINDOW_GUARD
    if (!force && current.end > current.start && !approachingTop && !approachingBottom) return

    const next = calculateVisibleRange(rows.length, nextScrollTop, viewportH, rowHeight, ROW_WINDOW_BUFFER)
    if (next.start === current.start && next.end === current.end) return
    rowWindowRef.current = next
    setRowWindow(next)
  }, [rowHeight, rows.length, viewportH])

  useEffect(() => {
    rowWindowRef.current = { start: 0, end: 0 }
    updateRowWindow(0, true)
  }, [execution, updateRowWindow])

  const columnMetrics = useMemo(
    () => calculateColumnMetrics(columns, scaledColWidths, pinned, defaultColumnWidth),
    [columns, scaledColWidths, pinned, defaultColumnWidth]
  )
  const totalWidth = columnMetrics.totalWidth
  const visibleColumns = useMemo(() => {
    const overscan = Math.max(320, viewportW * 0.35)
    const left = Math.max(0, scrollLeft - overscan)
    const right = scrollLeft + viewportW + overscan
    return columns.flatMap((column, index) => {
      const columnLeft = columnMetrics.columnLeft[column] || 0
      const width = columnMetrics.columnWidth[column] || defaultColumnWidth
      if (!pinned.includes(column) && (columnLeft + width < left || columnLeft > right)) return []
      return [{ column, index, left: columnLeft, width }]
    })
  }, [columnMetrics, columns, defaultColumnWidth, pinned, scrollLeft, viewportW])
  const baseColumnCount = Math.min(columns.length, result?.baseTableColumns?.length || columns.length)
  const baseTableLabel = getResultTableName?.()?.split('.').pop() || 'result'
  const columnGroups = useMemo(() => {
    const groups: Array<{ key: string; label: string; joined: boolean; left: number; width: number }> = []
    for (let index = 0; index < columns.length; index++) {
      const column = columns[index]
      const separator = column.lastIndexOf('.')
      const joined = index >= baseColumnCount
      const label = joined && separator > 0 ? column.slice(0, separator) : baseTableLabel
      const key = `${joined ? 'joined' : 'base'}:${label}`
      const left = columnMetrics.columnLeft[column] || 0
      const width = columnMetrics.columnWidth[column] || defaultColumnWidth
      const previous = groups[groups.length - 1]
      if (previous?.key === key) previous.width = left + width - previous.left
      else groups.push({ key, label, joined, left, width })
    }
    return groups
  }, [baseColumnCount, baseTableLabel, columnMetrics, columns, defaultColumnWidth])
  const visibleColumnGroups = columnGroups.filter(group =>
    group.left + group.width >= scrollLeft && group.left <= scrollLeft + viewportW)

  const filters = gridQueryState?.filters || []
  const sorts = gridQueryState?.sorts || []
  const currentFilter = filterEditor ? filters.find(filter => filter.column === filterEditor.column) : undefined

  const changeSort = (column: string, additive: boolean) => {
    if (!gridQueryState || !onGridQueryStateChange || !gridQuerySupported?.supported) return
    const current = sorts.find(sort => sort.column === column)
    let next = additive ? sorts.filter(sort => sort.column !== column) : []
    if (!current) next = [...next, { column, direction: 'asc' }]
    else if (current.direction === 'asc') next = [...next, { column, direction: 'desc' }]
    onGridQueryStateChange({ ...gridQueryState, sorts: next })
  }

  const applyFilter = (filter: SqlGridFilter | null) => {
    if (!gridQueryState || !onGridQueryStateChange) return
    const next = filters.filter(item => item.column !== filterEditor?.column)
    if (filter) next.push(filter)
    onGridQueryStateChange({ ...gridQueryState, filters: next })
    setFilterEditor(null)
    window.setTimeout(() => filterReturnFocusRef.current?.focus(), 0)
  }

  const closeFilterEditor = () => {
    setFilterEditor(null)
    window.setTimeout(() => filterReturnFocusRef.current?.focus(), 0)
  }

  const clearGridQuery = () => {
    if (!gridQueryState || !onGridQueryStateChange) return
    onGridQueryStateChange({ ...gridQueryState, filters: [], sorts: [] })
  }

  const togglePin = (col: string) => {
    setPinned(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col])
  }

  const pinnedLeft = (col: string): number => columnMetrics.pinnedLeft[col] ?? 0

  const changeZoom = useCallback((delta: number) => {
    setFontSize(current => Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, current + delta)))
  }, [])

  const formatValue = useCallback((col: string, v: unknown): string => {
    if (v === null || v === undefined) return 'NULL'
    if (colTypes[col] === 'date') {
      const d = v instanceof Date ? v : new Date(String(v))
      if (!isNaN(d.getTime())) return formatDate(d)
    }
    return String(v)
  }, [colTypes])

  // Ctrl/Cmd+C copies the selected rows as tab-separated values.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!result || selectedRows.size === 0) return
      if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c')) return
      const container = scrollRef.current
      if (!container || !container.contains(document.activeElement)) return
      e.preventDefault()
      const sel = rows.filter((_, i) => selectedRows.has(i))
      const cell = (c: string, v: unknown) => {
        const s = formatValue(c, v)
        return /[\t\n\r]/.test(s) ? s.replace(/\t/g, ' ').replace(/\r?\n/g, ' ') : s
      }
      const lines = [
        columns.join('\t'),
        ...sel.map(r => columns.map(c => cell(c, r[c])).join('\t'))
      ]
      navigator.clipboard.writeText(lines.join('\n')).catch(() => {})
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [result, selectedRows, formatValue, rows, columns])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const container = scrollRef.current
      if (!container || !container.contains(document.activeElement)) return
      if (event.key === '+' || event.key === '=' || event.key === 'Add') {
        event.preventDefault()
        changeZoom(1)
      } else if (event.key === '-' || event.key === 'Subtract') {
        event.preventDefault()
        changeZoom(-1)
      } else if (event.key === '0') {
        event.preventDefault()
        setFontSize(DEFAULT_FONT_SIZE)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [changeZoom])

  const exportCsv = () => {
    if (!result) return
    const sel = selectedRows.size > 0 ? rows.filter((_, i) => selectedRows.has(i)) : rows
    const csv = toCsv(columns, sel)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'query_results.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportSql = () => {
    if (!result) return
    const table = getResultTableName?.()
    const name = table ? table.split('.').map(p => `[${p}]`).join('.') : '[result]'
    const sel = selectedRows.size > 0 ? rows.filter((_, i) => selectedRows.has(i)) : rows
    const header = table
      ? `-- ${sel.length} row${sel.length === 1 ? '' : 's'} from ${name}`
      : '-- select a table (FROM clause) to get the real table name'
    const sql = `${header}\n${toSqlInserts(name, columns, sel, colTypes)}`
    const blob = new Blob([sql], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'query_results.sql'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Column resize: coalesce writes to one per animation frame.
  const startResize = (e: React.MouseEvent, col: string) => {
    e.preventDefault()
    e.stopPropagation()
    resizeRef.current = { col, startX: e.clientX, startW: colWidths[col] ?? DEFAULT_COL_W }
    const onMove = (ev: MouseEvent) => {
      const r = resizeRef.current
      if (!r) return
      if (rafRef.current !== null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        const w = Math.max(60, r.startW + (ev.clientX - r.startX) / zoomScale)
        setColWidths(prev => ({ ...prev, [r.col]: w }))
      })
    }
    const onUp = () => {
      resizeRef.current = null
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const colAccent = (col: string): { color: string; bg: string; tag: string } | null => {
    if (primaryKeys.has(col)) return { color: PK_COLOR, bg: PK_BG, tag: 'PK' }
    if (foreignKeys.has(col)) return { color: FK_COLOR, bg: FK_BG, tag: 'FK' }
    return null
  }

  // ─── Windowing ───────────────────────────────────────────────────────────
  const startIdx = Math.min(rowWindow.start, rows.length)
  const endIdx = Math.min(Math.max(rowWindow.end, startIdx), rows.length)
  const visibleRows = useMemo(
    () => {
      const out: { index: number; row: Record<string, unknown> }[] = []
      for (let i = startIdx; i < endIdx; i++) out.push({ index: i, row: rows[i] })
      return out
    },
    [startIdx, endIdx, rows]
  )

  const editable = primaryKeys.size > 0 && !!getResultTableName?.() && !!onExecuteSql
  const resultTableName = useCallback((): string | undefined => getResultTableName?.(), [getResultTableName])

  const toggleRow = useCallback((index: number) => {
    setSelectedRows(previous => {
      const next = new Set(previous)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  const handleRowClick = useCallback((event: React.MouseEvent, index: number, selected: boolean) => {
    scrollRef.current?.focus({ preventScroll: true })
    if (event.ctrlKey || event.metaKey || event.shiftKey) toggleRow(index)
    else setSelectedRows(selected ? new Set() : new Set([index]))
  }, [toggleRow])

  const handleRowContextMenu = useCallback((event: React.MouseEvent, index: number) => {
    event.preventDefault()
    event.stopPropagation()
    if (!editable) return
    setSelectedRows(new Set([index]))
    setRowMenu({ x: event.clientX, y: event.clientY, row: index })
  }, [editable])

  const isDoubleClick = useCallback((row: number, col: string): boolean => {
    const last = lastCellClickRef.current
    const now = Date.now()
    if (last && last.row === row && last.col === col && now - last.time < 300) return true
    lastCellClickRef.current = { time: now, row, col }
    return false
  }, [])

  const startEdit = useCallback((row: number, col: string, value: string) => {
    if (!editable) return
    setRowMenu(null)
    setEditing({ row, col, value })
  }, [editable])

  const changeEditingValue = useCallback((value: string) => {
    setEditing(current => current ? { ...current, value } : current)
  }, [])

  const cancelEdit = useCallback(() => setEditing(null), [])

  const commitEdit = useCallback(async () => {
    if (!editing || !result || !onExecuteSql) return
    const table = resultTableName()
    if (!table) return
    const raw = rows[editing.row]
    if (!raw) return
    const newValue = parseEditedValue(editing.value, colTypes, editing.col)
    const update = buildUpdateStatement(table, columns, raw, editing.col, newValue, colTypes, [...primaryKeys])
    if (!update) return
    setSavingEdit(true)
    try {
      const ok = await onExecuteSql(update)
      if (ok) setEditing(null)
    } finally {
      setSavingEdit(false)
    }
  }, [colTypes, columns, editing, onExecuteSql, primaryKeys, result, resultTableName, rows])

  const btnStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '20px', height: '18px', padding: 0,
    background: 'transparent', border: '1px solid transparent',
    borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)',
    cursor: 'pointer', transition: 'color 140ms ease'
  }

  if (!execution || !result) {
    return (
      <div className="sql-results-empty" style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-muted)', background: 'var(--bg-card)',
        border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
        gap: '8px', fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
      }}>
        <Table2 size={24} strokeWidth={1} />
        run a query to see results
      </div>
    )
  }

  if (execution.results.length > 1) {
    return (
      <div data-testid="sql-multi-result" style={{
        flex: 1, minHeight: 0, overflow: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: 10,
        background: 'var(--bg-secondary)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 9.5 }}>
          <span>{execution.results.length} result sets · {execution.totalRowCount} rows total</span>
          {onClear && <button style={{ ...btnStyle, marginLeft: 'auto' }} title="clear results" data-tip-desc="clear the displayed results" onClick={onClear}><X size={10} /></button>}
        </div>
        {execution.results.map((set, index) => {
          const height = Math.min(500, Math.max(190, 112 + Math.min(set.rowCount, 14) * 25))
          const singleExecution: SqlExecutionResult = {
            ...execution,
            results: [set],
            totalRowCount: set.rowCount,
            truncated: execution.truncated && set.rowCount >= execution.maxRows
          }
          return (
            <section key={index} role="region" aria-label={`Result set ${index + 1}`} style={{
              height, minHeight: 190, flexShrink: 0, display: 'flex', flexDirection: 'column',
              borderRadius: 'var(--radius-md)', boxShadow: '0 1px 0 var(--border-subtle)'
            }}>
              <div style={{ height: 25, flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 9px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderBottom: 0, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600 }}>
                Result set {index + 1} · {set.rowCount} row{set.rowCount === 1 ? '' : 's'}
              </div>
              <ResultViewer
                execution={singleExecution}
                getResultTableName={() => undefined}
                onExecuteSql={onExecuteSql}
                gridQuerySupported={{ supported: false, reason: 'Filtering is available only for a single compatible SELECT result.' }}
              />
            </section>
          )
        })}
      </div>
    )
  }

  // ─── Edit rows ───────────────────────────────────────────────────────────
  const requestDelete = (rowIdx: number) => {
    if (!result || !onDeleteRequest) return
    const table = resultTableName()
    if (!table) return
    const raw = rows[rowIdx]
    if (!raw) return
    const del = buildDeleteStatement(table, columns, raw, colTypes, [...primaryKeys])
    if (!del) return
    onDeleteRequest(del)
    setRowMenu(null)
  }

  const totalShown = Math.min(rows.length, execution.maxRows)
  const isTruncated = execution.truncated

  const renderRowMenu = () => {
    if (!rowMenu || !editable) return null
    const row = rows[rowMenu.row]
    return (
      <>
        <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setRowMenu(null)} />
        <div style={{
          position: 'fixed', left: Math.min(rowMenu.x, window.innerWidth - 200), top: Math.min(rowMenu.y, window.innerHeight - 140),
          zIndex: 200, background: 'var(--bg-card)', border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)', padding: '4px 0', minWidth: '180px',
          boxShadow: 'var(--shadow-lg)', animation: 'menuIn 140ms ease', fontFamily: 'var(--font-mono)'
        }}>
          <div style={{
            padding: '5px 12px', fontSize: 'calc(9.5px * var(--ui-text-scale, 1))', color: 'var(--text-muted)',
            borderBottom: '1px solid var(--border-subtle)', marginBottom: '4px'
          }}>
            row {rowMenu.row + 1}
          </div>
          <div onClick={() => requestDelete(rowMenu.row)}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px',
              fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', cursor: 'pointer',
              color: 'var(--error-color)'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--error-bg)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
            <Trash2 size={12} />
            delete row
          </div>
        </div>
      </>
    )
  }

  return (
    <section className="sql-results sql-surface" style={{
      flex: 1, background: 'var(--bg-card)',
      border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
      overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0
    }}>
      <header className="sql-results__toolbar" style={{
        padding: '5px 10px', borderBottom: '1px solid var(--border-subtle)',
        fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
        color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', flexShrink: 0, gap: '8px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <span style={{ color: 'var(--accent-color)' }}>
            {result.rowCount} rows{selectedRows.size > 0 ? ` · ${selectedRows.size} selected` : ''}
          </span>
          {editable && (
            <span style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px' }}>
              <Pencil size={8} /> double-click to edit · right-click row to delete
            </span>
          )}
          {results.length > 1 && (
            <span style={{ display: 'flex', gap: '2px' }}>
              {results.map((r, i) => (
                <button key={i} onClick={() => { setActiveSet(i); setSelectedRows(new Set()) }}
                  style={{
                    padding: '1px 8px', fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
                    background: i === activeSet ? 'var(--accent-bg)' : 'transparent',
                    color: i === activeSet ? 'var(--accent-color)' : 'var(--text-muted)',
                    border: '1px solid ' + (i === activeSet ? 'var(--accent-color)' : 'var(--border-color)'),
                    borderRadius: '999px', cursor: 'pointer'
                  }}>
                  set {i + 1} · {r.rowCount}
                </button>
              ))}
            </span>
          )}
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)' }}>
            <Timer size={9} /> {execution.elapsedMs} ms
          </span>
          {(primaryKeys.size > 0 || foreignKeys.size > 0) && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'calc(9px * var(--ui-text-scale, 1))' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}><KeyRound size={9} style={{ color: PK_COLOR }} /> PK</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}><Link2 size={9} style={{ color: FK_COLOR }} /> FK</span>
            </span>
          )}
          {isTruncated && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: 'var(--warning-color)', fontSize: 'calc(9px * var(--ui-text-scale, 1))' }}>
              <AlertTriangle size={9} /> truncated at {totalShown}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '1px', alignItems: 'center' }}>
          <button style={btnStyle} title="zoom out (Ctrl+-)" data-tip-desc="zoom out the results grid (Ctrl+-)" onClick={() => changeZoom(-1)}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
            <ZoomOut size={10} />
          </button>
          <span data-testid="result-grid-zoom-level" aria-label={`result grid zoom ${Math.round(zoomScale * 100)} percent`}
            style={{ minWidth: '32px', textAlign: 'center', fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)' }}>{Math.round(zoomScale * 100)}%</span>
          <button style={btnStyle} title="zoom in (Ctrl++)" data-tip-desc="zoom in the results grid (Ctrl++)" onClick={() => changeZoom(1)}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
            <ZoomIn size={10} />
          </button>
          <button
            onClick={exportCsv}
            title={selectedRows.size > 0 ? `export ${selectedRows.size} selected rows` : 'export all rows to csv'}
            data-tip-desc="export the grid as a CSV file"
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              padding: '2px 8px', marginLeft: '6px', height: '18px',
              background: 'var(--accent-bg)', border: '1px solid var(--accent-color)',
              borderRadius: 'var(--radius-sm)', color: 'var(--accent-color)',
              cursor: 'pointer', fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
              fontWeight: 600
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-color)'; e.currentTarget.style.color = 'var(--text-inverse)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-bg)'; e.currentTarget.style.color = 'var(--accent-color)' }}>
            <Download size={9} /> csv
          </button>
          <button
            onClick={exportSql}
            title={selectedRows.size > 0 ? `export ${selectedRows.size} selected rows as sql insert` : 'export all rows as sql insert'}
            data-tip-desc="generate SQL INSERT statements from the grid"
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              padding: '2px 8px', marginLeft: '4px', height: '18px',
              background: 'transparent', border: '1px solid var(--accent-secondary)',
              borderRadius: 'var(--radius-sm)', color: 'var(--accent-secondary)',
              cursor: 'pointer', fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
              fontWeight: 600, transition: 'background 140ms ease, color 140ms ease'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-secondary)'; e.currentTarget.style.color = 'var(--text-inverse)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--accent-secondary)' }}>
            <FileCode2 size={9} /> sql
          </button>
          {onClear && (
            <button style={{ ...btnStyle, marginLeft: '4px' }} title="clear results" data-tip-desc="clear the displayed results" onClick={onClear}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-color)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
              <X size={10} />
            </button>
          )}
        </div>
      </header>

      {(filters.length > 0 || sorts.length > 0 || gridQuerySupported?.supported === false) && (
        <div style={{ minHeight: 27, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)', fontFamily: 'var(--font-mono)', fontSize: 8.5 }}>
          {gridQuerySupported?.supported === false && <span role="status" style={{ color: 'var(--warning-color)' }}>{gridQuerySupported.reason}</span>}
          {filters.map(filter => <button key={filter.column} aria-label={`active filter ${filter.column}`} title="remove filter" data-tip-desc="remove the filter from this column" onClick={() => onGridQueryStateChange?.({ ...gridQueryState!, filters: filters.filter(item => item.column !== filter.column) })} style={{ ...tinyGridButton, height: 19, color: 'var(--accent-color)', borderColor: 'var(--accent-color)' }}><Filter size={8} /> {filter.column} · {filter.operator} {filter.value} ×</button>)}
          {sorts.map((sort, index) => <button key={sort.column} aria-label={`active sort ${sort.column}`} title="remove sorting" data-tip-desc="remove the sorting from this column" onClick={() => onGridQueryStateChange?.({ ...gridQueryState!, sorts: sorts.filter(item => item.column !== sort.column) })} style={{ ...tinyGridButton, height: 19, display: 'inline-flex', alignItems: 'center' }}>{sort.direction === 'asc' ? '↑' : '↓'} {index + 1} · {sort.column} ×</button>)}
          {(filters.length > 0 || sorts.length > 0) && <button aria-label="clear all grid filters and sorting" onClick={clearGridQuery} style={{ ...tinyGridButton, height: 19, marginLeft: 'auto' }}>clear all</button>}
        </div>
      )}

      {columns.length === 0 ? (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: execution.canceled ? 'var(--warning-color)' : 'var(--text-muted)',
          fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
        }}>
          {execution.canceled
            ? 'query canceled'
            : (execution.rowsAffected.length > 0 && execution.rowsAffected[0] > 0
              ? `${execution.rowsAffected[0]} row${execution.rowsAffected[0] === 1 ? '' : 's'} affected`
              : 'query completed — no rows returned')}
        </div>
      ) : (
        <div
          ref={scrollRef}
          tabIndex={0}
          role="grid"
          aria-label="query results grid"
          aria-keyshortcuts="Control++ Control+- Control+0"
          onWheel={(event) => {
            if (!(event.ctrlKey || event.metaKey)) return
            event.preventDefault()
            changeZoom(event.deltaY < 0 ? 1 : -1)
          }}
          onScroll={(e) => {
            const el = e.currentTarget
            pendingScrollTopRef.current = el.scrollTop
            pendingScrollLeftRef.current = el.scrollLeft
            if (scrollRafRef.current !== null) return
            scrollRafRef.current = requestAnimationFrame(() => {
              scrollRafRef.current = null
              updateRowWindow(pendingScrollTopRef.current)
              setScrollLeft(pendingScrollLeftRef.current)
            })
          }}
          style={{
            flex: 1, overflow: 'auto', fontSize: `${fontSize}px`,
            fontFamily: 'var(--font-mono)', outline: 'none', position: 'relative'
          }}
        >
          {/* The header lives inside the same scroll container as the body, so
              the browser synchronizes horizontal scrolling without React work. */}
          <div style={{
            position: 'sticky', top: 0, zIndex: 10, width: totalWidth,
            background: 'var(--bg-card)'
          }}>
            <div style={{ position: 'relative', height: rowHeight + 18 }}>
              {visibleColumnGroups.map(group => {
                const labelOffset = Math.min(Math.max(7, scrollLeft - group.left + 7), Math.max(7, group.width - 130))
                return (
                  <div key={group.key}
                    role="group"
                    aria-label={`column group ${group.joined ? 'joined' : 'base'} ${group.label}`}
                    style={{
                      position: 'absolute', top: 0, left: group.left, width: group.width, height: '18px', boxSizing: 'border-box',
                      borderRight: '1px solid var(--border-color)', borderBottom: `1px solid ${group.joined ? FK_COLOR : 'var(--accent-color)'}`,
                      background: group.joined ? FK_BG : 'var(--accent-bg)', overflow: 'hidden'
                    }}>
                    <span style={{
                      position: 'absolute', left: labelOffset, top: '3px', whiteSpace: 'nowrap',
                      color: group.joined ? FK_COLOR : 'var(--accent-color)', fontSize: 'calc(8px * var(--ui-text-scale, 1))', fontWeight: 700,
                      letterSpacing: '0.35px', textTransform: 'uppercase'
                    }}>
                      {group.joined ? 'joined' : 'base'} · {group.label}
                    </span>
                  </div>
                )
              })}
              {visibleColumns.map(({ column: col, index: ci, left: columnLeft, width: w }) => {
                const acc = colAccent(col)
                const isPinned = pinned.includes(col)
                const isJoinStart = ci === joinStartIndex
                const sortIndex = sorts.findIndex(sort => sort.column === col)
                const sort = sortIndex >= 0 ? sorts[sortIndex] : undefined
                const filtered = filters.some(filter => filter.column === col)
                const columnQuerySupported = ci < baseColumnCount
                return (
                  <div key={col}
                    role="columnheader"
                    aria-label={col}
                    style={{
                      padding: '4px 8px', flexShrink: 0, top: 18,
                      background: ci >= baseColumnCount ? FK_BG : 'var(--bg-active)',
                      borderBottom: '2px solid var(--border-color)',
                      borderLeft: isJoinStart ? JOIN_DIVIDER : undefined,
                      color: acc ? acc.color : 'var(--accent-color)',
                      fontWeight: 600, whiteSpace: 'nowrap',
                      fontSize: `${Math.max(9, fontSize - 1)}px`,
                      width: w, minWidth: w, maxWidth: w,
                      height: rowHeight, boxSizing: 'border-box',
                      overflow: 'hidden', textOverflow: 'ellipsis',
                      position: 'absolute',
                      left: isPinned ? scrollLeft + pinnedLeft(col) : columnLeft,
                      zIndex: isPinned ? 12 : 11,
                      boxShadow: isPinned ? '2px 0 0 0 var(--border-color)' : undefined,
                      display: 'flex', alignItems: 'center'
                    }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', minWidth: 0, flex: 1, overflow: 'hidden' }}>
                      {acc && (acc.tag === 'PK'
                        ? <KeyRound size={9} style={{ flexShrink: 0, color: PK_COLOR }} />
                        : <Link2 size={9} style={{ flexShrink: 0, color: FK_COLOR }} />)}
                      <button
                        aria-label={`sort ${col}`}
                        disabled={!gridQuerySupported?.supported || !columnQuerySupported}
                        onClick={event => { event.stopPropagation(); changeSort(col, event.shiftKey) }}
                        onKeyDown={event => {
                          if (event.key === 'Enter') { event.preventDefault(); changeSort(col, event.shiftKey) }
                          if (event.altKey && event.key === 'ArrowDown') {
                            event.preventDefault()
                            filterReturnFocusRef.current = event.currentTarget
                            const rect = event.currentTarget.getBoundingClientRect()
                            setFilterEditor({ column: col, x: rect.left, y: rect.bottom + 4 })
                          }
                        }}
                        title={!columnQuerySupported ? 'Joined output aliases cannot be rewritten safely.' : gridQuerySupported?.supported ? 'sort · Shift-click for multi-sort' : gridQuerySupported?.reason}
                        data-tip-desc="sort the grid by this column"
                        style={{ border: 0, padding: 0, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: 'transparent', color: 'inherit', font: 'inherit', cursor: gridQuerySupported?.supported ? 'pointer' : 'not-allowed', textAlign: 'left' }}
                      >{col}</button>
                      {sort && <span aria-label={`sort priority ${col} ${sortIndex + 1} ${sort.direction === 'asc' ? 'ascending' : 'descending'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: 'var(--accent-color)', flexShrink: 0 }}>{sort.direction === 'asc' ? <ArrowUp size={8} /> : <ArrowDown size={8} />}{sortIndex + 1}</span>}
                    </span>
                    {onGridQueryStateChange && (
                      <button
                        aria-label={`filter ${col}`}
                        disabled={!gridQuerySupported?.supported || !columnQuerySupported}
                        onClick={event => {
                          event.stopPropagation()
                          filterReturnFocusRef.current = event.currentTarget
                          const rect = event.currentTarget.getBoundingClientRect()
                          setFilterEditor({ column: col, x: rect.left, y: rect.bottom + 4 })
                        }}
                        title={!columnQuerySupported ? 'Joined output aliases cannot be rewritten safely.' : gridQuerySupported?.supported ? `filter ${col}` : gridQuerySupported?.reason}
                        data-tip-desc="filter the grid by this column"
                        style={{ display: 'flex', flexShrink: 0, padding: 2, border: 0, background: filtered ? 'var(--accent-bg)' : 'transparent', color: filtered ? 'var(--accent-color)' : 'var(--text-muted)', cursor: gridQuerySupported?.supported ? 'pointer' : 'not-allowed' }}>
                        <Filter size={9} fill={filtered ? 'currentColor' : 'none'} />
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); togglePin(col) }}
                      title={isPinned ? 'unpin column' : 'pin column'} data-tip-desc='pin or unpin this column'
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'none', border: 'none', cursor: 'pointer',
                        padding: 0, marginLeft: 4, flexShrink: 0,
                        color: isPinned ? 'var(--accent-color)' : 'var(--text-muted)'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
                      onMouseLeave={(e) => { if (!isPinned) e.currentTarget.style.color = 'var(--text-muted)' }}
                    >
                      <Pin size={9} fill={isPinned ? 'currentColor' : 'none'} />
                    </button>
                    <div
                      onMouseDown={(e) => startResize(e, col)}
                      title="drag to resize" data-tip-desc="drag to resize the panel"
                      style={{
                        position: 'absolute', top: -4, right: -8, bottom: -4, width: '6px',
                        cursor: 'col-resize', zIndex: 15
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-color)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                    />
                  </div>
                )
              })}
            </div>
          </div>

          {/* Virtualized body */}
          <div data-result-body style={{ height: rows.length * rowHeight, width: totalWidth, position: 'relative' }}>
            {visibleRows.map(({ index, row }) => (
              <ResultGridRow
                key={index}
                index={index}
                row={row}
                rowHeight={rowHeight}
                totalWidth={totalWidth}
                selected={selectedRows.has(index)}
                visibleColumns={visibleColumns}
                primaryKeys={primaryKeys}
                foreignKeys={foreignKeys}
                foreignKeyInfo={fkInfoMap}
                pinned={pinned}
                pinnedLeft={columnMetrics.pinnedLeft}
                scrollLeft={scrollLeft}
                joinStartIndex={joinStartIndex}
                editing={editing}
                editable={editable}
                savingEdit={savingEdit}
                onFilterRequest={onFilterRequest}
                onJoinRequest={onJoinRequest}
                formatValue={formatValue}
                isDoubleClick={isDoubleClick}
                onRowClick={handleRowClick}
                onRowContextMenu={handleRowContextMenu}
                onStartEdit={startEdit}
                onEditValueChange={changeEditingValue}
                onCommitEdit={commitEdit}
                onCancelEdit={cancelEdit}
              />
            ))}
          </div>
        </div>
      )}
      {filterEditor && (
        <GridFilterDialog
          column={filterEditor.column}
          dataType={colTypes[filterEditor.column] || 'string'}
          x={filterEditor.x}
          y={filterEditor.y}
          initial={currentFilter}
          onApply={applyFilter}
          onClose={closeFilterEditor}
        />
      )}
      {renderRowMenu()}
    </section>
  )
}
