import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SqlDiagramData } from '../../types/sql'
import { buildExplicitSelect } from './sqlQueryUtils'
import {
  Workflow, ZoomIn, ZoomOut, Maximize2, RefreshCw, Download, X,
  Loader2, Image, Search, Play, PanelRightClose
} from 'lucide-react'
import { layoutSqlDiagram, TableLayout } from './sqlDiagramLayout'

interface DiagramViewProps {
  connId: string
  database: string
  tables?: string[]
  onClose: () => void
  onRunQuery: (query: string) => void
  trackOperation?: <T>(label: string, operation: () => Promise<T>) => Promise<T>
}

interface Point { x: number; y: number }

const PK_COLOR = '#e3b341'
const FK_COLOR = '#c678dd'
const PAD = 60
const DETAIL_ZOOM = 0.34
const STORE_KEY_PREFIX = 'damnedide_sql_diagram_pos_'
const diagramRequests = new Map<string, Promise<SqlDiagramData>>()

function requestKey(connId: string, database: string, tables?: string[]) {
  return `${connId}:${database}:${[...(tables || [])].sort().join('|')}`
}

function positionKey(connId: string, database: string, tables?: string[]) {
  return `${STORE_KEY_PREFIX}${requestKey(connId, database, tables)}`
}

function loadPositions(connId: string, database: string, tables?: string[]): Record<string, Point> {
  try {
    const raw = localStorage.getItem(positionKey(connId, database, tables))
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function savePositions(connId: string, database: string, tables: string[] | undefined, positions: Record<string, Point>) {
  try {
    localStorage.setItem(positionKey(connId, database, tables), JSON.stringify(positions))
  } catch { /* local storage is an optional convenience */ }
}

function shortName(name: string, max = 31) {
  return name.length <= max ? name : `${name.slice(0, max - 1)}…`
}

export function DiagramView({ connId, database, tables, onClose, onRunQuery, trackOperation }: DiagramViewProps) {
  const [data, setData] = useState<SqlDiagramData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [positions, setPositions] = useState<Record<string, Point>>({})
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })
  const [viewport, setViewport] = useState({ w: 600, h: 400 })
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const svgRef = useRef<SVGSVGElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const positionsRef = useRef(positions)
  const dragRef = useRef<{ table: string; startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null)
  const panDragRef = useRef<{ startX: number; startY: number; origPanX: number; origPanY: number } | null>(null)
  const panFrameRef = useRef<number | null>(null)
  const pendingPanRef = useRef<Point | null>(null)
  const fitRef = useRef<() => void>(() => {})
  positionsRef.current = positions

  const load = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    const key = requestKey(connId, database, tables)
    if (force) diagramRequests.delete(key)
    let pending = diagramRequests.get(key)
    if (!pending) {
      const request = () => window.electronAPI.sql.diagram(connId, database, tables)
      pending = trackOperation
        ? trackOperation(`Generating diagram for ${database}`, request)
        : request()
      diagramRequests.set(key, pending)
      if (diagramRequests.size > 8) diagramRequests.delete(diagramRequests.keys().next().value as string)
      pending.catch(() => diagramRequests.delete(key))
    }
    try {
      const next = await pending
      setData(next)
      setPositions(loadPositions(connId, database, tables))
    } catch (loadError) {
      setError((loadError as Error).message)
    } finally {
      setLoading(false)
    }
  }, [connId, database, tables, trackOperation])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const update = () => {
      const next = { w: element.clientWidth, h: element.clientHeight }
      setViewport(current => current.w === next.w && current.h === next.h ? current : next)
    }
    const observer = new ResizeObserver(update)
    observer.observe(element)
    update()
    return () => observer.disconnect()
  }, [])

  const layout = useMemo(() => data ? layoutSqlDiagram(data) : [], [data])
  const tableByName = useMemo(() => new Map(layout.map(table => [table.name, table])), [layout])
  const effectivePos = useMemo(() => {
    const map = new Map<string, Point>()
    for (const table of layout) map.set(table.name, positions[table.name] ?? { x: table.x, y: table.y })
    return map
  }, [layout, positions])

  const bounds = useMemo(() => {
    if (layout.length === 0) return null
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const table of layout) {
      const position = effectivePos.get(table.name)!
      minX = Math.min(minX, position.x)
      minY = Math.min(minY, position.y)
      maxX = Math.max(maxX, position.x + table.w)
      maxY = Math.max(maxY, position.y + table.h)
    }
    return { minX, minY, maxX, maxY }
  }, [layout, effectivePos])

  const fit = useCallback(() => {
    if (!bounds || viewport.w <= 0 || viewport.h <= 0) return
    const width = Math.max(1, bounds.maxX - bounds.minX + PAD * 2)
    const height = Math.max(1, bounds.maxY - bounds.minY + PAD * 2)
    const nextZoom = Math.min(1.15, Math.max(0.04, Math.min((viewport.w - 36) / width, (viewport.h - 36) / height)))
    setZoom(nextZoom)
    setPan({
      x: viewport.w / 2 - (bounds.minX + (bounds.maxX - bounds.minX) / 2) * nextZoom,
      y: viewport.h / 2 - (bounds.minY + (bounds.maxY - bounds.minY) / 2) * nextZoom
    })
  }, [bounds, viewport])
  fitRef.current = fit

  useEffect(() => {
    if (!data || layout.length === 0) return
    const timer = window.setTimeout(() => fitRef.current(), 40)
    return () => window.clearTimeout(timer)
  }, [data, layout.length])

  useEffect(() => () => {
    if (panFrameRef.current !== null) cancelAnimationFrame(panFrameRef.current)
  }, [])

  const focusTable = useCallback((name: string) => {
    const table = tableByName.get(name)
    const position = effectivePos.get(name)
    if (!table || !position) return
    const nextZoom = Math.max(0.72, zoom)
    setSelectedTable(name)
    setZoom(nextZoom)
    setPan({
      x: viewport.w / 2 - (position.x + table.w / 2) * nextZoom,
      y: viewport.h / 2 - (position.y + Math.min(table.h, viewport.h / nextZoom) / 2) * nextZoom
    })
  }, [effectivePos, tableByName, viewport, zoom])

  const searchMatches = useMemo(() => {
    const term = search.trim().toLocaleLowerCase()
    if (!term) return []
    return layout.filter(table => table.name.toLocaleLowerCase().includes(term)).map(table => table.name)
  }, [layout, search])
  const searchMatchSet = useMemo(() => new Set(searchMatches), [searchMatches])

  const overview = zoom < DETAIL_ZOOM
  const visibleTables = useMemo(() => {
    if (overview) return layout
    const margin = 260 / zoom
    const worldLeft = -pan.x / zoom - margin
    const worldTop = -pan.y / zoom - margin
    const worldRight = (viewport.w - pan.x) / zoom + margin
    const worldBottom = (viewport.h - pan.y) / zoom + margin
    return layout.filter(table => {
      const position = effectivePos.get(table.name)!
      return position.x + table.w >= worldLeft && position.x <= worldRight
        && position.y + table.h >= worldTop && position.y <= worldBottom
    })
  }, [effectivePos, layout, overview, pan, viewport, zoom])
  const visibleNames = useMemo(() => new Set(visibleTables.map(table => table.name)), [visibleTables])

  const edgeGeometry = useMemo(() => (data?.edges || []).flatMap(edge => {
    const fromTable = tableByName.get(edge.table)
    const toTable = tableByName.get(edge.referencedTable)
    const from = effectivePos.get(edge.table)
    const to = effectivePos.get(edge.referencedTable)
    if (!fromTable || !toTable || !from || !to) return []
    if (!overview && (!visibleNames.has(edge.table) || !visibleNames.has(edge.referencedTable))) return []
    if (selectedTable && edge.table !== selectedTable && edge.referencedTable !== selectedTable) return []
    const fromColumn = fromTable.columns.find(column => column.name === edge.column) || fromTable.columns[0]
    const toColumn = toTable.columns.find(column => column.name === edge.referencedColumn) || toTable.columns[0]
    const x1 = from.x + fromTable.w
    const y1 = from.y + (fromColumn ? fromTable.colY(fromColumn) : fromTable.h / 2)
    const x2 = to.x
    const y2 = to.y + (toColumn ? toTable.colY(toColumn) : toTable.h / 2)
    const bend = Math.max(42, Math.abs(x2 - x1) * 0.45)
    const direction = x2 >= x1 ? 1 : -1
    return [{
      key: `${edge.constraintName}:${edge.table}:${edge.column}`,
      path: `M ${x1} ${y1} C ${x1 + bend * direction} ${y1}, ${x2 - bend * direction} ${y2}, ${x2} ${y2}`,
      selected: Boolean(selectedTable)
    }]
  }), [data, effectivePos, overview, selectedTable, tableByName, visibleNames])

  const zoomAt = (nextZoom: number, anchorX = viewport.w / 2, anchorY = viewport.h / 2) => {
    const clamped = Math.min(2.5, Math.max(0.04, nextZoom))
    const worldX = (anchorX - pan.x) / zoom
    const worldY = (anchorY - pan.y) / zoom
    setZoom(clamped)
    setPan({ x: anchorX - worldX * clamped, y: anchorY - worldY * clamped })
  }

  const onWheel = (event: React.WheelEvent) => {
    event.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    const anchorX = rect ? event.clientX - rect.left : viewport.w / 2
    const anchorY = rect ? event.clientY - rect.top : viewport.h / 2
    zoomAt(zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), anchorX, anchorY)
  }

  const onDiagramKeyDown = (event: React.KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey)) return
    if (event.key === '+' || event.key === '=' || event.key === 'Add') {
      event.preventDefault()
      zoomAt(zoom * 1.2)
    } else if (event.key === '-' || event.key === 'Subtract') {
      event.preventDefault()
      zoomAt(zoom / 1.2)
    } else if (event.key === '0') {
      event.preventDefault()
      fit()
    }
  }

  const startPan = (event: React.PointerEvent) => {
    if (event.button !== 0) return
    panDragRef.current = { startX: event.clientX, startY: event.clientY, origPanX: pan.x, origPanY: pan.y }
    ;(event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId)
  }

  const movePan = (event: React.PointerEvent) => {
    const drag = panDragRef.current
    if (!drag) return
    pendingPanRef.current = {
      x: drag.origPanX + event.clientX - drag.startX,
      y: drag.origPanY + event.clientY - drag.startY
    }
    if (panFrameRef.current !== null) return
    panFrameRef.current = requestAnimationFrame(() => {
      if (pendingPanRef.current) setPan(pendingPanRef.current)
      panFrameRef.current = null
    })
  }

  const endPan = () => { panDragRef.current = null }

  const startTableDrag = (event: React.PointerEvent, table: TableLayout) => {
    if (event.button !== 0) return
    const position = effectivePos.get(table.name)!
    dragRef.current = {
      table: table.name, startX: event.clientX, startY: event.clientY,
      origX: position.x, origY: position.y, moved: false
    }
    ;(event.currentTarget as SVGGElement).setPointerCapture(event.pointerId)
  }

  const moveTable = (event: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = (event.clientX - drag.startX) / zoom
    const dy = (event.clientY - drag.startY) / zoom
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true
    const next = {
      ...positionsRef.current,
      [drag.table]: { x: Math.max(-400, drag.origX + dx), y: Math.max(-400, drag.origY + dy) }
    }
    positionsRef.current = next
    setPositions(next)
  }

  const endTableDrag = (event: React.PointerEvent) => {
    event.stopPropagation()
    const drag = dragRef.current
    if (!drag) return
    if (!drag.moved) setSelectedTable(drag.table)
    savePositions(connId, database, tables, positionsRef.current)
    dragRef.current = null
  }

  const regenerateLayout = () => {
    setPositions({})
    positionsRef.current = {}
    savePositions(connId, database, tables, {})
    setSelectedTable(null)
    requestAnimationFrame(() => fitRef.current())
  }

  const exportCurrent = (format: 'svg' | 'png') => {
    const svg = svgRef.current
    if (!svg) return
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('width', String(viewport.w))
    clone.setAttribute('height', String(viewport.h))
    const source = new XMLSerializer().serializeToString(clone)
    if (format === 'svg') {
      const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `diagram_${database}.svg`
      anchor.click()
      URL.revokeObjectURL(url)
      return
    }
    const image = document.createElement('img')
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = viewport.w
      canvas.height = viewport.h
      const context = canvas.getContext('2d')
      if (!context) return
      context.fillStyle = '#0f1117'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0)
      canvas.toBlob(blob => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `diagram_${database}.png`
        anchor.click()
        URL.revokeObjectURL(url)
      }, 'image/png')
    }
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`
  }

  const selected = selectedTable ? tableByName.get(selectedTable) : undefined
  const toolbarButton: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: '28px', height: '28px', background: 'transparent',
    border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
    color: 'var(--text-secondary)', cursor: 'pointer', transition: 'background 160ms ease, color 160ms ease'
  }

  return (
    <section className="sql-diagram sql-surface" data-testid="sql-diagram-view" style={{
      flex: 1, background: 'var(--bg-card)', border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-md)', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0
    }}>
      <header className="sql-diagram__toolbar" style={{
        minHeight: '42px', padding: '6px 8px 6px 12px', borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, background: 'var(--bg-secondary)'
      }}>
        <div style={{ minWidth: '180px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ display: 'inline-flex', color: 'var(--accent-color)' }}><Workflow size={15} /></span>
          <span style={{ minWidth: 0 }}>
            <strong style={{ display: 'block', fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-primary)', fontWeight: 600 }}>{database}</strong>
            <span style={{ display: 'block', fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {data ? `${data.tables.length} tables · ${data.edges.length} relations` : 'database diagram'}
            </span>
          </span>
        </div>

        <label style={{
          position: 'relative', flex: '1 1 260px', maxWidth: '420px', minWidth: '130px',
          display: 'flex', alignItems: 'center'
        }}>
          <Search size={12} style={{ position: 'absolute', left: '9px', color: 'var(--text-muted)' }} />
          <input
            aria-label="search diagram tables"
            value={search}
            onChange={event => setSearch(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && searchMatches[0]) focusTable(searchMatches[0]) }}
            placeholder="Find a table…"
            style={{
              width: '100%', height: '28px', padding: '0 58px 0 28px', boxSizing: 'border-box',
              border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-card)', color: 'var(--text-primary)', outline: 'none',
              fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
            }}
          />
          {search && (
            <span style={{ position: 'absolute', right: '8px', fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)' }}>
              {searchMatches.length} found
            </span>
          )}
        </label>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px', alignItems: 'center' }}>
          <button style={toolbarButton} title="zoom out" data-tip-desc="zoom out the diagram" onClick={() => zoomAt(zoom / 1.2)}><ZoomOut size={12} /></button>
          <span data-testid="diagram-zoom-level" aria-label={`diagram zoom ${Math.round(zoom * 100)} percent`}
            style={{ minWidth: '38px', textAlign: 'center', fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button style={toolbarButton} title="zoom in" data-tip-desc="zoom in the diagram" onClick={() => zoomAt(zoom * 1.2)}><ZoomIn size={12} /></button>
          <button style={toolbarButton} title="fit all tables" data-tip-desc="fit every table into the view" onClick={fit}><Maximize2 size={12} /></button>
          <button style={toolbarButton} title="reset automatic layout" data-tip-desc="reset the automatic layout of the diagram" onClick={regenerateLayout}><RefreshCw size={12} /></button>
          <button style={toolbarButton} title="reload database metadata" data-tip-desc="reload the database metadata from the server" onClick={() => void load(true)} disabled={loading}>
            <Loader2 size={12} style={loading ? { animation: 'spin 0.9s linear infinite' } : undefined} />
          </button>
          <button style={toolbarButton} title="export current view as SVG" data-tip-desc="export the diagram as an SVG image" onClick={() => exportCurrent('svg')}><Download size={12} /></button>
          <button style={toolbarButton} title="export current view as PNG" data-tip-desc="export the diagram as a PNG image" onClick={() => exportCurrent('png')}><Image size={12} /></button>
          <button style={{ ...toolbarButton, marginLeft: '3px' }} title="close diagram" data-tip-desc="close the diagram view" onClick={onClose}><X size={12} /></button>
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
        <div className="sql-diagram__canvas" ref={containerRef} style={{ flex: 1, minWidth: 0, overflow: 'hidden', position: 'relative', background: 'var(--bg-primary)' }}>
          {loading && !data && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', zIndex: 2 }}>
              <div style={{ width: 'min(420px, 72%)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginBottom: '18px', opacity: 0.55 }}>
                  {[84, 108, 92].map((height, index) => (
                    <span key={height} style={{ width: '92px', height, border: '1px solid var(--border-subtle)', borderRadius: '6px', background: 'var(--bg-secondary)', transform: `translateY(${index === 1 ? 12 : 0}px)` }} />
                  ))}
                </div>
                <Loader2 size={15} style={{ animation: 'spin 0.9s linear infinite', marginBottom: '8px' }} />
                <div style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)' }}>Building the relationship map</div>
                <div style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', marginTop: '4px' }}>Loading tables, keys and foreign-key connections…</div>
              </div>
            </div>
          )}
          {error && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: '24px', zIndex: 2 }}>
              <div style={{ maxWidth: '460px', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                <div style={{ color: 'var(--error-color)', fontSize: 'calc(11px * var(--ui-text-scale, 1))', marginBottom: '10px' }}>{error}</div>
                <button style={{ ...toolbarButton, width: 'auto', padding: '0 12px' }} onClick={() => void load(true)}>try again</button>
              </div>
            </div>
          )}
          {!loading && !error && data && layout.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--text-muted)', fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)' }}>
              no tables in this database
            </div>
          )}
          {data && layout.length > 0 && (
            <svg
              ref={svgRef}
              role="img"
              aria-label={`database diagram ${database}`}
              aria-keyshortcuts="Control++ Control+- Control+0"
              tabIndex={0}
              width="100%"
              height="100%"
              style={{ cursor: panDragRef.current ? 'grabbing' : 'grab', touchAction: 'none', display: 'block' }}
              onWheel={onWheel}
              onKeyDown={onDiagramKeyDown}
              onPointerDown={startPan}
              onPointerMove={movePan}
              onPointerUp={endPan}
              onPointerCancel={endPan}
            >
              <defs>
                <pattern id="sql-diagram-grid-small" width="24" height="24" patternUnits="userSpaceOnUse">
                  <path d="M 24 0 L 0 0 0 24" fill="none" stroke="var(--border-subtle)" strokeWidth="0.55" opacity="0.52" />
                </pattern>
                <pattern id="sql-diagram-grid-large" width="120" height="120" patternUnits="userSpaceOnUse">
                  <rect width="120" height="120" fill="url(#sql-diagram-grid-small)" />
                  <path d="M 120 0 L 0 0 0 120" fill="none" stroke="var(--border-color)" strokeWidth="0.7" opacity="0.5" />
                </pattern>
                <marker id="sql-diagram-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill={FK_COLOR} opacity="0.82" />
                </marker>
              </defs>
              <rect width="100%" height="100%" fill="url(#sql-diagram-grid-large)" pointerEvents="none" />
              <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
                <g aria-label="relationships" pointerEvents="none">
                  {edgeGeometry.map(edge => (
                    <path key={edge.key} d={edge.path} fill="none" stroke={edge.selected ? FK_COLOR : 'var(--border-color)'}
                      strokeWidth={overview ? 2.2 : 1.5} opacity={edge.selected ? 0.88 : overview ? 0.46 : 0.6}
                      markerEnd={edge.selected ? 'url(#sql-diagram-arrow)' : undefined} vectorEffect="non-scaling-stroke" />
                  ))}
                </g>
                {visibleTables.map(table => {
                  const position = effectivePos.get(table.name)!
                  const isSelected = selectedTable === table.name
                  const isMatch = searchMatchSet.has(table.name)
                  return (
                    <g
                      key={table.name}
                      data-diagram-table={table.name}
                      transform={`translate(${position.x} ${position.y})`}
                      onPointerDown={event => { event.stopPropagation(); startTableDrag(event, table) }}
                      onPointerMove={event => { event.stopPropagation(); moveTable(event) }}
                      onPointerUp={endTableDrag}
                      onDoubleClick={event => {
                        event.stopPropagation()
                        const source = data?.tables.find(item => item.name === table.name)
                        onRunQuery(buildExplicitSelect(table.name, source?.columns.map(column => column.name) || [], 1000))
                      }}
                      style={{ cursor: dragRef.current?.table === table.name ? 'grabbing' : 'pointer' }}
                    >
                      <title>{table.name} — {table.columns.length} columns</title>
                      <rect x="-7" y="-7" width={table.w + 14} height={(overview ? 48 : table.h) + 14} rx="9"
                        fill={isSelected ? 'var(--accent-bg)' : 'transparent'} opacity={isSelected ? 0.85 : 0} />
                      <rect x="0" y="0" width={table.w} height={overview ? 48 : table.h} rx="7"
                        fill="var(--bg-secondary)" stroke={isSelected || isMatch ? 'var(--accent-color)' : 'var(--border-color)'}
                        strokeWidth={isSelected ? 2 : isMatch ? 1.5 : 1} vectorEffect="non-scaling-stroke" />
                      <rect x="0" y="0" width={table.w} height="27" rx="7" fill={isSelected ? 'var(--bg-active)' : 'var(--bg-card)'} />
                      <path d={`M 0 27 H ${table.w}`} stroke="var(--border-subtle)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                      <text x="10" y="18" fontSize="11" fontWeight="600" fill={isSelected || isMatch ? 'var(--accent-color)' : 'var(--text-primary)'} fontFamily="var(--font-mono)">
                        {shortName(table.name)}
                      </text>
                      {overview ? (
                        <text x="10" y="41" fontSize="8.5" fill="var(--text-muted)" fontFamily="var(--font-mono)">
                          {table.columns.length} columns
                        </text>
                      ) : (
                        <>
                          {table.visibleColumns.map((column, index) => (
                            <g key={column.name} transform={`translate(8 ${28 + index * 20})`}>
                              {column.isPrimaryKey ? <KeyRoundIcon /> : column.isForeignKey ? <Link2Icon /> : null}
                              <text x={column.isPrimaryKey || column.isForeignKey ? 14 : 0} y="13" fontSize="10"
                                fill={column.isPrimaryKey ? PK_COLOR : column.isForeignKey ? FK_COLOR : 'var(--text-secondary)'} fontFamily="var(--font-mono)">
                                {shortName(column.name, 21)}
                              </text>
                              <text x={table.w - 16} y="13" fontSize="8.5" textAnchor="end" fill="var(--text-muted)" fontFamily="var(--font-mono)">
                                {shortName(column.type, 14)}
                              </text>
                              <line x1="0" y1="19" x2={table.w - 16} y2="19" stroke="var(--border-subtle)" strokeWidth="0.5" />
                            </g>
                          ))}
                          {table.hiddenColumnCount > 0 && (
                            <text x="10" y={table.h - 7} fontSize="8.5" fill="var(--text-muted)" fontFamily="var(--font-mono)">
                              + {table.hiddenColumnCount} more columns · inspect →
                            </text>
                          )}
                        </>
                      )}
                    </g>
                  )
                })}
              </g>
            </svg>
          )}

          {data && !loading && (
            <div style={{
              position: 'absolute', left: '10px', bottom: '10px', padding: '5px 8px',
              border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
              background: 'color-mix(in srgb, var(--bg-card) 90%, transparent)', color: 'var(--text-muted)',
              fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', pointerEvents: 'none'
            }}>
              {overview ? 'overview · zoom in for columns' : `${visibleTables.length} visible · drag canvas · double-click table to query`}
            </div>
          )}
        </div>

        {selected && (
          <aside className="sql-diagram__inspector" aria-label={`table details ${selected.name}`} style={{
            width: '286px', minWidth: '240px', maxWidth: '34%', borderLeft: '1px solid var(--border-subtle)',
            background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', minHeight: 0
          }}>
            <div style={{ padding: '12px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', marginBottom: '4px', fontFamily: 'var(--font-mono)' }}>selected table</div>
                <strong style={{ display: 'block', fontSize: 'calc(12px * var(--ui-text-scale, 1))', color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{selected.name}</strong>
                <span style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{selected.columns.length} columns</span>
              </div>
              <button style={toolbarButton} title="close table details" data-tip-desc="close the details of this table" onClick={() => setSelectedTable(null)}><PanelRightClose size={12} /></button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '6px 0' }}>
              {selected.columns.map(column => (
                <div key={column.name} style={{
                  minHeight: '34px', padding: '5px 12px', display: 'grid', gridTemplateColumns: '16px minmax(0, 1fr) auto',
                  gap: '6px', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', fontFamily: 'var(--font-mono)'
                }}>
                  <span style={{ color: column.isPrimaryKey ? PK_COLOR : column.isForeignKey ? FK_COLOR : 'var(--text-muted)', fontSize: 'calc(9px * var(--ui-text-scale, 1))' }}>
                    {column.isPrimaryKey ? 'PK' : column.isForeignKey ? 'FK' : '·'}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 'calc(10px * var(--ui-text-scale, 1))', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{column.name}</span>
                    {column.nullable && <span style={{ fontSize: 'calc(8px * var(--ui-text-scale, 1))', color: 'var(--text-muted)' }}>nullable</span>}
                  </span>
                  <span style={{ fontSize: 'calc(8.5px * var(--ui-text-scale, 1))', color: 'var(--text-muted)' }}>{column.type}</span>
                </div>
              ))}
            </div>
            <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border-subtle)' }}>
              <button onClick={() => onRunQuery(buildExplicitSelect(selected.name, selected.columns.map(column => column.name), 1000))} style={{
                width: '100%', height: '30px', border: '1px solid var(--accent-color)', borderRadius: 'var(--radius-sm)',
                background: 'var(--accent-bg)', color: 'var(--accent-color)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: '7px', cursor: 'pointer', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontWeight: 600
              }}><Play size={11} /> SELECT TOP 1000</button>
            </div>
          </aside>
        )}
      </div>
    </section>
  )
}

function KeyRoundIcon() {
  return (
    <g transform="translate(0 2)" stroke={PK_COLOR} strokeWidth="1.4" fill="none">
      <path d="M2.5 8a4.5 4.5 0 1 0 8.9 1.1A4.5 4.5 0 1 0 2.5 8Z" />
      <line x1="8" y1="9" x2="12" y2="5" />
      <line x1="10.5" y1="6.5" x2="12.5" y2="4.5" />
    </g>
  )
}

function Link2Icon() {
  return (
    <g transform="translate(0 2)" stroke={FK_COLOR} strokeWidth="1.4" fill="none">
      <path d="M9 4a2.5 2.5 0 1 1 3 3l-2 2" />
      <path d="M7 12a2.5 2.5 0 1 1-3-3l2-2" />
    </g>
  )
}
