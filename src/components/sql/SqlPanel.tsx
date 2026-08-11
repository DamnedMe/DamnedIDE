import { useRef, useState } from 'react'
import { PanelContainer } from '../layout/PanelContainer'
import { ResizableSplitter } from '../layout/ResizableSplitter'
import { QueryEditor, QueryEditorHandle } from './QueryEditor'
import { ResultViewer } from './ResultViewer'
import { ConnectionTree } from './ConnectionTree'
import { useSqlStore, useToastStore } from '../../store'
import { Plus, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { SqlConnection, SqlConnectionConfig, SqlForeignKeyInfo } from '../../types/sql'

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isIdent(s: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s)
}

// True when the query contains a JOIN clause (base table must stay unaliased in that case).
function hasJoinClause(query: string): boolean {
  return /\b(?:LEFT|RIGHT|INNER|CROSS|FULL|OUTER)?\s*JOIN\b/i.test(query)
}

function extractBaseTable(query: string): { schema: string; table: string; alias: string; hasAlias: boolean } | null {
  const m = /\bFROM\s+\[?([A-Za-z0-9_]+)\]?(?:\s*\.\s*\[?([A-Za-z0-9_]+)\]?)?(?:\s+(?:AS\s+)?\[?([A-Za-z0-9_]+)\]?)?/i.exec(query)
  if (!m) return null
  const schema = m[2] || 'dbo'
  const table = m[2] || m[1]
  return { schema, table, alias: m[3] || table, hasAlias: !!m[3] }
}

// Qualifier used to reference the base table's columns. When the base table has no
// alias it is aliased only if safe (no other JOINs present); otherwise the bare table
// name is used, since aliasing it would break the existing join conditions.
function resolveBaseQualifier(query: string, base: { schema: string; table: string; alias: string; hasAlias: boolean }): { query: string; qual: string } {
  if (base.hasAlias) return { query, qual: base.alias }
  if (hasJoinClause(query)) return { query, qual: base.table }
  let alias = 't1'
  let i = 2
  while (new RegExp(`\\b${alias}\\b`, 'i').test(query)) alias = `t${i++}`
  const m = /\bFROM\s+\[?([A-Za-z0-9_]+)\]?(?:\s*\.\s*\[?([A-Za-z0-9_]+)\]?)?/i.exec(query)
  if (!m) return { query, qual: base.table }
  const end = m.index + m[0].length
  return { query: query.slice(0, end) + ` ${alias}` + query.slice(end), qual: alias }
}

// Adds `LEFT JOIN <referenced> AS fkN ON fkN.<refCol> = <baseQual>.<fkCol>` to the query.
function appendLeftJoin(query: string, fk: SqlForeignKeyInfo): string {
  const base = extractBaseTable(query)
  if (!base) return query
  if ((fk.table.split('.').pop() || '').toLowerCase() !== base.table.toLowerCase()) return query
  if (!isIdent(fk.column) || !isIdent(fk.referencedColumn)) return query
  const refParts = fk.referencedTable.split('.').filter(isIdent)
  const refName = refParts.pop()
  if (!refName) return query
  const refTable = refParts.length ? `${refParts.join('.')}.${refName}` : refName
  // already joined (referenced table present after a JOIN keyword, schema-qualified or not)
  if (new RegExp(`\\bJOIN\\s+(?:\\[?[A-Za-z0-9_]+\\]?\\.)?\\[?${escapeRe(refName)}\\s*\\]?`, 'i').test(query)) return query

  const { query: q, qual } = resolveBaseQualifier(query, base)
  let alias = 'fk1'
  for (let i = 1; new RegExp(`\\b${alias}\\b`, 'i').test(q); i++) alias = `fk${i + 1}`
  const join = `\nLEFT JOIN ${refTable} AS ${alias} ON ${alias}.${fk.referencedColumn} = ${qual}.${fk.column}`
  const clause = /\b(WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET)\b/i.exec(q)
  if (clause) {
    return q.slice(0, clause.index).trimEnd() + join + '\n' + q.slice(clause.index).trimStart()
  }
  let body = q
  let hadSemi = false
  if (body.trimEnd().endsWith(';')) { hadSemi = true; body = body.trimEnd().slice(0, -1) }
  return body.trimEnd() + join + (hadSemi ? ';\n' : '\n')
}

// WHERE clause region (without the WHERE keyword), if present.
function findWhereClause(query: string): { start: number; end: number } | null {
  const wm = /\bWHERE\b/i.exec(query)
  if (!wm) return null
  const start = wm.index + wm[0].length
  const after = query.slice(start)
  const end = /\b(GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET)\b/i.exec(after)
  return { start, end: end ? start + end.index : query.length }
}

interface EditTarget {
  id: string | null
  server: string
  database: string
  user: string
  password: string
  port: string
}

