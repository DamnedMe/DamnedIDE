import { useMemo, useRef, useState } from 'react'
import {
  SqlColumnInfo,
  SqlConnection
} from '../../types/sql'
import { useSqlExplorerStore } from '../../store'
import {
  Database,
  Table2,
  Eye,
  Settings2,
  Braces,
  ChevronRight,
  KeyRound,
  Link2,
  RefreshCw,
  Plug,
  PlugZap,
  Pencil,
  Trash2,
  Play,
  FileCode2,
  Workflow,
  MousePointerClick,
  Loader2,
  Server,
  ListFilter,
  Info,
  Search,
  X
} from 'lucide-react'
import { AUTH_TYPES, connectionLabel } from './sqlForm'
import type { QueryExecutionContext } from './QueryEditor'
import { buildExplicitSelect } from './sqlQueryUtils'
import { localSqlAssistant } from './sqlAssistant'

interface DatabaseExplorerProps {
  connections: SqlConnection[]
  activeConnection: string | null
  activeDatabases: Record<string, string>
  onSelect: (id: string | null) => void
  onReconnect: (id: string) => void
  onDisconnect: (id: string) => void
  onEdit: (conn: SqlConnection) => void
  onRemove: (id: string) => void
  onRunQuery: (query: string, context?: QueryExecutionContext) => void
  onLoadQuery: (query: string, context?: QueryExecutionContext) => void
  onAskConfirmSelectAll: (table: string, context?: QueryExecutionContext, columns?: string[]) => void
  onSetActiveDatabase: (connId: string, database: string) => void
  onOpenDiagram: (connId: string, database: string, tables?: string[]) => void
  onAskRowLimit: (table: string, context?: QueryExecutionContext, columns?: string[]) => void
  onServerInfo: (conn: SqlConnection) => void
  trackOperation: <T>(label: string, operation: () => Promise<T>) => Promise<T>
}

interface ContextMenuState {
  x: number
  y: number
  kind: 'connection' | 'database' | 'table' | 'view' | 'procedure' | 'function'
  conn: SqlConnection
  database?: string
  table?: string
}

interface ExplorerSearchResult {
  kind: 'connection' | 'database' | 'table' | 'view' | 'procedure' | 'function'
  name: string
  conn: SqlConnection
  database?: string
}

