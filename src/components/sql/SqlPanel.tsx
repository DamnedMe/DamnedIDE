import { useCallback, useRef, useState } from 'react'
import { PanelContainer } from '../layout/PanelContainer'
import { ResizableSplitter } from '../layout/ResizableSplitter'
import { QueryEditor, QueryEditorHandle, QueryExecutionContext } from './QueryEditor'
import { ResultViewer } from './ResultViewer'
import { DatabaseExplorer } from './DatabaseExplorer'
import { ConnectionDialog } from './ConnectionDialog'
import { RecentConnectionsMenu } from './RecentConnectionsMenu'
import { DiagramView } from './DiagramView'
import { useSqlStore, useSqlRecentStore, useToastStore } from '../../store'
import { Plus, PanelLeftClose, PanelLeftOpen, Loader2, Check, XCircle } from 'lucide-react'
import { SqlConnection, SqlConnectionConfig, SqlExecutionResult, SqlForeignKeyInfo, SqlTestResult } from '../../types/sql'
import { connectionLabel } from './sqlForm'
import { Modal } from '../layout/Modal'
import { appendJoinedSelectColumns, appendRelatedJoin, buildExplicitSelect, extractSqlBaseTable, getSqlResultTableName } from './sqlQueryUtils'

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

type SqlActivity = {
  id: string
  label: string
  status: 'running' | 'success' | 'error'
  startedAt: number
  detail?: string
}

type PendingMutation = {
  query: string
  context?: QueryExecutionContext
  kind: 'update' | 'delete'
  resolve: (ok: boolean) => void
}

function findWhereClause(query: string): { start: number; end: number } | null {
  const wm = /\bWHERE\b/i.exec(query)
  if (!wm) return null
  const start = wm.index + wm[0].length
  const after = query.slice(start)
  const end = /\b(GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET)\b/i.exec(after)
  return { start, end: end ? start + end.index : query.length }
}

interface DiagramTarget {
  connId: string
  database: string
  tables?: string[]
}

// Strips Electron's "Error invoking remote method 'channel': " prefix so toasts
// show the real message (e.g. "Login failed for user 'x'").
function cleanError(e: unknown): string {
  const m = (e as Error)?.message || String(e)
  return m.replace(/^Error invoking remote method '[^']+':\s*/, '')
}

