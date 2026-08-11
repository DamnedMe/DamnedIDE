import { useRef, useState, useEffect, useCallback } from 'react'
import { SqlQueryResult, SqlForeignKeyInfo } from '../../types/sql'
import { Table2, Download, ZoomIn, ZoomOut, KeyRound, Link2, Pin } from 'lucide-react'

interface ResultViewerProps {
  results: SqlQueryResult | null
  onJoinRequest?: (fk: SqlForeignKeyInfo) => void
  onFilterRequest?: (col: string, value: unknown) => void
}

const PK_COLOR = '#e3b341'
const PK_BG = 'rgba(227, 179, 65, 0.10)'
const FK_COLOR = '#c678dd'
const FK_BG = 'rgba(198, 120, 221, 0.10)'
const JOIN_DIVIDER = '2px solid #e5a33e'
const DEFAULT_COL_W = 160

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

function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0') + '00'
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${ms}`
}

export function ResultViewer({ results, onJoinRequest, onFilterRequest }: ResultViewerProps) {
  const [fontSize, setFontSize] = useState(11)
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const [colWidths, setColWidths] = useState<Record<string, number>>({})
  const [pinned, setPinned] = useState<string[]>([])
  const resizeRef = useRef<{ col: string; startX: number; startW: number } | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const colTypes = results?.colTypes || {}
  const primaryKeys = new Set(results?.primaryKeys || [])
  const foreignKeys = new Set(results?.foreignKeys || [])
  const fkInfoMap = new Map<string, SqlForeignKeyInfo>((results?.foreignKeyInfo || []).map(f => [f.column, f]))

  // First result column that does NOT belong to the base (FROM) table → where the
  // LEFT JOINed columns start. Only meaningful for `SELECT *` style queries.
  const baseCols = new Set(results?.baseTableColumns || [])
  const joinStartIndex = results && results.baseTableColumns && results.baseTableColumns.length > 0
    ? results.columns.findIndex(c => !baseCols.has(c))
    : -1

  const togglePin = (col: string) => {
    setPinned(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col])
  }

  const pinnedLeft = (col: string): number => {
    const idx = pinned.indexOf(col)
    if (idx === -1) return 0
    let left = 0
    for (let i = 0; i < idx; i++) left += colWidths[pinned[i]] ?? DEFAULT_COL_W
    return left
  }

  const formatValue = useCallback((col: string, v: unknown): string => {
    if (v === null || v === undefined) return 'NULL'
    if (colTypes[col] === 'date') {
      const d = v instanceof Date ? v : new Date(String(v))
      if (!isNaN(d.getTime())) return formatDate(d)
    }
    return String(v)
  }, [colTypes])

  // Ctrl/Cmd+C copies the selected rows as tab-separated values (like VS results grid).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!results || selectedRows.size === 0) return
      if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c')) return
      const container = containerRef.current
      if (!container || !container.contains(document.activeElement)) return
      e.preventDefault()
      const rows = results.rows.filter((_, i) => selectedRows.has(i))
      const cell = (c: string, v: unknown) => {
        const s = formatValue(c, v)
        return /[\t\n\r]/.test(s) ? s.replace(/\t/g, ' ').replace(/\r?\n/g, ' ') : s
      }
      const lines = [
        results.columns.join('\t'),
        ...rows.map(r => results.columns.map(c => cell(c, r[c])).join('\t'))
      ]
      navigator.clipboard.writeText(lines.join('\n')).catch(() => {})
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [results, selectedRows, formatValue])

  if (!results) {
    return (
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-muted)', background: 'var(--bg-card)',
        border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
        gap: '8px', fontSize: '11px', fontFamily: 'var(--font-mono)'
      }}>
        <Table2 size={24} strokeWidth={1} />
        run a query to see results
      </div>
    )
  }

  const toggleRow = (i: number) => {
    setSelectedRows(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const exportSelected = () => {
    const rows = selectedRows.size > 0
      ? results.rows.filter((_, i) => selectedRows.has(i))
      : results.rows
    const csv = toCsv(results.columns, rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'query_results.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const startResize = (e: React.MouseEvent, col: string) => {
    e.preventDefault()
    e.stopPropagation()
    const startW = colWidths[col] ?? 160
    resizeRef.current = { col, startX: e.clientX, startW }
    const onMove = (ev: MouseEvent) => {
      const r = resizeRef.current
      if (!r) return
      const w = Math.max(60, r.startW + (ev.clientX - r.startX))
      setColWidths(prev => ({ ...prev, [r.col]: w }))
    }
    const onUp = () => {
      resizeRef.current = null
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

  const btnStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '20px', height: '18px', padding: 0,
    background: 'transparent', border: '1px solid transparent',
    borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)',
    cursor: 'pointer', transition: 'color 0.15s ease'
  }

  return (
    <div style={{
      flex: 1, background: 'var(--bg-card)',
      border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
      overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0
    }}>
      <div style={{
        padding: '5px 10px', borderBottom: '1px solid var(--border-subtle)',
        fontSize: '10px', fontFamily: 'var(--font-mono)',
        color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>results</span>
          <span style={{ color: 'var(--accent-color)' }}>
            {results.rowCount} rows{selectedRows.size > 0 ? ` · ${selectedRows.size} selected` : ''}
          </span>
          {(primaryKeys.size > 0 || foreignKeys.size > 0) && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '9px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}><KeyRound size={9} style={{ color: PK_COLOR }} /> PK</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}><Link2 size={9} style={{ color: FK_COLOR }} /> FK</span>
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '1px', alignItems: 'center' }}>
          <button style={btnStyle} title="zoom out" onClick={() => setFontSize(f => Math.max(8, f - 1))}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
            <ZoomOut size={10} />
          </button>
          <span style={{ minWidth: '24px', textAlign: 'center', fontSize: '9px', color: 'var(--text-muted)' }}>{fontSize}px</span>
          <button style={btnStyle} title="zoom in" onClick={() => setFontSize(f => Math.min(20, f + 1))}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
            <ZoomIn size={10} />
          </button>
          <button
            onClick={exportSelected}
            title={selectedRows.size > 0 ? `export ${selectedRows.size} selected rows` : 'export all rows to csv'}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              padding: '2px 8px', marginLeft: '6px', height: '18px',
              background: 'var(--accent-bg)', border: '1px solid var(--accent-color)',
              borderRadius: 'var(--radius-sm)', color: 'var(--accent-color)',
              cursor: 'pointer', fontSize: '9px', fontFamily: 'var(--font-mono)',
              fontWeight: 600
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-color)'; e.currentTarget.style.color = 'var(--text-inverse)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-bg)'; e.currentTarget.style.color = 'var(--accent-color)' }}>
            <Download size={9} /> csv
          </button>
        </div>
      </div>
      <div ref={containerRef} tabIndex={0} style={{
        flex: 1, overflow: 'auto', fontSize: `${fontSize}px`,
        fontFamily: 'var(--font-mono)', outline: 'none'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              {results.columns.map((col, ci) => {
                const acc = colAccent(col)
                const w = colWidths[col] ?? DEFAULT_COL_W
                const isPinned = pinned.includes(col)
                const isJoinStart = ci === joinStartIndex
                return (
                  <th key={col} style={{
                    position: 'sticky', top: 0, padding: '4px 8px',
                    textAlign: 'left',
                    background: 'var(--bg-card)',
                    boxShadow: 'inset 0 0 0 1000px var(--bg-active)',
                    borderBottom: '2px solid var(--border-color)',
                    borderLeft: isJoinStart ? JOIN_DIVIDER : undefined,
                    color: acc ? acc.color : 'var(--accent-color)',
                    fontWeight: 600, whiteSpace: 'nowrap',
                    fontSize: `${Math.max(9, fontSize - 1)}px`,
                    width: w, minWidth: w, maxWidth: w,
                    overflow: 'hidden', textOverflow: 'ellipsis',
                    left: isPinned ? pinnedLeft(col) : undefined,
                    zIndex: isPinned ? 4 : 2
                  }}>
                    <div style={{ position: 'relative', height: '100%', display: 'flex', alignItems: 'center' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', maxWidth: '100%', overflow: 'hidden' }}>
                        {acc && (acc.tag === 'PK'
                          ? <KeyRound size={9} style={{ flexShrink: 0, color: PK_COLOR }} />
                          : <Link2 size={9} style={{ flexShrink: 0, color: FK_COLOR }} />)}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{col}</span>
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); togglePin(col) }}
                        title={isPinned ? 'unpin column' : 'pin column'}
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
                        title="drag to resize"
                        style={{
                          position: 'absolute', top: -4, right: -8, bottom: -4, width: '6px',
                          cursor: 'col-resize', zIndex: 2
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-color)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                      />
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {results.rows.map((row, i) => {
              const isSelected = selectedRows.has(i)
              return (
                <tr key={i}
                  onClick={(e) => {
                    containerRef.current?.focus({ preventScroll: true })
                    if (e.ctrlKey || e.metaKey || e.shiftKey) toggleRow(i)
                    else setSelectedRows(isSelected ? new Set() : new Set([i]))
                  }}
                  style={{
                    background: isSelected ? 'var(--accent-bg)' : (i % 2 === 0 ? 'transparent' : 'var(--bg-subtle)'),
                    cursor: 'pointer'
                  }}>
                  {results.columns.map((col, ci) => {
                    const acc = colAccent(col)
                    const w = colWidths[col] ?? DEFAULT_COL_W
                    const raw = row[col]
                    const txt = formatValue(col, raw)
                    const fk = fkInfoMap.get(col)
                    const isPk = primaryKeys.has(col)
                    const clickable = (isPk && !!onFilterRequest) || (!!fk && !!onJoinRequest)
                    const isPinned = pinned.includes(col)
                    const isJoinStart = ci === joinStartIndex
                    return (
                      <td key={col}
                        onClick={isPk && onFilterRequest
                          ? (e) => {
                              // Ctrl/Shift → row multi-select as usual
                              if (e.ctrlKey || e.metaKey || e.shiftKey) return
                              e.stopPropagation()
                              onFilterRequest(col, raw)
                            }
                          : fk && onJoinRequest
                            ? (e) => { e.stopPropagation(); onJoinRequest(fk) }
                            : undefined}
                        title={isPk && onFilterRequest
                          ? `click: filter by ${col} = ${raw === null ? 'NULL' : String(raw)}`
                          : fk && onJoinRequest
                            ? `click: left join ${fk.referencedTable} on ${fk.referencedColumn}`
                            : undefined}
                        style={{
                          padding: '3px 8px', borderBottom: '1px solid var(--border-subtle)',
                          borderLeft: isJoinStart ? JOIN_DIVIDER : undefined,
                          borderRight: isPinned ? '1px solid var(--border-color)' : undefined,
                          color: raw === null ? 'var(--text-muted)' : 'var(--text-primary)',
                          background: isPinned ? 'var(--bg-card)' : (acc ? acc.bg : 'transparent'),
                          boxShadow: isPinned
                            ? (acc
                                ? `inset 0 0 0 1000px ${acc.bg}`
                                : isSelected
                                  ? 'inset 0 0 0 1000px var(--accent-bg)'
                                  : (i % 2 === 0 ? undefined : 'inset 0 0 0 1000px var(--bg-subtle)'))
                            : undefined,
                          whiteSpace: 'nowrap', width: w, minWidth: w, maxWidth: w,
                          overflow: 'hidden', textOverflow: 'ellipsis',
                          cursor: clickable ? 'pointer' : 'inherit',
                          textDecorationLine: fk && onJoinRequest ? 'underline' : 'none',
                          textDecorationStyle: 'dotted',
                          textDecorationColor: fk ? FK_COLOR : undefined,
                          position: isPinned ? 'sticky' : undefined,
                          left: isPinned ? pinnedLeft(col) : undefined,
                          zIndex: isPinned ? 1 : undefined
                        }}
                      >
                        {txt}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
