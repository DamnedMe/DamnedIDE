import { useEffect, useMemo, useRef, useState } from 'react'
import { Database, HardDriveDownload, FileArchive, FolderOpen, Loader2, Check, AlertCircle, Copy, X, Ban, RefreshCw, PackageOpen } from 'lucide-react'
import { Modal } from '../layout/Modal'
import { SqlConnection } from '../../types/sql'
import { buildBackupStatement, dataTierTargetName, defaultBackupFileName, joinServerPath, type DataTierAction } from '../../shared/sqlBackup'
import { useToastStore } from '../../store'

const label: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '6px',
  fontSize: 'calc(10px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)'
}

const input: React.CSSProperties = {
  width: '100%', padding: '6px 9px', boxSizing: 'border-box',
  background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 'calc(11px * var(--ui-text-scale, 1))', outline: 'none'
}

function btn(enabled = true, accent = false): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 14px', height: '28px',
    background: enabled && accent ? 'var(--accent-color)' : 'var(--bg-card)',
    border: `1px solid ${enabled && accent ? 'var(--accent-color)' : 'var(--border-color)'}`,
    borderRadius: 'var(--radius-sm)',
    color: enabled && accent ? 'var(--text-inverse)' : (enabled ? 'var(--text-secondary)' : 'var(--text-disabled)'),
    cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.6,
    fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
  }
}

function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: 'calc(10px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  )
}

