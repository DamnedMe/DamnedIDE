import { useEffect, useRef, useState } from 'react'
import { Database, FolderOpen, Loader2, Check, AlertCircle, Ban, X, HardDriveUpload, FileArchive, RefreshCw } from 'lucide-react'
import { Modal } from '../layout/Modal'
import { SqlConnection } from '../../types/sql'
import { suggestedImportDatabaseName, type BackupSource } from '../../shared/sqlBackup'
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

function SourceTab({ active, icon, title, subtitle, onClick }: {
  active: boolean
  icon: React.ReactNode
  title: string
  subtitle: string
  onClick: () => void
}) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0, textAlign: 'left',
      padding: '8px 10px', background: active ? 'var(--accent-bg)' : 'var(--bg-card)',
      border: `1px solid ${active ? 'var(--accent-color)' : 'var(--border-color)'}`,
      borderRadius: 'var(--radius-sm)', cursor: 'pointer',
      color: active ? 'var(--accent-color)' : 'var(--text-secondary)'
    }}>
      {icon}
      <span style={{ display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 }}>
        <span style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontWeight: 700 }}>{title}</span>
        <span style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{subtitle}</span>
      </span>
    </button>
  )
}

/**
 * Imports a database into the current connection: either restoring a `.bak`
 * (read server-side, same model as the backup) or importing a data-tier
 * application `.bacpac` through SqlPackage. The source can be switched here,
 * the context menu pre-selects it.
 */
