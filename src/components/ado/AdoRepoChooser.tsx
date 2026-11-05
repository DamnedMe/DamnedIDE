import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Network, RotateCw, Settings } from '@/components/icons'
import { useAdoSettingsStore, useSettingsNavStore } from '../../store'
import type { AdoFolderState } from '../../hooks/useAdoFolder'
import type { AdoRepoList } from '../../shared/adoSettings'
import { encodeRef } from '../settings/ado/adoUi'
import { ipcMessage, px } from '../settings/ui'

/**
 * Repositories of one connection from the shared catalog (cached by the main
 * process), read once per connection when nobody has asked for them yet.
 * undefined while unknown.
 */
export function useConnectionRepos(connectionId: string | null): AdoRepoList | undefined {
  const list = useAdoSettingsStore(s => (connectionId ? s.catalog[connectionId] : undefined))
  const requested = useRef<string | null>(null)
  useEffect(() => {
    if (!connectionId || list || requested.current === connectionId) return
    requested.current = connectionId
    void useAdoSettingsStore.getState().loadCatalog()
  }, [connectionId, list])
  return list
}

/**
 * What to do when the Azure DevOps repository of the open folder is not clear:
 * no connection (configure it in Settings), several or no same-name
 * repositories (choose one: it is remembered for the folder), every catalog
 * failed (errors, retry). Renders nothing once the folder is ready.
 * `compact` is a one-line banner for the worktree view and the dialogs.
 */