export function SqlPanel() {
  const {
    connections, addConnection, updateConnection, removeConnection,
    activeConnection, setActiveConnection,
    activeDatabases, setActiveDatabase, setRunning
  } = useSqlStore()
  const recent = useSqlRecentStore(s => s.recent)
  const addRecent = useSqlRecentStore(s => s.addRecent)
  const showToast = useToastStore(s => s.showToast)
  const queryEditorRef = useRef<QueryEditorHandle | null>(null)
  const [showConnect, setShowConnect] = useState(false)
  const [edit, setEdit] = useState<Partial<SqlConnection> | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [plusMenu, setPlusMenu] = useState<{ x: number; y: number } | null>(null)
  const [diagram, setDiagram] = useState<DiagramTarget | null>(null)
  const [rowLimitTable, setRowLimitTable] = useState<{ table: string; context?: QueryExecutionContext; columns: string[] } | null>(null)
  const [confirmSelectAll, setConfirmSelectAll] = useState<{ table: string; context?: QueryExecutionContext; columns: string[] } | null>(null)
  const [pendingMutation, setPendingMutation] = useState<PendingMutation | null>(null)
  const [pendingConnectionRemoval, setPendingConnectionRemoval] = useState<SqlConnection | null>(null)
  const [serverInfo, setServerInfo] = useState<{ conn: SqlConnection; info: import('../../types/sql').SqlServerInfo } | null>(null)
  const [activities, setActivities] = useState<SqlActivity[]>([])
  const [activeQueryTabId, setActiveQueryTabId] = useState<string | null>(null)
  const [tabExecutions, setTabExecutions] = useState<Record<string, SqlExecutionResult>>({})
  const execution = activeQueryTabId ? tabExecutions[activeQueryTabId] || null : null

  const trackOperation = useCallback(async <T,>(label: string, operation: () => Promise<T>): Promise<T> => {
    const id = crypto.randomUUID()
    const startedAt = Date.now()
    setActivities(current => [...current, { id, label, status: 'running', startedAt }])
    try {
      const result = await operation()
      setActivities(current => current.map(item => item.id === id
        ? { ...item, status: 'success', detail: `completed in ${Date.now() - startedAt} ms` }
        : item))
      window.setTimeout(() => setActivities(current => current.filter(item => item.id !== id)), 1800)
      return result
    } catch (error) {
      setActivities(current => current.map(item => item.id === id
        ? { ...item, status: 'error', detail: cleanError(error) }
        : item))
      window.setTimeout(() => setActivities(current => current.filter(item => item.id !== id)), 5000)
      throw error
    }
  }, [])

  // ─── Query helpers (join / filter on click) ──────────────────────────────
  const sqlLiteral = (col: string, v: unknown): string => {
    if (v === null || v === undefined) return 'NULL'
    const t = execution?.results?.[0]?.colTypes?.[col]
    if (t === 'date') {
      const d = v instanceof Date ? v : new Date(String(v))
      if (!isNaN(d.getTime())) {
        const p = (n: number) => String(n).padStart(2, '0')
        return `'${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}'`
      }
    }
    if (t === 'number' || t === 'bigint' || t === 'boolean') return String(v)
    return `'${String(v).replace(/'/g, "''")}'`
  }

  const filterByPk = (query: string, col: string, value: unknown): string => {
    const base = extractSqlBaseTable(query)
    if (!base) return query
    if (!/^[A-Za-z_][A-Za-z0-9_$#@]*$/.test(col)) return query
    const q = query
    const qual = base.alias || base.table
    const literal = sqlLiteral(col, value)
    const pred = `${qual}.${col} = ${literal}`
    const wc = findWhereClause(q)
    if (!wc) {
      const clause = /\b(GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET)\b/i.exec(q)
      if (clause) {
        return q.slice(0, clause.index).trimEnd() + `\nWHERE ${pred}\n` + q.slice(clause.index).trimStart()
      }
      let body = q
      let hadSemi = false
      if (body.trimEnd().endsWith(';')) { hadSemi = true; body = body.trimEnd().slice(0, -1) }
      return body.trimEnd() + `\nWHERE ${pred}` + (hadSemi ? ';\n' : '\n')
    }
    const body = q.slice(wc.start, wc.end)
    if (new RegExp(`\\b(?:${escapeRe(qual)}\\.)?${escapeRe(col)}\\s*=`, 'i').test(body)) {
      const updRe = new RegExp(`\\b${escapeRe(qual)}\\.${escapeRe(col)}\\s*=\\s*([^'\\s,;)]+)`, 'i')
      const upd = updRe.exec(body)
      if (upd && upd[1] !== literal) {
        const valStart = wc.start + upd.index + upd[0].length - upd[1].length
        return q.slice(0, valStart) + literal + q.slice(valStart + upd[1].length)
      }
      return q
    }
    return q.slice(0, wc.end).trimEnd() + `\n  AND ${pred}` + q.slice(wc.end)
  }

  const handleJoinRequest = async (fk: SqlForeignKeyInfo) => {
    const q = queryEditorRef.current?.getQuery() || ''
    const result = appendRelatedJoin(q, fk)
    if (result.status !== 'added') {
      const messages = {
        'no-base-table': 'join non aggiunta: la query non contiene una tabella base nel FROM',
        unrelated: 'join non aggiunta: la relazione non coinvolge la tabella base',
        'already-present': 'join non aggiunta: questa relazione è già presente nella query',
        invalid: 'join non aggiunta: metadati della relazione non validi'
      }
      showToast(messages[result.status], 'info')
      return
    }
    let nextQuery = result.query
    const connectionId = activeConnection
    const database = connectionId ? (activeDatabases[connectionId] || connections.find(connection => connection.id === connectionId)?.database || '') : ''
    if (connectionId && database && result.alias && result.targetTable) {
      try {
        const columns = await trackOperation(`Loading columns for ${result.targetTable}`, () =>
          window.electronAPI.sql.columns(connectionId, database, result.targetTable!))
        nextQuery = appendJoinedSelectColumns(nextQuery, result.alias, result.targetTable, columns)
      } catch {
        showToast(`join aggiunta, ma non è stato possibile caricare le colonne di ${result.targetTable}`, 'info')
      }
    }
    queryEditorRef.current?.setQuery(nextQuery, true)
  }

  const handleFilterRequest = (col: string, value: unknown) => {
    const q = queryEditorRef.current?.getQuery() || ''
    const next = filterByPk(q, col, value)
    if (next === q) {
      showToast(`where su ${col} già presente`, 'info')
      return
    }
    queryEditorRef.current?.setQuery(next)
  }

  // ─── Connection lifecycle ────────────────────────────────────────────────
  const configToConnection = (config: SqlConnectionConfig, ok: boolean, id: string): SqlConnection => ({
    id,
    server: config.server,
    database: config.database,
    // rememberPassword=false → the password is used for the live session but never persisted
    user: config.user,
    password: config.rememberPassword === false ? undefined : config.password,
    port: config.port,
    authType: config.authType,
    domain: config.domain,
    tenantId: config.tenantId,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    accessToken: config.accessToken,
    encrypt: config.encrypt,
    trustServerCertificate: config.trustServerCertificate,
    connectTimeout: config.connectTimeout,
    requestTimeout: config.requestTimeout,
    protocol: config.protocol,
    isConnected: ok,
    label: connectionLabel(config.server, config.database),
    lastConnected: ok ? Date.now() : undefined
  })

  const handleConnect = async (config: SqlConnectionConfig): Promise<{ ok: boolean; error?: string }> => {
    if (!config.server) return { ok: false, error: 'server name is required' }
    const connId = edit?.id ?? crypto.randomUUID()
    const label = connectionLabel(config.server, config.database)
    let ok = false
    let error = ''
    try {
      await trackOperation(`Connecting to ${label}`, async () => {
        if (edit?.id) await window.electronAPI.sql.disconnect(edit.id).catch(() => {})
        await window.electronAPI.sql.connect({ ...config, connectionId: connId })
      })
      ok = true
    } catch (e) {
      error = cleanError(e)
    }
    const conn = configToConnection(config, ok, connId)
    if (edit?.id) updateConnection(connId, conn)
    else addConnection(conn)
    if (ok) {
      setActiveConnection(connId)
      setActiveDatabase(connId, config.database || '')
      addRecent({ server: config.server, database: config.database, user: config.user, authType: config.authType, lastConnected: Date.now() })
      showToast(`connesso a ${label}`)
    } else {
      showToast(`connessione fallita: ${error || 'server non raggiungibile'}`, 'error')
    }
    if (ok) setShowConnect(false)
    return ok ? { ok: true } : { ok: false, error }
  }

  const handleTest = async (config: SqlConnectionConfig): Promise<SqlTestResult> =>
    trackOperation(`Testing ${config.server}`, () => window.electronAPI.sql.testConnection(config))

  const handleListDatabases = async (config: SqlConnectionConfig): Promise<string[]> => {
    const tmpId = crypto.randomUUID()
    await trackOperation(`Loading databases from ${config.server}`, () => window.electronAPI.sql.connect({ ...config, database: undefined, connectionId: tmpId }))
    try {
      return await trackOperation('Loading databases', () => window.electronAPI.sql.databases(tmpId))
    } finally {
      await window.electronAPI.sql.disconnect(tmpId).catch(() => {})
    }
  }

  const handleReconnect = async (id: string) => {
    const conn = connections.find(c => c.id === id)
    if (!conn) return
    if (conn.isConnected) { setActiveConnection(id); return }
    try {
      await trackOperation(`Reconnecting to ${conn.label}`, () => window.electronAPI.sql.connect({ ...conn, connectionId: conn.id }))
      updateConnection(conn.id, { isConnected: true, lastConnected: Date.now() })
      setActiveConnection(conn.id)
      setActiveDatabase(conn.id, conn.database || '')
    } catch (e) {
      showToast(`connessione fallita per ${conn.label}: ${cleanError(e)}`, 'error')
    }
  }

  const handleDisconnect = async (id: string) => {
    const conn = connections.find(item => item.id === id)
    await trackOperation(`Disconnecting ${conn?.label || 'server'}`, () => window.electronAPI.sql.disconnect(id)).catch(() => {})
    updateConnection(id, { isConnected: false })
  }

  const handleRemove = async (id: string) => {
    await trackOperation('Removing connection', () => window.electronAPI.sql.disconnect(id)).catch(() => {})
    removeConnection(id)
    if (activeConnection === id) setActiveConnection(null)
  }

  // ─── Query running ───────────────────────────────────────────────────────
  // Shared executor used by editor tabs, context-menu actions and row mutations.
  const executeSql = async (
    query: string,
    context?: QueryExecutionContext,
    skipConfirmation = false,
    queryTabId?: string
  ): Promise<boolean> => {
    const connectionId = context?.connectionId || activeConnection
    const database = context?.database ?? (connectionId ? (activeDatabases[connectionId] || connections.find(c => c.id === connectionId)?.database || '') : '')
    if (!connectionId || !query.trim()) {
      showToast('seleziona una connessione prima di eseguire la query', 'info')
      return false
    }

    const mutationMatch = query.replace(/^\s*(?:--[^\r\n]*[\r\n]+|\/\*[\s\S]*?\*\/\s*)*/, '').match(/^\s*(UPDATE|DELETE)\b/i)
    if (mutationMatch && !skipConfirmation) {
      if (pendingMutation) {
        showToast('completa prima la conferma già aperta', 'info')
        return false
      }
      return new Promise<boolean>(resolve => setPendingMutation({
        query,
        context: { connectionId, database },
        kind: mutationMatch[1].toLowerCase() as 'update' | 'delete',
        resolve
      }))
    }

    if (activeConnection !== connectionId) setActiveConnection(connectionId)
    if (database) setActiveDatabase(connectionId, database)
    const safeDb = database.replace(/]/g, ']]')
    const queryWithDb = database ? `USE [${safeDb}];\n${query}` : query
    const queryId = crypto.randomUUID()
    setRunning(queryId)
    try {
      const verb = query.trimStart().match(/^([A-Za-z]+)/)?.[1]?.toUpperCase() || 'SQL'
      const exec = await trackOperation(`Executing ${verb} on ${database || 'server'}`, () =>
        window.electronAPI.sql.query(connectionId, queryWithDb, queryId, undefined, database))
      const targetTabId = queryTabId ?? activeQueryTabId
      if (targetTabId) setTabExecutions(current => ({ ...current, [targetTabId]: exec }))
      return true
    } catch (e) {
      showToast(`query failed: ${cleanError(e)}`, 'error')
      return false
    } finally {
      setRunning(null)
    }
  }

  // Re-runs the current editor query (used to refresh the grid after an edit).
  const refreshGrid = () => {
    const q = queryEditorRef.current?.getQuery() || ''
    if (q.trim()) void executeSql(q)
  }

  const runQuery = (query: string, context?: QueryExecutionContext) => {
    if (context?.connectionId) setActiveConnection(context.connectionId)
    if (context?.connectionId && context.database) setActiveDatabase(context.connectionId, context.database)
    queryEditorRef.current?.newQuery(query, query.trim().length > 0, context)
    setDiagram(null)
  }

  const loadQuery = (query: string, context?: QueryExecutionContext) => {
    if (context?.connectionId) setActiveConnection(context.connectionId)
    if (context?.connectionId && context.database) setActiveDatabase(context.connectionId, context.database)
    queryEditorRef.current?.newQuery(query, false, context)
    setDiagram(null)
  }

  const openNew = () => { setEdit(null); setShowConnect(true) }
  const openEdit = (conn: SqlConnection) => { setEdit(conn); setShowConnect(true) }
  const openRecent = (r: { server: string; database?: string; user?: string; authType?: import('../../types/sql').SqlAuthType }) => {
    // If a saved connection matches, carry over its credentials (password, port, …)
    // so a quick connect from recents does not fail on a missing password.
    const saved = connections.find(c =>
      c.server === r.server && (c.database || '') === (r.database || '')
    )
    setEdit(saved ?? { server: r.server, database: r.database, user: r.user, authType: r.authType })
    setShowConnect(true)
  }

  const activeConn = connections.find(c => c.id === activeConnection) || null
  const activeDb = activeConnection ? (activeDatabases[activeConnection] || activeConn?.database || '') : ''

  // Base table of the current query, resolved at click time for "export as SQL INSERT".
  const getResultTableName = (): string | undefined => {
    const q = queryEditorRef.current?.getQuery() || ''
    return getSqlResultTableName(q)
  }

  const handleServerInfo = async (conn: SqlConnection) => {
    try {
      const info = await trackOperation(`Loading server info for ${conn.label}`, () => window.electronAPI.sql.serverInfo(conn.id))
      setServerInfo({ conn, info })
    } catch (e) {
      showToast(`server info non disponibile: ${cleanError(e)}`, 'error')
    }
  }

  const closeMutationConfirmation = () => {
    pendingMutation?.resolve(false)
    setPendingMutation(null)
  }

  const confirmMutation = async () => {
    if (!pendingMutation) return
    const pending = pendingMutation
    setPendingMutation(null)
    const ok = await executeSql(pending.query, pending.context, true)
    pending.resolve(ok)
  }

  return (
    <PanelContainer
      title="SQL Server"
      actions={
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? 'show connections' : 'collapse connections'}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '30px', height: '30px', background: 'var(--bg-card)',
              border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
              color: 'var(--text-secondary)', cursor: 'pointer', transition: 'color 140ms ease'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}>
            {sidebarCollapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
          </button>
          <button
            onClick={(e) => setPlusMenu({ x: e.currentTarget.getBoundingClientRect().right + 4, y: e.currentTarget.getBoundingClientRect().bottom + 4 })}
            title="connection: new or recent"
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '5px 14px', height: '30px',
              background: 'var(--accent-color)', color: 'var(--text-inverse)',
              border: 'none', borderRadius: 'var(--radius-md)',
              cursor: 'pointer', fontSize: '11px', fontWeight: 600,
              fontFamily: 'var(--font-mono)', transition: 'transform 140ms ease'
            }}
            onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.97)' }}
            onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
          >
            <Plus size={13} /> Connection
          </button>
        </div>
      }
    >
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
        <div style={{ flex: 1, minHeight: 0 }}>
          <ResizableSplitter direction="horizontal" defaultSize={250} minSize={190} maxSize={390} collapsed={sidebarCollapsed}>
            <DatabaseExplorer
              connections={connections}
              activeConnection={activeConnection}
              activeDatabases={activeDatabases}
              onSelect={setActiveConnection}
              onReconnect={handleReconnect}
              onDisconnect={handleDisconnect}
              onEdit={openEdit}
              onRemove={(id) => setPendingConnectionRemoval(connections.find(c => c.id === id) || null)}
              onRunQuery={runQuery}
              onLoadQuery={loadQuery}
              onAskConfirmSelectAll={(table, context, columns = []) => setConfirmSelectAll({ table, context, columns })}
              onSetActiveDatabase={setActiveDatabase}
              onOpenDiagram={(connId, database, tables) => setDiagram({ connId, database, tables })}
              onAskRowLimit={(table, context, columns = []) => setRowLimitTable({ table, context, columns })}
              onServerInfo={handleServerInfo}
              trackOperation={trackOperation}
            />
          <div style={{
            display: 'flex', flex: 1, width: '100%', height: '100%', minHeight: 0,
            flexDirection: 'column', gap: '0px', overflow: 'hidden', padding: '0 0 0 4px'
          }}>
            <ResizableSplitter direction="vertical" defaultSize={diagram ? 170 : 240} minSize={140} maxSize={650}>
              <QueryEditor
                connectionId={activeConnection}
                activeDatabase={activeDb}
                handleRef={queryEditorRef}
                onExecute={(query, context, tabId) => executeSql(query, context, false, tabId)}
                onActiveTabChange={(tabId, context) => {
                  setActiveQueryTabId(tabId)
                  if (context?.connectionId) setActiveConnection(context.connectionId)
                  if (context?.connectionId && context.database) setActiveDatabase(context.connectionId, context.database)
                }}
                onTabClosed={(tabId) => setTabExecutions(current => {
                  const next = { ...current }
                  delete next[tabId]
                  return next
                })}
              />
              {diagram ? (
                <DiagramView
                  connId={diagram.connId}
                  database={diagram.database}
                  tables={diagram.tables}
                  onClose={() => setDiagram(null)}
                  onRunQuery={(query) => runQuery(query, { connectionId: diagram.connId, database: diagram.database })}
                  trackOperation={trackOperation}
                />
              ) : (
                <ResultViewer
                  execution={execution}
                  getResultTableName={getResultTableName}
                  onJoinRequest={handleJoinRequest}
                  onFilterRequest={handleFilterRequest}
                  onClear={() => {
                    if (!activeQueryTabId) return
                    setTabExecutions(current => {
                      const next = { ...current }
                      delete next[activeQueryTabId]
                      return next
                    })
                  }}
                  onExecuteSql={async (q) => {
                    const ok = await executeSql(q)
                    if (ok) refreshGrid()
                    return ok
                  }}
                  onDeleteRequest={(query) => { void executeSql(query).then(ok => { if (ok) refreshGrid() }) }}
                />
              )}
            </ResizableSplitter>
          </div>
          </ResizableSplitter>
        </div>
        {activities.length > 0 && <SqlActivityStrip activities={activities} />}
      </div>

      {plusMenu && (
        <RecentConnectionsMenu
          connections={connections}
          recent={recent}
          onNew={() => { openNew(); setPlusMenu(null) }}
          onOpenRecent={(r) => { openRecent(r); setPlusMenu(null) }}
          onSelectSaved={(id) => {
            setPlusMenu(null)
            const conn = connections.find(c => c.id === id)
            if (conn) {
              if (conn.id === activeConnection) { handleDisconnect(conn.id); setActiveConnection(null) }
              else handleReconnect(conn.id)
            }
          }}
          onClose={() => setPlusMenu(null)}
          anchor={plusMenu}
        />
      )}

      {showConnect && (
        <ConnectionDialog
          initial={edit}
          recent={recent}
          onClose={() => setShowConnect(false)}
          onTest={handleTest}
          onListDatabases={handleListDatabases}
          onConnect={handleConnect}
        />
      )}

      {rowLimitTable && (
        <RowLimitDialog
          table={rowLimitTable.table}
          onClose={() => setRowLimitTable(null)}
          onConfirm={(n) => {
            runQuery(buildExplicitSelect(rowLimitTable.table, rowLimitTable.columns, n), rowLimitTable.context)
            setRowLimitTable(null)
          }}
        />
      )}

      {confirmSelectAll && (
        <ConfirmSelectAllDialog
          table={confirmSelectAll.table}
          onClose={() => setConfirmSelectAll(null)}
          onConfirm={() => {
            runQuery(buildExplicitSelect(confirmSelectAll.table, confirmSelectAll.columns), confirmSelectAll.context)
            setConfirmSelectAll(null)
          }}
        />
      )}

      {pendingMutation && (
        <Modal onClose={closeMutationConfirmation} width={440} label={`confirm ${pendingMutation.kind}`}>
          <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
              confirm {pendingMutation.kind}?
            </div>
            <pre style={{
              background: 'var(--bg-input)', border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)', padding: '10px', fontSize: '10px',
              fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '160px', overflow: 'auto',
              margin: 0
            }}>{pendingMutation.query}</pre>
            <div style={{ fontSize: '10px', color: 'var(--error-color)', fontFamily: 'var(--font-mono)' }}>
              The statement will modify data. Review the SQL before continuing.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={closeMutationConfirmation} style={{
                padding: '7px 16px', background: 'var(--bg-card)',
                border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
                color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '11px',
                fontFamily: 'var(--font-mono)'
              }}>cancel</button>
              <button onClick={confirmMutation} style={{
                padding: '7px 16px', background: pendingMutation.kind === 'delete' ? 'var(--error-color)' : 'var(--warning-color)', color: 'var(--text-inverse)',
                border: 'none', borderRadius: 'var(--radius-md)',
                cursor: 'pointer', fontSize: '11px', fontFamily: 'var(--font-mono)', fontWeight: 600
              }}>
                run {pendingMutation.kind}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {pendingConnectionRemoval && (
        <Modal onClose={() => setPendingConnectionRemoval(null)} width={400} label="remove connection">
          <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
              remove saved connection?
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              {pendingConnectionRemoval.label}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setPendingConnectionRemoval(null)} style={{ padding: '7px 16px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>cancel</button>
              <button onClick={() => {
                const id = pendingConnectionRemoval.id
                setPendingConnectionRemoval(null)
                void handleRemove(id)
              }} style={{ padding: '7px 16px', background: 'var(--error-color)', color: 'var(--text-inverse)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: '11px', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>remove</button>
            </div>
          </div>
        </Modal>
      )}

      {serverInfo && (
        <Modal onClose={() => setServerInfo(null)} width={460} label="server info">
          <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
              server info — {serverInfo.conn.label}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', gap: '8px', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                <span style={{ color: 'var(--text-muted)', width: '80px', flexShrink: 0 }}>server</span>
                <span style={{ color: 'var(--text-primary)', wordBreak: 'break-all' }}>{serverInfo.info.server}</span>
              </div>
              <div style={{ display: 'flex', gap: '8px', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                <span style={{ color: 'var(--text-muted)', width: '80px', flexShrink: 0 }}>database</span>
                <span style={{ color: 'var(--text-primary)' }}>{serverInfo.info.database}</span>
              </div>
              <div style={{ display: 'flex', gap: '8px', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                <span style={{ color: 'var(--text-muted)', width: '80px', flexShrink: 0 }}>version</span>
                <span style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{serverInfo.info.version}</span>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
              <button onClick={() => setServerInfo(null)} style={{
                padding: '7px 16px', background: 'var(--bg-card)',
                border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
                color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '11px',
                fontFamily: 'var(--font-mono)'
              }}>close</button>
            </div>
          </div>
        </Modal>
      )}
    </PanelContainer>
  )
}

function SqlActivityStrip({ activities }: { activities: SqlActivity[] }) {
  const running = activities.filter(item => item.status === 'running')
  const visible = running.length > 0 ? running : activities.slice(-1)
  return (
    <div role="status" aria-live="polite" style={{
      position: 'absolute', right: '12px', bottom: '12px', zIndex: 30,
      minHeight: '32px', maxWidth: 'min(520px, calc(100% - 24px))', padding: '5px 9px',
      display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden',
      background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
      pointerEvents: 'none', fontFamily: 'var(--font-mono)'
    }}>
      {visible.map(item => (
        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: '10px' }}>
          {item.status === 'running'
            ? <Loader2 size={11} style={{ color: 'var(--accent-color)', animation: 'spin 0.9s linear infinite', flexShrink: 0 }} />
            : item.status === 'success'
              ? <Check size={11} style={{ color: 'var(--success-color)', flexShrink: 0 }} />
              : <XCircle size={11} style={{ color: 'var(--error-color)', flexShrink: 0 }} />}
          <span style={{ color: item.status === 'error' ? 'var(--error-color)' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
            {item.label}{item.detail ? ` · ${item.detail}` : '…'}
          </span>
        </div>
      ))}
    </div>
  )
}

function ConfirmSelectAllDialog({ table, onClose, onConfirm }: {
  table: string
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Modal onClose={onClose} width={360} label="select all rows">
      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
          select all rows?
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
          <span style={{ wordBreak: 'break-all' }}>{table}</span>
          <br />
          large tables can take a long time and the result is truncated at 250k rows.
          consider <span style={{ color: 'var(--accent-color)' }}>select top N rows</span> instead.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button onClick={onClose} style={{
            padding: '7px 16px', background: 'var(--bg-card)',
            border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
            color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '11px',
            fontFamily: 'var(--font-mono)'
          }}>cancel</button>
          <button onClick={onConfirm} style={{
            padding: '7px 16px', background: 'var(--warning-color)', color: 'var(--text-inverse)',
            border: 'none', borderRadius: 'var(--radius-md)',
            cursor: 'pointer', fontSize: '11px', fontFamily: 'var(--font-mono)', fontWeight: 600
          }}>
            select all
          </button>
        </div>
      </div>
    </Modal>
  )
}

function RowLimitDialog({ table, onClose, onConfirm }: {
  table: string
  onClose: () => void
  onConfirm: (n: number) => void
}) {
  const [n, setN] = useState('1000')
  const valid = /^\d+$/.test(n) && parseInt(n, 10) > 0
  return (
    <Modal onClose={onClose} width={320} label="select top n rows">
      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
          select top N rows
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
          {table}
        </div>
        <input
          value={n}
          onChange={(e) => setN(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && valid) onConfirm(parseInt(n, 10)) }}
          autoFocus
          spellCheck={false}
          style={{
            width: '100%', padding: '8px 10px', background: 'var(--bg-input)',
            border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
            color: 'var(--text-primary)', fontSize: '12px', fontFamily: 'var(--font-mono)',
            outline: 'none', boxSizing: 'border-box'
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button onClick={onClose} style={{
            padding: '7px 16px', background: 'var(--bg-card)',
            border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
            color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '11px',
            fontFamily: 'var(--font-mono)'
          }}>cancel</button>
          <button onClick={() => valid && onConfirm(parseInt(n, 10))} disabled={!valid} style={{
            padding: '7px 16px', background: valid ? 'var(--accent-color)' : 'var(--bg-disabled)',
            color: valid ? 'var(--text-inverse)' : 'var(--text-muted)',
            border: 'none', borderRadius: 'var(--radius-md)',
            cursor: valid ? 'pointer' : 'not-allowed', fontSize: '11px',
            fontFamily: 'var(--font-mono)', fontWeight: 600
          }}>
            run
          </button>
        </div>
      </div>
    </Modal>
  )
}
