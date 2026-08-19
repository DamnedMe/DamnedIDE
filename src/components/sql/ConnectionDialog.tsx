import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SqlConnection, SqlConnectionConfig, SqlRecentConnection, SqlTestResult } from '../../types/sql'
import { Modal } from '../layout/Modal'
import { AUTH_TYPES, ConnectionForm, EMPTY_FORM, connectionToForm, formToConfig } from './sqlForm'
import { Database, History, KeyRound, Link2, Loader2, PlugZap, ShieldCheck, X } from 'lucide-react'

type TabId = 'login' | 'properties' | 'string'

interface ConnectionDialogProps {
  initial: Partial<SqlConnection> | null
  recent: SqlRecentConnection[]
  onClose: () => void
  onTest: (config: SqlConnectionConfig) => Promise<SqlTestResult>
  onListDatabases: (config: SqlConnectionConfig) => Promise<string[]>
  onConnect: (config: SqlConnectionConfig) => Promise<{ ok: boolean; error?: string }>
}

export function ConnectionDialog({ initial, recent, onClose, onTest, onListDatabases, onConnect }: ConnectionDialogProps) {
  const [tab, setTab] = useState<TabId>('login')
  const [form, setForm] = useState<ConnectionForm>(() => connectionToForm(initial || {}))
  const [testing, setTesting] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [databases, setDatabases] = useState<string[] | null>(null)
  const [loadingDbs, setLoadingDbs] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [stringMode, setStringMode] = useState<'auto' | 'custom'>('auto')
  const [customString, setCustomString] = useState('')
  const [autoString, setAutoString] = useState('')
  const serverRef = useRef<HTMLInputElement | null>(null)

  const set = (patch: Partial<ConnectionForm>) => setForm(f => ({ ...f, ...patch }))

  const history = useMemo(() => {
    const seen = new Set<string>()
    const out: SqlRecentConnection[] = []
    for (const r of recent) {
      const k = `${r.server}|${r.database || ''}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push(r)
    }
    return out
  }, [recent])

  // Live connection string (auto mode): rebuilt when the form changes.
  useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      const cfg = formToConfig(form)
      if (!cfg.server) return
      window.electronAPI.sql.buildConnectionString(cfg).then((s) => {
        if (alive) setAutoString(s)
      }).catch(() => {})
    }, 200)
    return () => { alive = false; clearTimeout(t) }
  }, [form])

  const canConnect = form.server.trim().length > 0
  const isLocalDb = /^\(localdb\)/i.test(form.server.trim())

  const handleTest = async () => {
    if (!canConnect || testing) return
    setTesting(true)
    setTestResult(null)
    const res = await onTest(formToConfig(form))
    if (res.ok) {
      setTestResult({ ok: true, message: res.version ? `connected · ${res.version.split('\n')[0]}` : 'connection succeeded' })
      if (databases === null) {
        setLoadingDbs(true)
        onListDatabases({ ...formToConfig(form), database: undefined })
          .then(setDatabases)
          .catch(() => {})
          .finally(() => setLoadingDbs(false))
      }
    } else {
      setTestResult({ ok: false, message: res.error || 'connection failed' })
    }
    setTesting(false)
  }

  const handleConnect = async () => {
    if (!canConnect || connecting) return
    setConnecting(true)
    const cfg = stringMode === 'custom' && customString.trim()
      ? await parseString(customString)
      : formToConfig(form)
    const res = await onConnect(cfg)
    if (res.ok) onClose()
    else setTestResult({ ok: false, message: res.error || 'connection failed' })
    setConnecting(false)
  }

  const parseString = async (cs: string): Promise<SqlConnectionConfig> => {
    const parsed = await window.electronAPI.sql.parseConnectionString(cs)
    setForm(connectionToForm(parsed))
    setStringMode('auto')
    return parsed as SqlConnectionConfig
  }

  const pickHistory = (r: SqlRecentConnection) => {
    set({
      server: r.server,
      ...(r.database ? { database: r.database } : {}),
      ...(r.user ? { user: r.user } : {}),
      ...(r.authType ? { authType: r.authType } : {})
    })
    setShowHistory(false)
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: 'login', label: 'login' },
    { id: 'properties', label: 'connection properties' },
    { id: 'string', label: 'connection string' }
  ]

  const authNeeds: string[] = ({
    'windows': ['domain', 'user', 'password'],
    'sql': ['user', 'password'],
    'azure-password': ['user', 'password'],
    'azure-default': [],
    'azure-service-principal': ['tenantId', 'clientId', 'clientSecret'],
    'azure-msi-app': [],
    'azure-msi-vm': [],
    'azure-token': ['accessToken']
  } as Record<string, string[]>)[form.authType] || []

  return (
    <Modal onClose={onClose} width={470} label="connect to server">
      <div style={{ padding: '16px 20px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 'calc(14px * var(--ui-text-scale, 1))', fontWeight: 600, color: 'var(--text-primary)' }}>
              {initial?.id ? 'edit connection' : 'connect to server'}
            </div>
            <div style={{ fontSize: 'calc(10px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', marginTop: '2px' }}>
              database engine · damnedide
            </div>
          </div>
          <button onClick={onClose} aria-label="close" title="close" data-tip-desc="close this panel or dialog"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '28px', height: '28px', background: 'var(--bg-card)',
              border: '1px solid var(--border-color)', borderRadius: '50%',
              color: 'var(--text-secondary)', cursor: 'pointer', transition: 'transform 140ms ease, color 140ms ease'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}>
            <X size={13} />
          </button>
        </div>
        <div style={{ display: 'flex', gap: '2px', marginTop: '14px', borderBottom: '1px solid var(--border-subtle)' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                padding: '6px 12px', fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
                background: tab === t.id ? 'var(--bg-card)' : 'transparent',
                color: tab === t.id ? 'var(--accent-color)' : 'var(--text-secondary)',
                border: '1px solid transparent', borderBottom: 'none',
                borderTopLeftRadius: 'var(--radius-sm)', borderTopRightRadius: 'var(--radius-sm)',
                cursor: 'pointer', fontWeight: tab === t.id ? 600 : 400,
                transition: 'color 140ms ease'
              }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {tab === 'login' && (
          <>
            <Field label="server name">
              <div style={{ display: 'flex', gap: '4px' }}>
                <input
                  ref={serverRef}
                  value={form.server}
                  onChange={(e) => {
                    const server = e.target.value
                    set({ server, ...(/^\(localdb\)/i.test(server.trim()) ? { encrypt: false } : {}) })
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleTest()
                  }}
                  placeholder="localhost · (localdb)\\MSSQLLocalDB · server\\instance"
                  spellCheck={false}
                  style={inputStyle}
                />
                <button
                  onClick={() => setShowHistory(v => !v)}
                  title="recent connections" data-tip-desc="recently used SQL connections"
                  style={iconBtnStyle}
                >
                  <History size={13} />
                </button>
              </div>
              {showHistory && (
                <div style={{ marginTop: '4px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', animation: 'menuIn 140ms ease' }}>
                  {history.length === 0 && (
                    <div style={{ padding: '8px 10px', fontSize: 'calc(10px * var(--ui-text-scale, 1))', color: 'var(--text-muted)' }}>no recent connections</div>
                  )}
                  {history.map((r, i) => (
                    <div key={i} onClick={() => pickHistory(r)}
                      style={{ padding: '6px 10px', fontSize: 'calc(11px * var(--ui-text-scale, 1))', cursor: 'pointer', color: 'var(--text-primary)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
                      <span style={{ fontWeight: 500 }}>{r.server}</span>
                      {r.database && <span style={{ color: 'var(--text-muted)' }}> / {r.database}</span>}
                      {r.user && <span style={{ color: 'var(--text-muted)' }}> · {r.user}</span>}
                    </div>
                  ))}
                </div>
              )}
              {isLocalDb && <div style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: 9 }}>LocalDB uses its local named pipe; transport encryption is disabled automatically.</div>}
            </Field>

            <Field label="authentication">
              <select value={form.authType} onChange={(e) => set({ authType: e.target.value as ConnectionForm['authType'] })} style={inputStyle}>
                {AUTH_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </Field>

            {authNeeds.includes('domain') && (
              <Field label="domain (optional)">
                <input value={form.domain} onChange={(e) => set({ domain: e.target.value })} spellCheck={false} style={inputStyle} />
              </Field>
            )}
            {(authNeeds.includes('user')) && (
              <Field label={form.authType === 'windows' ? 'user name (optional)' : 'login'}>
                <input value={form.user} onChange={(e) => set({ user: e.target.value })} spellCheck={false} style={inputStyle} autoComplete="off" />
              </Field>
            )}
            {authNeeds.includes('password') && (
              <Field label="password">
                <input type="password" value={form.password} onChange={(e) => set({ password: e.target.value })} spellCheck={false} style={inputStyle} autoComplete="off" />
                <div style={{ marginTop: '5px' }}>
                  <Checkbox
                    label="remember password"
                    checked={form.rememberPassword}
                    onChange={(v) => set({ rememberPassword: v })}
                  />
                </div>
              </Field>
            )}
            {authNeeds.includes('tenantId') && (
              <Field label="tenant id">
                <input value={form.tenantId} onChange={(e) => set({ tenantId: e.target.value })} spellCheck={false} style={inputStyle} />
              </Field>
            )}
            {authNeeds.includes('clientId') && (
              <Field label="client id">
                <input value={form.clientId} onChange={(e) => set({ clientId: e.target.value })} spellCheck={false} style={inputStyle} />
              </Field>
            )}
            {authNeeds.includes('clientSecret') && (
              <Field label="client secret">
                <input type="password" value={form.clientSecret} onChange={(e) => set({ clientSecret: e.target.value })} spellCheck={false} style={inputStyle} autoComplete="off" />
              </Field>
            )}
            {authNeeds.includes('accessToken') && (
              <Field label="access token">
                <textarea
                  value={form.accessToken}
                  onChange={(e) => set({ accessToken: e.target.value })}
                  spellCheck={false}
                  style={{ ...inputStyle, height: '72px', resize: 'none', lineHeight: 1.4 }}
                />
              </Field>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px' }}>
              <button onClick={handleTest} disabled={!canConnect || testing}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '6px 14px', fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
                  background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-pill, 999px)', color: 'var(--text-primary)',
                  cursor: canConnect && !testing ? 'pointer' : 'not-allowed',
                  transition: 'transform 140ms ease'
                }}
                onMouseDown={(e) => { if (canConnect && !testing) e.currentTarget.style.transform = 'scale(0.98)' }}
                onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)' }}>
                {testing ? <Loader2 size={12} style={{ animation: 'spin 0.9s linear infinite' }} /> : <PlugZap size={12} />}
                test connection
              </button>
              {testResult && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: '5px',
                  maxWidth: '62%', fontSize: 'calc(9.5px * var(--ui-text-scale, 1))', lineHeight: 1.45,
                  color: testResult.ok ? 'var(--success-color)' : 'var(--error-color)',
                  overflow: 'hidden'
                }}>
                  {testResult.ok ? <ShieldCheck size={11} style={{ flexShrink: 0, marginTop: 1 }} /> : <X size={11} style={{ flexShrink: 0, marginTop: 1 }} />}
                  <span style={{ wordBreak: 'break-word' }}>{testResult.message}</span>
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'properties' && (
          <>
            <Field label="database name">
              <div style={{ display: 'flex', gap: '4px' }}>
                <select
                  value={form.database}
                  onChange={(e) => set({ database: e.target.value })}
                  style={inputStyle}
                  disabled={databases === null && !loadingDbs}
                >
                  {form.database && (!databases || !databases.includes(form.database)) && (
                    <option value={form.database}>{form.database} (custom)</option>
                  )}
                  {!form.database && <option value="">&lt;default&gt;</option>}
                  {(databases || []).map(db => <option key={db} value={db}>{db}</option>)}
                </select>
                <button
                  onClick={async () => {
                    setLoadingDbs(true)
                    onListDatabases({ ...formToConfig(form), database: undefined })
                      .then(setDatabases)
                      .catch(() => {})
                      .finally(() => setLoadingDbs(false))
                  }}
                  disabled={loadingDbs}
                  title="load databases" data-tip-desc="load the databases of this connection"
                  style={{ ...iconBtnStyle, width: 'auto', padding: '0 10px', fontSize: 'calc(10px * var(--ui-text-scale, 1))', gap: '4px' }}
                >
                  {loadingDbs ? <Loader2 size={12} style={{ animation: 'spin 0.9s linear infinite' }} /> : <Database size={12} />}
                  load
                </button>
              </div>
              <div style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', marginTop: '3px' }}>
                {databases === null ? 'connect or test first, then load the database list' : `${databases.length} databases`}
              </div>
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <Field label="network protocol">
                <select value={form.protocol} onChange={(e) => set({ protocol: e.target.value as ConnectionForm['protocol'] })} style={inputStyle}>
                  <option value="default">default</option>
                  <option value="tcp">TCP/IP</option>
                  <option value="named-pipes">named pipes</option>
                </select>
              </Field>
              <Field label="port (optional)">
                <input value={form.port} onChange={(e) => set({ port: e.target.value })} placeholder="1433" spellCheck={false} style={inputStyle} />
              </Field>
              <Field label="connection timeout (s)">
                <input value={form.connectTimeout} onChange={(e) => set({ connectTimeout: e.target.value })} spellCheck={false} style={inputStyle} />
              </Field>
              <Field label="execution timeout (s)">
                <input value={form.requestTimeout} onChange={(e) => set({ requestTimeout: e.target.value })} spellCheck={false} style={inputStyle} />
              </Field>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '2px' }}>
              <Checkbox label="encrypt connection" checked={isLocalDb ? false : form.encrypt} disabled={isLocalDb} onChange={(v) => set({ encrypt: v })} />
              <Checkbox label="trust server certificate" checked={form.trustServerCertificate} onChange={(v) => set({ trustServerCertificate: v })} />
            </div>
          </>
        )}

        {tab === 'string' && (
          <>
            <div style={{ fontSize: 'calc(10px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {stringMode === 'auto'
                ? 'connection string derived from the form fields. edit it to override.'
                : 'custom connection string: it will be parsed and used for the connection.'}
            </div>
            <textarea
              value={stringMode === 'auto' ? autoString : customString}
              onChange={(e) => {
                setStringMode('custom')
                setCustomString(e.target.value)
              }}
              onFocus={() => setStringMode('custom')}
              spellCheck={false}
              placeholder="Server=localhost;Database=myDb;User Id=sa;Password=...;TrustServerCertificate=True;Encrypt=False"
              style={{ ...inputStyle, height: '130px', resize: 'vertical', lineHeight: 1.5, fontSize: 'calc(10.5px * var(--ui-text-scale, 1))' }}
            />
            <button
              onClick={async () => {
                if (stringMode === 'custom' && customString.trim()) {
                  await parseString(customString)
                  setTab('login')
                }
              }}
              disabled={stringMode === 'custom' && !customString.trim()}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', alignSelf: 'flex-start',
                padding: '6px 14px', fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
                background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-pill, 999px)', color: 'var(--text-primary)', cursor: 'pointer'
              }}
            >
              <KeyRound size={12} />
              {stringMode === 'custom' ? 'use this string' : 'edit connection string'}
            </button>
          </>
        )}
      </div>

      <div style={{
        padding: '12px 20px', borderTop: '1px solid var(--border-subtle)',
        display: 'flex', justifyContent: 'flex-end', gap: '8px', flexShrink: 0
      }}>
        <button onClick={onClose} style={ghostBtnStyle}>cancel</button>
        <button onClick={handleConnect} disabled={!canConnect || connecting}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '7px 18px', fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600,
            background: canConnect && !connecting ? 'var(--accent-color)' : 'var(--bg-disabled)',
            color: canConnect && !connecting ? 'var(--text-inverse)' : 'var(--text-muted)',
            border: 'none', borderRadius: 'var(--radius-md)',
            cursor: canConnect && !connecting ? 'pointer' : 'not-allowed'
          }}>
          {connecting ? <Loader2 size={12} style={{ animation: 'spin 0.9s linear infinite' }} /> : <Link2 size={12} />}
          {initial?.id ? 'save & connect' : 'connect'}
        </button>
      </div>
    </Modal>
  )
}

const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%', padding: '7px 10px',
  background: 'var(--bg-input)', border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
  fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', boxSizing: 'border-box',
  outline: 'none'
}

const iconBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: '30px', height: '30px', flexShrink: 0,
  background: 'var(--bg-card)', border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)', cursor: 'pointer'
}

const ghostBtnStyle: React.CSSProperties = {
  padding: '7px 16px', background: 'var(--bg-card)',
  border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
  color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 'calc(11px * var(--ui-text-scale, 1))',
  fontFamily: 'var(--font-mono)'
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ fontSize: 'calc(10.5px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', display: 'block' }}>
      <span style={{ display: 'block', marginBottom: '3px' }}>{label}</span>
      {children}
    </label>
  )
}

function Checkbox({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'calc(11px * var(--ui-text-scale, 1))', cursor: disabled ? 'not-allowed' : 'pointer', color: disabled ? 'var(--text-muted)' : 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: 'var(--accent-color)', cursor: disabled ? 'not-allowed' : 'pointer' }}
      />
      {label}
    </label>
  )
}