export function AdoRepoChooser({ state, compact = false }: { state: AdoFolderState; compact?: boolean }) {
  const connections = useAdoSettingsStore(s => s.settings?.connections)
  const catalogLoading = useAdoSettingsStore(s => s.catalogLoading)
  const [pickKey, setPickKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (state.status === 'ready') return null

  const openConnections = () => useSettingsNavStore.getState().openSettings('ado-connections')
  const retry = () => { void useAdoSettingsStore.getState().loadCatalog(true) }

  const chosen = state.candidates.find(c => encodeRef(c) === pickKey) ?? null
  const choose = async () => {
    if (!chosen || saving) return
    setSaving(true)
    setError(null)
    try {
      await state.choose(chosen)
    } catch (e) {
      setError(ipcMessage(e, 'salvataggio non riuscito'))
    } finally {
      setSaving(false)
    }
  }

  // candidates grouped by connection, in the Settings order
  const groups = (connections ?? [])
    .map(c => ({ c, refs: state.candidates.filter(r => r.connectionId === c.id) }))
    .filter(g => g.refs.length > 0)

  const name = <b style={{ color: compact ? 'inherit' : 'var(--text-primary)' }}>«{state.folderName}»</b>
  let message: React.ReactNode
  switch (state.status) {
    case 'loading':
      message = 'lettura da Azure DevOps...'
      break
    case 'no-connections':
      message = 'nessuna connessione Azure DevOps configurata'
      break
    case 'ambiguous':
      message = <>più repository Azure DevOps si chiamano {name}: scegli quale usare per questa cartella</>
      break
    case 'none':
      message = state.candidates.length > 0
        ? <>nessuna repository Azure DevOps si chiama {name}: scegli quale usare per questa cartella</>
        : <>nessuna repository Azure DevOps si chiama {name} e le connessioni non ne restituiscono altre</>
      break
    case 'error':
      message = 'le repository Azure DevOps non sono leggibili'
      break
  }

  const canChoose = (state.status === 'ambiguous' || state.status === 'none') && state.candidates.length > 0
  const showSettings = state.status === 'no-connections' || state.status === 'error' || (state.status === 'none' && !canChoose)
  const showRetry = state.errors.length > 0
  // nothing configured (or still reading) is information, not a problem
  const warn = state.status !== 'no-connections' && state.status !== 'loading'

  const selectStyle: React.CSSProperties = {
    padding: compact ? '2px 6px' : '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', outline: 'none', minWidth: 0,
    maxWidth: compact ? '260px' : '100%', flex: compact ? '0 1 auto' : 1,
    fontSize: px(compact ? 10 : 12), fontFamily: 'var(--font-mono)'
  }
  const btnStyle = (primary: boolean, enabled = true): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, whiteSpace: 'nowrap',
    padding: compact ? '2px 8px' : '6px 12px', borderRadius: 'var(--radius-sm)',
    border: primary ? 'none' : '1px solid var(--border-color)',
    background: primary ? (enabled ? 'var(--accent-color)' : 'var(--bg-disabled)') : 'var(--bg-card)',
    color: primary ? (enabled ? 'var(--text-inverse)' : 'var(--text-muted)') : 'var(--text-secondary)',
    cursor: enabled ? 'pointer' : 'not-allowed',
    fontSize: px(compact ? 10 : 12), fontFamily: 'var(--font-mono)', fontWeight: 600
  })

  const controls = (
    <>
      {canChoose && (
        <>
          <select value={chosen ? encodeRef(chosen) : ''} onChange={(e) => setPickKey(e.target.value)} disabled={saving}
            aria-label="repository Azure DevOps" title="repository Azure DevOps"
            data-tip-desc="repository Azure DevOps usata da questa cartella (lavori, PBI, pull request, rilascio)"
            style={selectStyle}>
            <option value="">scegli una repository…</option>
            {groups.map(({ c, refs }) => (
              <optgroup key={c.id} label={`${c.organization} / ${c.project}`}>
                {refs.map(r => <option key={encodeRef(r)} value={encodeRef(r)}>{r.repository}</option>)}
              </optgroup>
            ))}
          </select>
          <button onClick={() => void choose()} disabled={!chosen || saving}
            title="usa e ricorda" data-tip-desc="usa questa repository per la cartella e ricordala (Impostazioni › Azure DevOps › Repository per cartella)"
            style={btnStyle(true, !!chosen && !saving)}>
            {saving && <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />}
            usa e ricorda
          </button>
        </>
      )}
      {showRetry && (
        <button onClick={retry} disabled={catalogLoading} title="riprova" data-tip-desc="leggi di nuovo le repository da Azure DevOps"
          style={btnStyle(false, !catalogLoading)}>
          {catalogLoading ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <RotateCw size={10} />}
          riprova
        </button>
      )}
      {showSettings && (
        <button onClick={openConnections}
          title="configura in Impostazioni" data-tip-desc="apri Impostazioni › Azure DevOps › Connessioni"
          style={btnStyle(state.status === 'no-connections' && !compact)}>
          <Settings size={10} /> configura in Impostazioni
        </button>
      )}
    </>
  )

  const errors = state.errors.length > 0 && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', color: 'var(--text-muted)', fontSize: px(compact ? 9 : 11), wordBreak: 'break-word', lineHeight: 1.5 }}>
      {state.errors.map(e => <span key={e}>{e}</span>)}
    </div>
  )
  const saveError = error && (
    <div style={{ color: 'var(--error-color)', fontSize: px(compact ? 9 : 11), wordBreak: 'break-word' }}>{error}</div>
  )

  if (compact) {
    return (
      <div role="status" style={{
        display: 'flex', flexDirection: 'column', gap: '4px', padding: '5px 10px',
        background: warn ? 'var(--warning-bg)' : 'var(--bg-subtle)',
        border: `1px solid ${warn ? 'var(--warning-color)' : 'var(--border-color)'}`,
        borderRadius: 'var(--radius-sm)', color: warn ? 'var(--warning-color)' : 'var(--text-muted)',
        fontSize: px(10), fontFamily: 'var(--font-mono)', lineHeight: 1.5
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {state.status === 'loading'
            ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
            : <AlertTriangle size={11} style={{ flexShrink: 0 }} />}
          <span style={{ minWidth: 0 }}>{message}</span>
          {controls}
        </div>
        {errors}
        {saveError}
      </div>
    )
  }

  return (
    <div style={{
      flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: '24px 16px'
    }}>
      <div style={{
        width: '100%', maxWidth: '460px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
        textAlign: 'center', color: 'var(--text-secondary)', fontSize: px(13)
      }}>
        {state.status === 'loading'
          ? <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-color)' }} />
          : <Network size={32} strokeWidth={1} />}
        <div style={{ lineHeight: 1.5 }}>{message}</div>
        {state.status === 'no-connections' && (
          <div style={{ color: 'var(--text-muted)', fontSize: px(11), lineHeight: 1.5 }}>
            organization, project e PAT si configurano una volta in Impostazioni › Azure DevOps; ogni cartella usa la
            repository con il suo stesso nome
          </div>
        )}
        {errors}
        {(canChoose || showRetry || showSettings) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', justifyContent: 'center', flexWrap: 'wrap' }}>
            {controls}
          </div>
        )}
        {saveError}
      </div>
    </div>
  )
}