// ─── .bak backup ─────────────────────────────────────────────────────────────
// The backup file is written by the SERVER, so the path is a server-side one:
// it is prefilled with the instance's default backup directory.
export function SqlBackupDialog({ conn, database, onClose }: { conn: SqlConnection; database: string; onClose: () => void }) {
  const [directory, setDirectory] = useState<string | null>(null)
  const [path, setPath] = useState('')
  const [compress, setCompress] = useState(true)
  const [copyOnly, setCopyOnly] = useState(false)
  const [init, setInit] = useState(true)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [loadingDir, setLoadingDir] = useState(true)
  const showToast = useToastStore(s => s.showToast)

  const regenerate = (dir: string | null) => {
    const file = defaultBackupFileName(database)
    setPath(dir ? joinServerPath(dir, file) : file)
  }

  useEffect(() => {
    let cancelled = false
    window.electronAPI.sql.defaultBackupDir(conn.id, database)
      .then(dir => {
        if (cancelled) return
        setDirectory(dir)
        regenerate(dir)
      })
      .catch(() => { if (!cancelled) regenerate(null) })
      .finally(() => { if (!cancelled) setLoadingDir(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.id, database])

  const statement = useMemo(
    () => buildBackupStatement(database, { path: path || '<percorso .bak>', compress, copyOnly, init }),
    [database, path, compress, copyOnly, init]
  )

  const run = async () => {
    if (!path.trim() || running) return
    setRunning(true)
    setResult(null)
    try {
      const res = await window.electronAPI.sql.backup(conn.id, database, { path: path.trim(), compress, copyOnly, init })
      setResult(res.ok
        ? { ok: true, message: `backup completato in ${((res.elapsedMs || 0) / 1000).toFixed(1)}s` }
        : { ok: false, message: res.error || 'backup fallito' })
      if (res.ok) showToast('backup completato')
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message })
    } finally {
      setRunning(false)
    }
  }

  return (
    <Modal onClose={() => { if (!running) onClose() }} width={620} label="backup database">
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <HardDriveDownload size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'calc(13px * var(--ui-text-scale, 1))', fontWeight: 700, color: 'var(--text-primary)' }}>
              Backup di {database}
            </div>
            <div style={{ fontSize: 'calc(9.5px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {conn.server} · file .bak completo (schema + dati)
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <span style={label}>
            <FolderOpen size={11} /> percorso sul server SQL
            {loadingDir && <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />}
          </span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false} style={input}
              placeholder="C:\\Backup\\Database.bak" />
            <button onClick={() => regenerate(directory)} title="rigenera il nome con data e ora" data-tip-desc="regenerate the file name with the current timestamp"
              style={btn(!!directory)} disabled={!directory}>
              <RefreshCw size={11} />
            </button>
          </div>
          <span style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            il backup viene scritto dal server su questo percorso (non sulla macchina locale)
            {directory ? ` · default del server: ${directory}` : ''}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <Checkbox checked={compress} onChange={setCompress}>compressione</Checkbox>
          <Checkbox checked={init} onChange={setInit}>sovrascrivi se esiste</Checkbox>
          <Checkbox checked={copyOnly} onChange={setCopyOnly}>copy-only (non tocca la catena)</Checkbox>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            comando che verrà eseguito
          </span>
          <pre style={{
            margin: 0, padding: '8px 10px', maxHeight: '120px', overflow: 'auto',
            background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
            fontSize: 'calc(10px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word'
          }}>{statement}</pre>
        </div>

        {result && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '8px 10px',
            background: result.ok ? 'var(--success-bg)' : 'var(--error-bg)',
            border: `1px solid ${result.ok ? 'var(--success-color)' : 'var(--error-color)'}`,
            borderRadius: 'var(--radius-sm)', color: result.ok ? 'var(--success-color)' : 'var(--error-color)',
            fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', wordBreak: 'break-word'
          }}>
            {result.ok ? <Check size={12} style={{ flexShrink: 0, marginTop: 1 }} /> : <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} />}
            {result.message}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button onClick={onClose} disabled={running} style={btn(!running)}>chiudi</button>
          <button onClick={run} disabled={running || !path.trim()} style={btn(!running && !!path.trim(), true)}>
            {running ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Database size={11} />}
            {running ? 'backup in corso…' : 'esegui backup'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Data-tier application (extract / export) ────────────────────────────────
// Extract → .dacpac (schema only), Export → .bacpac (schema + data). Both are
// produced by SqlPackage; if it is missing the dialog explains how to install it.
export function SqlDataTierDialog({ conn, database, action, onClose }: {
  conn: SqlConnection
  database: string
  action: DataTierAction
  onClose: () => void
}) {
  const [target, setTarget] = useState<string | null>(null)
  const [info, setInfo] = useState<{ found: boolean; path?: string; hint: string } | null>(null)
  const [running, setRunning] = useState(false)
  const [lines, setLines] = useState<string[]>([])
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)
  const showToast = useToastStore(s => s.showToast)

  const title = action === 'extract' ? 'Estrai applicazione a livello dati' : 'Esporta applicazione a livello dati'
  const ext = action === 'extract' ? 'dacpac' : 'bacpac'
  const what = action === 'extract' ? 'solo schema, senza dati (.dacpac)' : 'schema e dati (.bacpac)'
  const suggested = dataTierTargetName(database, action)

  useEffect(() => {
    window.electronAPI.sql.sqlPackageInfo().then(setInfo).catch(() => setInfo({ found: false, hint: 'dotnet tool install -g microsoft.sqlpackage' }))
  }, [])

  useEffect(() => {
    const off = window.electronAPI.sql.onDataTierLog(({ line }) => setLines(prev => [...prev.slice(-400), line]))
    return off
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [lines])

  const pickFile = async () => {
    const chosen = await window.electronAPI.dialog.saveFile(suggested, [
      { name: ext.toUpperCase(), extensions: [ext] },
      { name: 'Tutti i file', extensions: ['*'] }
    ])
    if (chosen) setTarget(chosen)
  }

  const run = async () => {
    if (!target || running) return
    setRunning(true)
    setResult(null)
    setLines([])
    try {
      const res = await window.electronAPI.sql.dataTier(conn.id, database, action, target)
      setResult(res.ok
        ? { ok: true, message: `completato: ${target}` }
        : { ok: false, message: res.error || 'operazione fallita' })
      if (res.ok) showToast('operazione completata')
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message })
    } finally {
      setRunning(false)
    }
  }

  const cancel = async () => {
    await window.electronAPI.sql.dataTierCancel().catch(() => {})
    setResult({ ok: false, message: 'operazione annullata' })
    setRunning(false)
  }

  return (
    <Modal onClose={() => { if (!running) onClose() }} width={620} label="data-tier application">
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {action === 'extract' ? <PackageOpen size={16} style={{ color: 'var(--accent-color)' }} /> : <FileArchive size={16} style={{ color: 'var(--accent-color)' }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'calc(13px * var(--ui-text-scale, 1))', fontWeight: 700, color: 'var(--text-primary)' }}>
              {title}
            </div>
            <div style={{ fontSize: 'calc(9.5px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {database} · {conn.server} · {what}
            </div>
          </div>
        </div>

        {info && !info.found && (
          <div style={{
            display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px 12px',
            background: 'var(--warning-bg)', border: '1px solid var(--warning-color)',
            borderRadius: 'var(--radius-sm)', color: 'var(--warning-color)',
            fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', lineHeight: 1.6
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}>
              <AlertCircle size={12} /> SqlPackage non trovato
            </span>
            <span>
              Serve lo strumento <b>SqlPackage</b> (DacFx) per creare {ext === 'dacpac' ? 'un .dacpac' : 'un .bacpac'}.
              Installalo con il .NET SDK, oppure usa il link di Microsoft:
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <code style={{ background: 'var(--bg-primary)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}>{info.hint}</code>
              <button onClick={() => { window.electronAPI.clipboard.write(info.hint); showToast('comando copiato') }}
                style={btn(true)}>
                <Copy size={10} /> copia
              </button>
              <button onClick={() => window.electronAPI.shell.openExternal('https://learn.microsoft.com/sql/tools/sqlpackage/sqlpackage-download')}
                style={btn(true)}>
                download
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <span style={label}><FolderOpen size={11} /> file di destinazione</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input readOnly value={target || ''} placeholder={`${suggested} — scegli dove salvarlo`} style={input} />
            <button onClick={pickFile} disabled={running} style={btn(!running)}>
              sfoglia…
            </button>
          </div>
        </div>

        {(running || lines.length > 0) && (
          <div ref={logRef} style={{
            maxHeight: '160px', overflow: 'auto', padding: '8px 10px',
            background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)',
            fontSize: 'calc(9.5px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)',
            display: 'flex', flexDirection: 'column', gap: '1px'
          }}>
            {lines.length === 0 && <span style={{ color: 'var(--text-muted)' }}>avvio di SqlPackage…</span>}
            {lines.map((line, i) => <span key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{line}</span>)}
          </div>
        )}

        {result && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '8px 10px',
            background: result.ok ? 'var(--success-bg)' : 'var(--error-bg)',
            border: `1px solid ${result.ok ? 'var(--success-color)' : 'var(--error-color)'}`,
            borderRadius: 'var(--radius-sm)', color: result.ok ? 'var(--success-color)' : 'var(--error-color)',
            fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', wordBreak: 'break-word'
          }}>
            {result.ok ? <Check size={12} style={{ flexShrink: 0, marginTop: 1 }} /> : <Ban size={12} style={{ flexShrink: 0, marginTop: 1 }} />}
            {result.message}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button onClick={onClose} disabled={running} style={btn(!running)}>chiudi</button>
          {running
            ? <button onClick={cancel} style={{ ...btn(true), color: 'var(--error-color)', borderColor: 'var(--error-color)' }}>
                <X size={11} /> annulla operazione
              </button>
            : <button onClick={run} disabled={!target || !info?.found} style={btn(!!target && !!info?.found, true)}>
                {action === 'extract' ? <PackageOpen size={11} /> : <FileArchive size={11} />}
                {action === 'extract' ? 'estrai' : 'esporta'}
              </button>}
        </div>
      </div>
    </Modal>
  )
}