export function SqlImportDialog({ conn, database, source: initialSource, onClose, onImported }: {
  conn: SqlConnection
  database: string
  source: BackupSource
  onClose: () => void
  onImported?: (database: string) => void
}) {
  const [source, setSource] = useState<BackupSource>(initialSource)
  const [backupPath, setBackupPath] = useState('')
  const [bacpacPath, setBacpacPath] = useState('')
  const [targetName, setTargetName] = useState(suggestedImportDatabaseName(database, initialSource))
  const [replace, setReplace] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string; statement?: string } | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [info, setInfo] = useState<{ found: boolean; hint: string } | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)
  const showToast = useToastStore(s => s.showToast)

  useEffect(() => {
    if (source !== 'bacpac') return
    window.electronAPI.sql.sqlPackageInfo()
      .then(setInfo)
      .catch(() => setInfo({ found: false, hint: 'dotnet tool install -g microsoft.sqlpackage' }))
  }, [source])

  useEffect(() => {
    const off = window.electronAPI.sql.onDataTierLog(({ action, line }) => {
      if (action === 'import') setLines(prev => [...prev.slice(-400), line])
    })
    return off
  }, [])

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }) }, [lines])

  // the suggested target follows the source (and the selected database)
  useEffect(() => {
    setTargetName(suggestedImportDatabaseName(database, source))
    setResult(null)
  }, [source, database])

  const pickBacpac = async () => {
    const chosen = await window.electronAPI.dialog.openFile('Scegli il file .bacpac', [
      { name: 'Data-tier application', extensions: ['bacpac'] },
      { name: 'Tutti i file', extensions: ['*'] }
    ])
    if (chosen) setBacpacPath(chosen)
  }

  const canRun = !!targetName.trim() && (source === 'bak' ? !!backupPath.trim() : !!bacpacPath) && (source !== 'bacpac' || info?.found !== false)

  const run = async () => {
    if (!canRun || running) return
    setRunning(true)
    setResult(null)
    setLines([])
    try {
      if (source === 'bak') {
        const res = await window.electronAPI.sql.restore(conn.id, { path: backupPath.trim(), database: targetName.trim(), replace })
        setResult(res.ok
          ? { ok: true, message: `restore completato in ${((res.elapsedMs || 0) / 1000).toFixed(1)}s`, statement: res.statement }
          : { ok: false, message: res.error || 'restore fallito' })
        if (res.ok) {
          showToast(`database ${targetName.trim()} ripristinato`)
          onImported?.(targetName.trim())
        }
      } else {
        const res = await window.electronAPI.sql.dataTier(conn.id, targetName.trim(), 'import', bacpacPath)
        setResult(res.ok
          ? { ok: true, message: `import completato: ${targetName.trim()}` }
          : { ok: false, message: res.error || 'import fallito' })
        if (res.ok) {
          showToast(`database ${targetName.trim()} importato`)
          onImported?.(targetName.trim())
        }
      }
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message })
    } finally {
      setRunning(false)
    }
  }

  return (
    <Modal onClose={() => { if (!running) onClose() }} width={640} label="import database">
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <HardDriveUpload size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'calc(13px * var(--ui-text-scale, 1))', fontWeight: 700, color: 'var(--text-primary)' }}>
              Importa database
            </div>
            <div style={{ fontSize: 'calc(9.5px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {conn.server} · {database}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <SourceTab active={source === 'bak'} icon={<Database size={14} />} title="Backup .bak" subtitle="RESTORE di un backup completo"
            onClick={() => setSource('bak')} />
          <SourceTab active={source === 'bacpac'} icon={<FileArchive size={14} />} title="Applicazione a livello dati" subtitle="import .bacpac con SqlPackage"
            onClick={() => setSource('bacpac')} />
        </div>

        {source === 'bak' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <span style={label}><FolderOpen size={11} /> percorso del .bak sul server SQL</span>
            <input value={backupPath} onChange={(e) => setBackupPath(e.target.value)} spellCheck={false} style={input}
              placeholder="C:\\Backup\\Database.bak" aria-label="percorso backup sul server" />
            <span style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              il file viene letto dal server: deve essere raggiungibile da lì (non è un percorso locale)
            </span>
          </div>
        ) : (
          <>
            {info && !info.found && (
              <div style={{
                display: 'flex', flexDirection: 'column', gap: '4px', padding: '10px 12px',
                background: 'var(--warning-bg)', border: '1px solid var(--warning-color)',
                borderRadius: 'var(--radius-sm)', color: 'var(--warning-color)',
                fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', lineHeight: 1.6
              }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}>
                  <AlertCircle size={12} /> SqlPackage non trovato
                </span>
                <span>Serve <b>SqlPackage</b> (DacFx) per importare un .bacpac. Installalo con:</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <code style={{ background: 'var(--bg-primary)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}>{info.hint}</code>
                  <button onClick={() => { window.electronAPI.clipboard.write(info.hint); showToast('comando copiato') }} style={btn(true)}>
                    copia
                  </button>
                  <button onClick={() => window.electronAPI.shell.openExternal('https://learn.microsoft.com/sql/tools/sqlpackage/sqlpackage-download')} style={btn(true)}>
                    download
                  </button>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <span style={label}><FolderOpen size={11} /> file .bacpac</span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input readOnly value={bacpacPath} placeholder="scegli il file da importare" style={input} aria-label="file bacpac" />
                <button onClick={pickBacpac} disabled={running} style={btn(!running)}>sfoglia…</button>
              </div>
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', flex: 1, minWidth: '220px' }}>
            <span style={label}><Database size={11} /> nome del database di destinazione</span>
            <input value={targetName} onChange={(e) => setTargetName(e.target.value)} spellCheck={false} style={input}
              placeholder="nome_nuovo_database" aria-label="database di destinazione" />
          </div>
          {source === 'bak' && (
            <label style={{
              display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', paddingBottom: '6px',
              fontSize: 'calc(10px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)'
            }}>
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
              sovrascrivi se esiste (REPLACE)
            </label>
          )}
          {source === 'bacpac' && (
            <button onClick={() => setBacpacPath('')} disabled={running || !bacpacPath} title="rimuovi il file scelto"
              style={{ ...btn(!running && !!bacpacPath), height: '28px', padding: '0 10px' }}>
              <RefreshCw size={11} /> reset
            </button>
          )}
        </div>

        {(running || lines.length > 0) && source === 'bacpac' && (
          <div ref={logRef} style={{
            maxHeight: '150px', overflow: 'auto', padding: '8px 10px',
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
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
            {result.statement && (
              <pre style={{
                margin: 0, padding: '8px 10px', maxHeight: '130px', overflow: 'auto',
                background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
                fontSize: 'calc(9.5px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word'
              }}>{result.statement}</pre>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button onClick={onClose} disabled={running} style={btn(!running)}>chiudi</button>
          <button onClick={run} disabled={!canRun || running} style={btn(canRun && !running, true)}>
            {running ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <HardDriveUpload size={11} />}
            {running ? 'import in corso…' : (source === 'bak' ? 'ripristina' : 'importa')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