export function DatabaseExplorer({
  connections, activeConnection, activeDatabases,
  onSelect, onReconnect, onDisconnect, onEdit, onRemove,
  onRunQuery, onLoadQuery, onAskConfirmSelectAll, onSetActiveDatabase, onOpenDiagram, onAskRowLimit, onServerInfo, trackOperation
}: DatabaseExplorerProps) {
  const { cache, setEntry, invalidate, invalidateConnection } = useSqlExplorerStore()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [search, setSearch] = useState('')
  const columnRequests = useRef(new Map<string, Promise<SqlColumnInfo[]>>())
  const COMPACT_KEY = 'damnedide_sql_compact_tree'
  const [compact, setCompact] = useState(() => {
    try { return localStorage.getItem(COMPACT_KEY) === '1' } catch { return false }
  })
  const toggleCompact = () => {
    setCompact(v => {
      const nv = !v
      try { localStorage.setItem(COMPACT_KEY, nv ? '1' : '0') } catch { /* ignore */ }
      return nv
    })
  }

  const entry = (key: string) => cache[key] || { loaded: false, loading: false, data: null }
  const toggle = (key: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const isOpen = (key: string) => expanded.has(key)

  const load = async (connId: string, key: string, fn: () => Promise<string[] | SqlColumnInfo[]>) => {
    setEntry(key, { loading: true, error: undefined })
    try {
      const data = await trackOperation(`Loading ${key.split(':')[1] || 'database objects'}`, fn)
      setEntry(key, { loading: false, loaded: true, data })
    } catch (e) {
      setEntry(key, { loading: false, loaded: true, error: (e as Error).message, data: null })
    }
  }

  const ensureDatabases = (conn: SqlConnection) => {
    const key = `${conn.id}:databases`
    const e = entry(key)
    if (!e.loaded && !e.loading) {
      load(conn.id, key, () => window.electronAPI.sql.databases(conn.id))
    }
  }

  const ensureTables = (conn: SqlConnection, db: string) => {
    const key = `${conn.id}:tables:${db}`
    const e = entry(key)
    if (!e.loaded && !e.loading) {
      load(conn.id, key, () => window.electronAPI.sql.tables(conn.id, db))
    }
  }

  const ensureViews = (conn: SqlConnection, db: string) => {
    const key = `${conn.id}:views:${db}`
    const e = entry(key)
    if (!e.loaded && !e.loading) {
      load(conn.id, key, () => window.electronAPI.sql.views(conn.id, db))
    }
  }

  const ensureProgrammability = (conn: SqlConnection, db: string) => {
    const key = `${conn.id}:procedures:${db}`
    const e = entry(key)
    if (!e.loaded && !e.loading) {
      load(conn.id, key, () => window.electronAPI.sql.procedures(conn.id, db))
    }
  }

  const ensureFunctions = (conn: SqlConnection, db: string) => {
    const key = `${conn.id}:functions:${db}`
    const e = entry(key)
    if (!e.loaded && !e.loading) {
      load(conn.id, key, () => window.electronAPI.sql.functions(conn.id, db))
    }
  }

  const ensureColumns = (conn: SqlConnection, db: string, table: string) => {
    const key = `${conn.id}:columns:${db}:${table}`
    const e = entry(key)
    if (!e.loaded && !e.loading) {
      load(conn.id, key, () => window.electronAPI.sql.columns(conn.id, db, table))
    }
  }

  const resolveColumns = async (conn: SqlConnection, database: string, table: string): Promise<SqlColumnInfo[]> => {
    const key = `${conn.id}:columns:${database}:${table}`
    const cached = cache[key]
    if (cached?.loaded && Array.isArray(cached.data)) return cached.data as SqlColumnInfo[]
    const existing = columnRequests.current.get(key)
    if (existing) return existing
    setEntry(key, { loading: true, error: undefined })
    const request = trackOperation(`Loading columns for ${table}`, () => window.electronAPI.sql.columns(conn.id, database, table))
    columnRequests.current.set(key, request)
    try {
      const columns = await request
      setEntry(key, { loading: false, loaded: true, data: columns })
      return columns
    } catch (error) {
      setEntry(key, { loading: false, loaded: true, error: (error as Error).message, data: null })
      throw error
    } finally {
      columnRequests.current.delete(key)
    }
  }

  const warmSearchIndex = () => {
    const conn = connections.find(item => item.id === activeConnection && item.isConnected)
    if (!conn) return
    const database = activeDatabases[conn.id]
    if (!database) return
    ensureTables(conn, database)
    ensureViews(conn, database)
    ensureProgrammability(conn, database)
    ensureFunctions(conn, database)
  }

  const searchResults = useMemo<ExplorerSearchResult[]>(() => {
    const term = search.trim().toLocaleLowerCase()
    if (!term) return []
    const results: ExplorerSearchResult[] = []
    const add = (result: ExplorerSearchResult) => {
      const context = result.database ? `${result.database}.${result.name}` : result.name
      if (context.toLocaleLowerCase().includes(term)) results.push(result)
    }
    for (const conn of connections) {
      add({ kind: 'connection', name: conn.label, conn })
      const databases = (cache[`${conn.id}:databases`]?.data as string[] | undefined) || []
      for (const database of databases) {
        add({ kind: 'database', name: database, conn, database })
        const groups: Array<{ kind: ExplorerSearchResult['kind']; key: string }> = [
          { kind: 'table', key: `${conn.id}:tables:${database}` },
          { kind: 'view', key: `${conn.id}:views:${database}` },
          { kind: 'procedure', key: `${conn.id}:procedures:${database}` },
          { kind: 'function', key: `${conn.id}:functions:${database}` }
        ]
        for (const group of groups) {
          for (const name of (cache[group.key]?.data as string[] | undefined) || []) {
            add({ kind: group.kind, name, conn, database })
          }
        }
      }
    }
    return results.slice(0, 200)
  }, [cache, connections, search])
  const searchIndexLoading = Object.entries(cache).some(([key, value]) =>
    value.loading && /:(tables|views|procedures|functions):/.test(key))

  const revealSearchResult = (result: ExplorerSearchResult) => {
    onSelect(result.conn.id)
    if (!result.conn.isConnected) onReconnect(result.conn.id)
    if (result.database) onSetActiveDatabase(result.conn.id, result.database)
    setExpanded(previous => {
      const next = new Set(previous)
      next.add(result.conn.id)
      if (result.database) {
        const databaseKey = `${result.conn.id}:db:${result.database}`
        next.add(databaseKey)
        if (result.kind === 'table') next.add(`${databaseKey}:tables`)
        if (result.kind === 'view') next.add(`${databaseKey}:views`)
        if (result.kind === 'procedure' || result.kind === 'function') next.add(`${databaseKey}:prog`)
      }
      return next
    })
    if (result.kind === 'table' && result.database) ensureColumns(result.conn, result.database, result.name)
    setSearch('')
  }

  // ─── Refresh ─────────────────────────────────────────────────────────────
  const refreshDatabases = async (conn: SqlConnection) => {
    localSqlAssistant.invalidate(conn.id)
    invalidateConnection(conn.id)
    setExpanded(prev => {
      const next = new Set<string>()
      for (const k of prev) if (!k.startsWith(`${conn.id}:`)) next.add(k)
      return next
    })
  }

  const refreshDatabase = (conn: SqlConnection, db: string) => {
    localSqlAssistant.invalidate(conn.id, db)
    for (const k of Object.keys(cache)) {
      if (k.startsWith(`${conn.id}:`) && (k.includes(`:${db}:`))) invalidate(k)
    }
    invalidate(`${conn.id}:tables:${db}`)
    invalidate(`${conn.id}:views:${db}`)
    invalidate(`${conn.id}:procedures:${db}`)
    invalidate(`${conn.id}:functions:${db}`)
    if (isOpen(`${conn.id}:db:${db}:tables`)) ensureTables(conn, db)
    if (isOpen(`${conn.id}:db:${db}:views`)) ensureViews(conn, db)
    if (isOpen(`${conn.id}:db:${db}:prog`)) { ensureProgrammability(conn, db); ensureFunctions(conn, db) }
  }

  const refreshAll = () => {
    for (const conn of connections) {
      if (conn.isConnected) {
        localSqlAssistant.invalidate(conn.id)
        invalidateConnection(conn.id)
        const keys = [...expanded].filter(k => k.startsWith(`${conn.id}:`))
        setExpanded(prev => {
          const next = new Set(prev)
          for (const k of keys) next.delete(k)
          return next
        })
      }
    }
  }

  // ─── Script generation ───────────────────────────────────────────────────
  const quote = (name: string) => {
    const parts = name.split('.')
    return parts.map(p => `[${p.replace(/]/g, ']]')}]`).join('.')
  }

  const scriptTable = (table: string, mode: 'create' | 'select' | 'insert' | 'update' | 'delete') => {
    if (!menu) return ''
    const database = menu.database ?? ''
    const key = columnKey(menu.conn.id, database, table)
    const cols = (cache[key]?.data as SqlColumnInfo[]) || []
    switch (mode) {
      case 'select': return buildExplicitSelect(table, cols, 1000)
      case 'create': {
        if (cols.length === 0) return '-- column metadata unavailable: expand the table and retry'
        const pk = cols.filter(c => c.isPrimaryKey).map(c => `[${c.name}]`)
        const defs = cols.map(c => {
          let s = `  [${c.name}] ${c.type} ${c.nullable ? 'NULL' : 'NOT NULL'}`
          if (c.defaultValue) s += ` DEFAULT ${c.defaultValue}`
          return s
        })
        if (pk.length > 0) defs.push(`  CONSTRAINT [PK_${table.split('.').pop()}] PRIMARY KEY (${pk.join(', ')})`)
        return `CREATE TABLE ${quote(table)} (\n${defs.join(',\n')}\n)`
      }
      case 'insert': {
        if (cols.length === 0) return `-- load columns first (expand the table)\nINSERT INTO ${quote(table)} VALUES (...)`
        const names = cols.map(c => `[${c.name}]`).join(', ')
        const vals = cols.map(c => `<${c.name}>`).join(', ')
        return `INSERT INTO ${quote(table)} (${names})\nVALUES (${vals})`
      }
      case 'update': {
        const pkCol = cols.find(c => c.isPrimaryKey)
        const target = pkCol ? `\nWHERE [${pkCol.name}] = <value>` : ''
        return `UPDATE ${quote(table)}\nSET [<column>] = <value>${target}`
      }
      case 'delete': {
        const pkCol = cols.find(c => c.isPrimaryKey)
        const target = pkCol ? `\nWHERE [${pkCol.name}] = <value>` : ''
        return `DELETE FROM ${quote(table)}${target}`
      }
    }
  }

  const columnKey = (connId: string, db: string, table: string) => `${connId}:columns:${db}:${table}`

  const handleRowClick = (e: React.MouseEvent, conn: SqlConnection) => {
    if (conn.id === activeConnection) { onDisconnect(conn.id); onSelect(null) }
    else { onReconnect(conn.id); onSelect(conn.id) }
  }

  const menuItem = (label: string, icon: React.ReactNode, action: () => void | Promise<void>, danger?: boolean, disabled?: boolean) => (
    <div onClick={() => {
      if (disabled) return
      void Promise.resolve(action()).catch(() => {})
      setMenu(null)
    }}
      style={{
        display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px',
        fontSize: '11px', fontFamily: 'var(--font-mono)', cursor: disabled ? 'not-allowed' : 'pointer',
        color: danger ? 'var(--error-color)' : (disabled ? 'var(--text-muted)' : 'var(--text-primary)'),
        opacity: disabled ? 0.5 : 1
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = danger ? 'var(--error-bg)' : 'var(--bg-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
      {icon}
      {label}
    </div>
  )

  const menuSection = (label: string) => (
    <div style={{
      padding: '5px 12px 3px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: '0.5px', color: 'var(--text-muted)'
    }}>
      {label}
    </div>
  )

  const renderMenu = () => {
    if (!menu) return null
    const { kind, conn } = menu
    const database = menu.database ?? ''
    const table = menu.table ?? ''
    const context = { connectionId: conn.id, database }
    return (
      <>
        <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setMenu(null)} />
        <div style={{
          position: 'fixed', left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 320),
          zIndex: 200, background: 'var(--bg-card)', border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)', padding: '4px 0', minWidth: '210px',
          boxShadow: 'var(--shadow-lg)', animation: 'menuIn 140ms ease', maxHeight: '480px', overflow: 'auto'
        }}>
          <div style={{
            padding: '6px 12px 4px', fontSize: '9.5px', color: 'var(--text-muted)',
            borderBottom: '1px solid var(--border-subtle)', marginBottom: '4px',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>
            {kind === 'connection' && `${connectionLabel(conn.server, conn.database)} — ${AUTH_TYPES.find(a => a.value === (conn.authType || 'sql'))?.label || 'SQL Server Authentication'}`}
            {kind === 'database' && `${connectionLabel(conn.server)} · ${database}`}
            {kind === 'table' && `table ${table}`}
            {kind === 'view' && `view ${table}`}
            {kind === 'procedure' && `procedure ${table}`}
            {kind === 'function' && `function ${table}`}
          </div>

          {kind === 'connection' && (
            <>
              {menuItem(conn.isConnected ? 'disconnect' : 'connect', <PlugZap size={12} />, () => conn.isConnected ? onDisconnect(conn.id) : onReconnect(conn.id))}
              {menuItem('edit connection', <Pencil size={12} />, () => onEdit(conn))}
              {conn.isConnected && menuItem('server info', <Info size={12} />, () => onServerInfo(conn))}
              {menuItem('refresh all databases', <RefreshCw size={12} />, () => refreshDatabases(conn))}
              {menuItem('remove', <Trash2 size={12} />, () => onRemove(conn.id), true)}
            </>
          )}

          {kind === 'database' && database && (
            <>
              {menuItem('new query', <FileCode2 size={12} />, () => { onSetActiveDatabase(conn.id, database); onLoadQuery('', context) })}
              {menuItem('use as query database', <MousePointerClick size={12} />, () => onSetActiveDatabase(conn.id, database))}
              {menuItem('refresh', <RefreshCw size={12} />, () => refreshDatabase(conn, database))}
              {menuSection('diagram')}
              {menuItem('open diagram (all tables)', <Workflow size={12} />, () => onOpenDiagram(conn.id, database))}
            </>
          )}

          {kind === 'table' && table && (
            <>
              {menuItem('new query', <FileCode2 size={12} />, async () => {
                const columns = await resolveColumns(conn, database, table)
                onLoadQuery(buildExplicitSelect(table, columns, 1000), context)
              })}
              {menuItem('select top 1000 rows', <Play size={12} />, async () => {
                const columns = await resolveColumns(conn, database, table)
                onRunQuery(buildExplicitSelect(table, columns, 1000), context)
              })}
              {menuItem('select top N rows…', <Play size={12} />, async () => {
                const columns = await resolveColumns(conn, database, table)
                onAskRowLimit(table, context, columns.map(column => column.name))
              })}
              {menuItem('select all rows', <Play size={12} />, async () => {
                const columns = await resolveColumns(conn, database, table)
                onAskConfirmSelectAll(table, context, columns.map(column => column.name))
              })}
              {menuSection('script table as')}
              {menuItem('create', <FileCode2 size={12} />, () => onLoadQuery(scriptTable(table, 'create'), context))}
              {menuItem('select', <FileCode2 size={12} />, async () => {
                const columns = await resolveColumns(conn, database, table)
                onRunQuery(buildExplicitSelect(table, columns, 1000), context)
              })}
              {menuItem('insert', <FileCode2 size={12} />, () => onLoadQuery(scriptTable(table, 'insert'), context))}
              {menuItem('update', <FileCode2 size={12} />, () => onLoadQuery(scriptTable(table, 'update'), context))}
              {menuItem('delete', <FileCode2 size={12} />, () => onLoadQuery(scriptTable(table, 'delete'), context))}
              {menuSection('diagram')}
              {menuItem('open diagram (related tables)', <Workflow size={12} />, () => onOpenDiagram(conn.id, database, [table]))}
              {menuItem('refresh columns', <RefreshCw size={12} />, () => { invalidate(columnKey(conn.id, database, table)); ensureColumns(conn, database, table) })}
            </>
          )}

          {kind === 'view' && table && (
            <>
              {menuItem('select top 1000 rows', <Play size={12} />, async () => {
                const columns = await resolveColumns(conn, database, table)
                onRunQuery(buildExplicitSelect(table, columns, 1000), context)
              })}
              {menuItem('select all rows', <Play size={12} />, async () => {
                const columns = await resolveColumns(conn, database, table)
                onAskConfirmSelectAll(table, context, columns.map(column => column.name))
              })}
              {menuSection('script view as')}
              {menuItem('create', <FileCode2 size={12} />, () => {
                window.electronAPI.sql.objectDefinition(conn.id, database, table)
                  .then(def => onLoadQuery(def, context))
                  .catch(() => {})
              })}
              {menuItem('alter', <FileCode2 size={12} />, () => {
                window.electronAPI.sql.objectDefinition(conn.id, database, table)
                  .then(def => onLoadQuery(def.replace(/^CREATE\s+(?:OR\s+ALTER\s+)?VIEW/i, 'ALTER VIEW'), context))
                  .catch(() => {})
              })}
            </>
          )}

          {(kind === 'procedure' || kind === 'function') && table && (
            <>
              {menuItem('script as execute', <Play size={12} />, () => onLoadQuery(`EXEC ${quote(table)}`, context))}
            </>
          )}
        </div>
      </>
    )
  }

  // ─── Row rendering ───────────────────────────────────────────────────────
  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '5px', width: '100%', padding: '4px 8px 4px 0',
    cursor: 'pointer', fontSize: '11px', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
    borderLeft: '2px solid transparent', background: 'transparent',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    // dense lists: skip offscreen rows' layout/paint work
    contentVisibility: 'auto',
    containIntrinsicSize: 'auto 26px'
  }

  const chevron = (open: boolean, loading?: boolean) => loading
    ? <Loader2 size={11} style={{ color: 'var(--text-muted)', animation: 'spin 0.9s linear infinite', flexShrink: 0 }} />
    : <ChevronRight size={11} style={{
        color: 'var(--text-muted)', flexShrink: 0,
        transition: 'transform 140ms ease', transform: open ? 'rotate(90deg)' : 'none'
      }}/>

  const icon = (node: React.ReactNode, color?: string) => (
    <span style={{ display: 'inline-flex', flexShrink: 0, color: color || 'var(--text-secondary)' }}>{node}</span>
  )

  const indent = (level: number): React.CSSProperties => ({ paddingLeft: `${level * 14 + 8}px`, boxSizing: 'border-box' })

  const children = (level: number, key: string, node: React.ReactNode) => (
    <div key={key} style={indent(level)}>{node}</div>
  )

  return (
    <aside className="sql-object-explorer sql-surface" aria-label="Object explorer" style={{
      background: 'var(--bg-card)', border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-md)', overflow: 'hidden', height: '100%',
      display: 'flex', flexDirection: 'column'
    }}>
      <header className="sql-object-explorer__header" style={{
        padding: '7px 12px', fontSize: '10px', fontWeight: 700,
        color: 'var(--text-secondary)', textTransform: 'uppercase',
        letterSpacing: '0.5px', fontFamily: 'var(--font-mono)',
        borderBottom: '1px solid var(--border-subtle)', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between'
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Database size={13} /> Object explorer
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onClick={toggleCompact}
            title={compact ? 'show all database objects' : 'show only tables, diagram and programmability'}
            aria-label="toggle essentials mode"
            data-testid="sql-essentials-toggle"
            aria-pressed={compact}
            className="sql-object-explorer__mode"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '22px', height: '22px', background: compact ? 'var(--accent-bg)' : 'transparent',
              border: 'none', borderRadius: 'var(--radius-sm)',
              color: compact ? 'var(--accent-color)' : 'var(--text-secondary)', cursor: 'pointer'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
            onMouseLeave={(e) => { if (!compact) e.currentTarget.style.color = 'var(--text-secondary)' }}
          >
            <ListFilter size={11} />
            <span>{compact ? 'essentials' : 'all'}</span>
          </button>
          <button className="sql-icon-button sql-icon-button--small" onClick={refreshAll} title="refresh all connected databases"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '22px', height: '22px', background: 'transparent', border: 'none',
              color: 'var(--text-secondary)', cursor: 'pointer', borderRadius: 'var(--radius-sm)'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}>
            <RefreshCw size={11} />
          </button>
        </div>
      </header>
      <label className="sql-object-explorer__search" style={{
        position: 'relative', display: 'flex', alignItems: 'center', padding: '7px 8px',
        borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)', flexShrink: 0
      }}>
        <Search size={11} style={{ position: 'absolute', left: '16px', color: 'var(--text-muted)', pointerEvents: 'none' }} />
        <input
          aria-label="search object explorer"
          value={search}
          onFocus={warmSearchIndex}
          onChange={(event) => {
            if (!search && event.target.value) warmSearchIndex()
            setSearch(event.target.value)
          }}
          placeholder="Search tables, views, routines…"
          spellCheck={false}
          style={{
            width: '100%', height: '28px', boxSizing: 'border-box', padding: '0 28px 0 27px',
            border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-card)', color: 'var(--text-primary)', outline: 'none',
            fontSize: '10px', fontFamily: 'var(--font-mono)'
          }}
        />
        {search && (
          <button aria-label="clear object explorer search" onClick={() => setSearch('')} style={{
            position: 'absolute', right: '13px', display: 'grid', placeItems: 'center', width: '20px', height: '20px',
            padding: 0, border: 0, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer'
          }}><X size={11} /></button>
        )}
      </label>

      {search.trim() && (
        <div style={{ flex: 1, overflow: 'auto', padding: '5px 0' }} onClick={() => setMenu(null)}>
          {searchResults.map((result, index) => {
            const resultIcon = result.kind === 'connection' ? <Server size={11} />
              : result.kind === 'database' ? <Database size={11} />
                : result.kind === 'table' ? <Table2 size={11} />
                  : result.kind === 'view' ? <Eye size={11} /> : <Braces size={11} />
            return (
              <div key={`${result.kind}:${result.conn.id}:${result.database || ''}:${result.name}:${index}`}
                role="button"
                aria-label={`search result ${result.kind} ${result.name}`}
                onClick={() => revealSearchResult(result)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setMenu({ x: event.clientX, y: event.clientY, kind: result.kind, conn: result.conn, database: result.database, table: result.name })
                }}
                style={{
                  display: 'grid', gridTemplateColumns: '16px minmax(0, 1fr)', gap: '7px', alignItems: 'center',
                  padding: '7px 10px', cursor: 'pointer', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)'
                }}
                onMouseEnter={(event) => { event.currentTarget.style.background = 'var(--bg-hover)' }}
                onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent' }}>
                <span style={{ display: 'inline-flex', color: result.kind === 'table' ? 'var(--accent-color)' : 'var(--text-muted)' }}>{resultIcon}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '10.5px', color: 'var(--text-primary)' }}>{result.name}</span>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '8.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {result.kind} · {result.database || result.conn.label}
                  </span>
                </span>
              </div>
            )
          })}
          {searchResults.length === 0 && searchIndexLoading && (
            <div style={{ padding: '24px 14px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
              <Loader2 size={13} style={{ display: 'block', margin: '0 auto 7px', animation: 'spin 0.9s linear infinite' }} />
              indexing database objects…
            </div>
          )}
          {searchResults.length === 0 && !searchIndexLoading && (
            <div style={{ padding: '24px 14px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
              no objects match “{search.trim()}”
            </div>
          )}
        </div>
      )}

      <div className="sql-object-explorer__tree" style={{ flex: 1, overflow: 'auto', display: search.trim() ? 'none' : 'block' }} onClick={() => setMenu(null)}>
        {connections.length === 0 && (
          <div style={{
            padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px',
            fontFamily: 'var(--font-mono)'
          }}>
            <Plug size={18} strokeWidth={1} style={{ display: 'block', margin: '0 auto 8px' }} />
            no connections
          </div>
        )}

        {connections.map(conn => {
          const connKey = `${conn.id}`
          const open = isOpen(connKey)
          const dbs = entry(`${conn.id}:databases`)
          return (
            <div key={conn.id}>
              <div
                role="button"
                aria-label={`connection ${conn.label}`}
                onClick={(e) => {
                  if (conn.id === activeConnection) return
                  handleRowClick(e, conn)
                }}
                onContextMenu={(e) => {
                  e.preventDefault(); e.stopPropagation()
                  setMenu({ x: e.clientX, y: e.clientY, kind: 'connection', conn })
                }}
                style={{
                  ...rowStyle,
                  paddingLeft: '8px',
                  background: conn.id === activeConnection ? 'var(--bg-active)' : 'transparent',
                  borderLeftColor: conn.id === activeConnection ? 'var(--accent-color)' : 'transparent',
                  fontWeight: 500
                }}
              >
                <span
                  role="button"
                  aria-label={`expand connection ${conn.label}`}
                  onClick={(e) => { e.stopPropagation(); if (conn.isConnected) { toggle(connKey); if (open) {} else ensureDatabases(conn) } }}
                  style={{ display: 'inline-flex', alignItems: 'center' }}
                >
                  {conn.isConnected ? chevron(open, dbs.loading) : <span style={{ width: '11px', flexShrink: 0 }} />}
                </span>
                {icon(<Server size={12} />, conn.isConnected ? 'var(--success-color)' : 'var(--text-muted)')}
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {conn.label}
                </span>
                <span
                  className={`sql-status-light sql-status-light--explorer ${conn.isConnected ? 'is-online' : 'is-offline'}`}
                  role="img"
                  aria-label={`${conn.label} ${conn.isConnected ? 'online' : 'offline'}`}
                  title={conn.isConnected ? 'Connected' : 'Disconnected'}
                />
              </div>

              {open && conn.isConnected && (
                <>
                  {dbs.loading && (
                    <div style={{ ...indent(1), padding: '4px 8px', fontSize: '10px', color: 'var(--text-muted)' }}>
                      loading databases…
                    </div>
                  )}
                  {dbs.error && (
                    <div style={{ ...indent(1), padding: '4px 8px', fontSize: '10px', color: 'var(--error-color)' }}>
                      {dbs.error}
                    </div>
                  )}
                  {dbs.data && (dbs.data as string[]).map(db => {
                    const dbKey = `${conn.id}:db:${db}`
                    const dbOpen = isOpen(dbKey)
                    const tables = entry(`${conn.id}:tables:${db}`)
                    const views = entry(`${conn.id}:views:${db}`)
                    const procs = entry(`${conn.id}:procedures:${db}`)
                    const funcs = entry(`${conn.id}:functions:${db}`)
                    const isActiveDb = activeDatabases[conn.id] === db
                    return (
                      <div key={db}>
                        <div
                          className={`sql-database-row ${isActiveDb ? 'is-active' : ''}`}
                          role="button"
                          aria-label={`database ${db}`}
                          onClick={() => {
                            onSetActiveDatabase(conn.id, db)
                            toggle(dbKey)
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault(); e.stopPropagation()
                            setMenu({ x: e.clientX, y: e.clientY, kind: 'database', conn, database: db })
                          }}
                          style={{
                            ...rowStyle, ...indent(1),
                            background: isActiveDb ? 'var(--bg-active)' : 'transparent',
                            borderLeftColor: isActiveDb ? 'var(--accent-color)' : 'transparent'
                          }}
                        >
                          {chevron(dbOpen)}
                          {icon(<Database size={11} />, isActiveDb ? 'var(--accent-color)' : 'var(--text-secondary)')}
                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{db}</span>
                          {isActiveDb && <span className="sql-active-db-label">active</span>}
                        </div>

                        {dbOpen && (
                          <>
                            <div
                              onClick={() => onOpenDiagram(conn.id, db)}
                              role="button"
                              aria-label={`diagram ${db}`}
                              onContextMenu={(e) => {
                                e.preventDefault(); e.stopPropagation()
                                setMenu({ x: e.clientX, y: e.clientY, kind: 'database', conn, database: db })
                              }}
                              title="open the database diagram"
                              style={{ ...rowStyle, ...indent(2), color: 'var(--text-secondary)' }}
                            >
                              {icon(<Workflow size={11} />, 'var(--accent-color)')}
                              diagram
                            </div>

                            <div
                              role="button"
                              aria-label={`tables ${db}`}
                              onClick={() => { toggle(`${dbKey}:tables`); if (!tables.loaded) ensureTables(conn, db) }}
                              onContextMenu={(e) => {
                                e.preventDefault(); e.stopPropagation()
                                setMenu({ x: e.clientX, y: e.clientY, kind: 'database', conn, database: db })
                              }}
                              style={{ ...rowStyle, ...indent(2), color: 'var(--text-secondary)' }}
                            >
                              {chevron(isOpen(`${dbKey}:tables`), tables.loading)}
                              {icon(<Table2 size={11} />)}
                              tables
                            </div>
                            {isOpen(`${dbKey}:tables`) && tables.data && (tables.data as string[]).map(t => {
                              const colKey = columnKey(conn.id, db, t)
                              const cols = entry(colKey)
                              const colOpen = isOpen(colKey)
                              return (
                                <div key={t}>
                                  <div
                                    role="button"
                                    aria-label={`table ${t}`}
                                    onClick={() => { toggle(colKey); if (!cols.loaded && !cols.loading) ensureColumns(conn, db, t) }}
                                    onContextMenu={(e) => {
                                      e.preventDefault(); e.stopPropagation()
                                      setMenu({ x: e.clientX, y: e.clientY, kind: 'table', conn, database: db, table: t })
                                    }}
                                    style={{ ...rowStyle, ...indent(3) }}
                                  >
                                    {chevron(colOpen, cols.loading)}
                                    {icon(<Table2 size={11} />, 'var(--accent-secondary)')}
                                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t}</span>
                                  </div>
                                  {colOpen && cols.data && (cols.data as SqlColumnInfo[]).map(c => (
                                    <div key={c.name} style={{ ...rowStyle, ...indent(4), cursor: 'default' }}>
                                      {icon(c.isPrimaryKey
                                        ? <KeyRound size={10} style={{ color: '#e3b341' }} />
                                        : c.isForeignKey
                                          ? <Link2 size={10} style={{ color: '#c678dd' }} />
                                          : <span style={{ width: '10px', display: 'inline-block' }} />)}
                                      <span style={{ color: 'var(--text-primary)' }}>{c.name}</span>
                                      <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{c.type}</span>
                                      {c.nullable && <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>null</span>}
                                    </div>
                                  ))}
                                </div>
                              )
                            })}
                            {isOpen(`${dbKey}:tables`) && tables.loading && (
                              <div style={{ ...indent(3), padding: '4px 8px', fontSize: '10px', color: 'var(--text-muted)' }}>loading…</div>
                            )}

                            {!compact && (
                              <>
                                <div
                                  onClick={() => { toggle(`${dbKey}:views`); if (!views.loaded) ensureViews(conn, db) }}
                                  onContextMenu={(e) => {
                                    e.preventDefault(); e.stopPropagation()
                                    setMenu({ x: e.clientX, y: e.clientY, kind: 'database', conn, database: db })
                                  }}
                                  style={{ ...rowStyle, ...indent(2), color: 'var(--text-secondary)' }}
                                >
                                  {chevron(isOpen(`${dbKey}:views`), views.loading)}
                                  {icon(<Eye size={11} />)}
                                  views
                                </div>
                                {isOpen(`${dbKey}:views`) && views.data && (views.data as string[]).map(v => (
                                  <div key={v}
                                    onContextMenu={(e) => {
                                      e.preventDefault(); e.stopPropagation()
                                      setMenu({ x: e.clientX, y: e.clientY, kind: 'view', conn, database: db, table: v })
                                    }}
                                    style={{ ...rowStyle, ...indent(3) }}>
                                    {icon(<Eye size={11} />, 'var(--accent-secondary)')}
                                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</span>
                                  </div>
                                ))}
                              </>
                            )}

                            <div
                              onClick={() => {
                                toggle(`${dbKey}:prog`)
                                if (!procs.loaded) ensureProgrammability(conn, db)
                                if (!funcs.loaded) ensureFunctions(conn, db)
                              }}
                              onContextMenu={(e) => {
                                e.preventDefault(); e.stopPropagation()
                                setMenu({ x: e.clientX, y: e.clientY, kind: 'database', conn, database: db })
                              }}
                              style={{ ...rowStyle, ...indent(2), color: 'var(--text-secondary)' }}
                            >
                              {chevron(isOpen(`${dbKey}:prog`), procs.loading || funcs.loading)}
                              {icon(<Settings2 size={11} />)}
                              programmability
                            </div>
                            {isOpen(`${dbKey}:prog`) && (
                              <>
                                {procs.data && (procs.data as string[]).map(p => (
                                  <div key={p}
                                    onContextMenu={(e) => {
                                      e.preventDefault(); e.stopPropagation()
                                      setMenu({ x: e.clientX, y: e.clientY, kind: 'procedure', conn, database: db, table: p })
                                    }}
                                    style={{ ...rowStyle, ...indent(3) }}>
                                    {icon(<Braces size={11} />, 'var(--text-secondary)')}
                                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p}</span>
                                  </div>
                                ))}
                                {funcs.data && (funcs.data as string[]).map(f => (
                                  <div key={f}
                                    onContextMenu={(e) => {
                                      e.preventDefault(); e.stopPropagation()
                                      setMenu({ x: e.clientX, y: e.clientY, kind: 'function', conn, database: db, table: f })
                                    }}
                                    style={{ ...rowStyle, ...indent(3) }}>
                                    {icon(<Braces size={11} />, 'var(--text-secondary)')}
                                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f}</span>
                                  </div>
                                ))}
                                {procs.loading && (
                                  <div style={{ ...indent(3), padding: '4px 8px', fontSize: '10px', color: 'var(--text-muted)' }}>loading…</div>
                                )}
                              </>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          )
        })}
      </div>
      {renderMenu()}
    </aside>
  )
}