const EMPTY_EDIT: EditTarget = { id: null, server: '', database: '', user: '', password: '', port: '' }

export function SqlPanel() {
  const { connections, addConnection, updateConnection, removeConnection, activeConnection, setActiveConnection, queryResults, setLoading } = useSqlStore()
  const showToast = useToastStore(s => s.showToast)
  const queryEditorRef = useRef<QueryEditorHandle | null>(null)
  const [showConnect, setShowConnect] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [edit, setEdit] = useState<EditTarget>(EMPTY_EDIT)

  const handleJoinRequest = (fk: SqlForeignKeyInfo) => {
    const q = queryEditorRef.current?.getQuery() || ''
    const next = appendLeftJoin(q, fk)
    if (next === q) {
      showToast('join non aggiunta: la tabella è già presente o la FK non appartiene alla tabella base', 'info')
      return
    }
    queryEditorRef.current?.setQuery(next)
  }

  // SQL literal for the given column value (quoted strings, ISO dates, raw numbers).
  const sqlLiteral = (col: string, v: unknown): string => {
    if (v === null || v === undefined) return 'NULL'
    const t = queryResults?.colTypes?.[col]
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

  // Click on a PK value → add/replace `WHERE <qual>.<pkCol> = <value>`, never duplicating.
  const filterByPk = (query: string, col: string, value: unknown): string => {
    const base = extractBaseTable(query)
    if (!base) return query
    if (!isIdent(col)) return query
    const { query: q, qual } = resolveBaseQualifier(query, base)
    const literal = sqlLiteral(col, value)
    const pred = `${qual}.${col} = ${literal}`
    const wc = findWhereClause(q)
    if (!wc) {
      // insert WHERE after FROM/JOINs (before trailing clauses or at the end)
      const clause = /\b(GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET)\b/i.exec(q)
      if (clause) {
        return q.slice(0, clause.index).trimEnd() + `\nWHERE ${pred}\n` + q.slice(clause.index).trimStart()
      }
      let body = q
      let hadSemi = false
      if (body.trimEnd().endsWith(';')) { hadSemi = true; body = body.trimEnd().slice(0, -1) }
      return body.trimEnd() + `\nWHERE ${pred}` + (hadSemi ? ';\n' : '\n')
    }
    // WHERE exists: do not duplicate a predicate on the same column
    const body = q.slice(wc.start, wc.end)
    if (new RegExp(`\\b(?:${escapeRe(qual)}\\.)?${escapeRe(col)}\\s*=`, 'i').test(body)) {
      // only replace a simple unquoted token (numbers/bools); quoted literals are left as-is
      const updRe = new RegExp(`\\b${escapeRe(qual)}\\.${escapeRe(col)}\\s*=\\s*([^'\\s,;)]+)`, 'i')
      const upd = updRe.exec(body)
      if (upd && upd[1] !== literal) {
        const valStart = wc.start + upd.index + upd[0].length - upd[1].length
        return q.slice(0, valStart) + literal + q.slice(valStart + upd[1].length)
      }
      return q
    }
    // append AND to the existing WHERE body
    return q.slice(0, wc.end).trimEnd() + `\n  AND ${pred}` + q.slice(wc.end)
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

  const openNew = () => { setEdit(EMPTY_EDIT); setShowConnect(true) }
  const openEdit = (conn: SqlConnection) => {
    setEdit({
      id: conn.id,
      server: conn.server,
      database: conn.database || '',
      user: conn.user || '',
      password: conn.password || '',
      port: conn.port ? String(conn.port) : ''
    })
    setShowConnect(true)
  }

  const handleConnect = async () => {
    if (!edit.server) return
    setLoading(true)
    const config: SqlConnectionConfig = {
      server: edit.server,
      database: edit.database || undefined,
      user: edit.user || undefined,
      password: edit.password || undefined,
      port: edit.port ? parseInt(edit.port) : undefined
    }
    // persist a stable id so the config survives even if the connection fails
    const connId = edit.id ?? crypto.randomUUID()
    const label = `${edit.server}${edit.database ? `/${edit.database}` : ''}`
    let ok = false
    let error = ''
    try {
      if (edit.id) await window.electronAPI.sql.disconnect(edit.id).catch(() => {})
      await window.electronAPI.sql.connect({ ...config, connectionId: connId })
      ok = true
    } catch (e) {
      error = (e as Error).message
    }
    const conn = { server: edit.server, database: config.database, user: config.user, password: config.password, port: config.port, isConnected: ok, label }
    if (edit.id) updateConnection(connId, conn)
    else addConnection({ ...conn, id: connId })
    if (ok) {
      setActiveConnection(connId)
      showToast(`connesso a ${label}`)
    } else {
      showToast(`connessione fallita: ${error || 'server non raggiungibile'}`, 'error')
    }
    setLoading(false)
    setShowConnect(false)
  }

  const handleReconnect = async (id: string) => {
    const conn = connections.find(c => c.id === id)
    if (!conn) return
    if (conn.isConnected) { setActiveConnection(id); return }
    setLoading(true)
    try {
      const config: SqlConnectionConfig = {
        server: conn.server, database: conn.database,
        user: conn.user, password: conn.password, port: conn.port
      }
      await window.electronAPI.sql.connect({ ...config, connectionId: conn.id })
      updateConnection(conn.id, { isConnected: true })
      setActiveConnection(conn.id)
    } catch { /* keep disconnected */ } finally { setLoading(false) }
  }

  const handleDisconnect = async (id: string) => {
    await window.electronAPI.sql.disconnect(id).catch(() => {})
    updateConnection(id, { isConnected: false })
  }

  const handleRemove = async (id: string) => {
    await window.electronAPI.sql.disconnect(id).catch(() => {})
    removeConnection(id)
    if (activeConnection === id) setActiveConnection(null)
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
              color: 'var(--text-secondary)', cursor: 'pointer'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}>
            {sidebarCollapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
          </button>
          <button onClick={openNew} style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            padding: '5px 14px', height: '30px',
            background: 'var(--accent-color)', color: 'var(--text-inverse)',
            border: 'none', borderRadius: 'var(--radius-md)',
            cursor: 'pointer', fontSize: '11px', fontWeight: 600,
            fontFamily: 'var(--font-mono)'
          }}>
            <Plus size={13} /> new conn
          </button>
        </div>
      }
    >
      <div style={{ height: '100%' }}>
        <ResizableSplitter direction="horizontal" defaultSize={200} minSize={150} maxSize={320} collapsed={sidebarCollapsed}>
          <ConnectionTree
            connections={connections}
            activeConnection={activeConnection}
            onSelect={setActiveConnection}
            onReconnect={handleReconnect}
            onDisconnect={handleDisconnect}
            onEdit={openEdit}
            onRemove={handleRemove}
          />
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            overflow: 'hidden',
            padding: '0 0 0 4px'
          }}>
            <QueryEditor connectionId={activeConnection} handleRef={queryEditorRef} />
            <ResultViewer results={queryResults} onJoinRequest={handleJoinRequest} onFilterRequest={handleFilterRequest} />
          </div>
        </ResizableSplitter>
      </div>

      {showConnect && (
        <div style={{
          position: 'fixed', inset: 0, background: 'var(--bg-overlay)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100, backdropFilter: 'blur(2px)'
        }}>
          <div style={{
            background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)', width: '380px', padding: '24px',
            fontFamily: 'var(--font-mono)'
          }}>
            <h3 style={{ margin: '0 0 18px', fontSize: '14px', fontWeight: 600 }}>
              {edit.id ? 'edit connection' : 'new sql connection'}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <SqlField label="server" value={edit.server} onChange={(v) => setEdit({ ...edit, server: v })} placeholder="localhost" />
              <SqlField label="database" value={edit.database} onChange={(v) => setEdit({ ...edit, database: v })} placeholder="(optional)" />
              <SqlField label="user" value={edit.user} onChange={(v) => setEdit({ ...edit, user: v })} placeholder="(windows auth if empty)" />
              <SqlField label="password" value={edit.password} onChange={(v) => setEdit({ ...edit, password: v })} type="password" placeholder="..." />
              <SqlField label="port" value={edit.port} onChange={(v) => setEdit({ ...edit, port: v })} placeholder="1433" />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
                <button onClick={() => setShowConnect(false)} style={{
                  padding: '7px 16px', background: 'var(--bg-card)',
                  border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
                  color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '12px',
                  fontFamily: 'var(--font-mono)'
                }}>cancel</button>
                <button onClick={handleConnect} disabled={!edit.server} style={{
                  padding: '7px 16px',
                  background: edit.server ? 'var(--accent-color)' : 'var(--bg-disabled)',
                  border: 'none', borderRadius: 'var(--radius-md)',
                  color: edit.server ? 'var(--text-inverse)' : 'var(--text-muted)',
                  cursor: edit.server ? 'pointer' : 'not-allowed', fontSize: '12px',
                  fontFamily: 'var(--font-mono)', fontWeight: 600
                }}>{edit.id ? 'save' : 'connect'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PanelContainer>
  )
}

function SqlField({ label, value, onChange, placeholder, type = 'text' }: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <label style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
      {label}
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{
          display: 'block', width: '100%', marginTop: '3px',
          padding: '7px 10px', background: 'var(--bg-input)',
          border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
          color: 'var(--text-primary)', fontSize: '12px',
          fontFamily: 'var(--font-mono)', boxSizing: 'border-box',
          outline: 'none'
        }}
      />
    </label>
  )
}
