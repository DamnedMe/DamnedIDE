import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Network, RotateCw, Settings } from '@/components/icons'
import { useAdoSettingsStore, useSettingsNavStore } from '../../store'
import type { AdoFolderState } from '../../hooks/useAdoFolder'
import type { AdoRepoList } from '../../shared/adoSettings'
import { encodeRef } from '../settings/ado/adoUi'
import { ipcMessage, px } from '../settings/ui'
import { tr, useI18n } from '../../i18n'

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
  const t = useI18n()
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
      setError(ipcMessage(e, tr('save failed')))
    } finally {
      setSaving(false)
    }
  }

  // candidates grouped by connection, in the Settings order
  const groups = (connections ?? [])
    .map(c => ({ c, refs: state.candidates.filter(r => r.connectionId === c.id) }))
    .filter(g => g.refs.length > 0)

  const name = <b style={{ color: compact ? 'inherit' : 'var(--text-primary)' }}>«{state.folderName}»</b>
  // the folder name is bold inside the sentence: the translation keeps {name} where it goes
  const withName = (text: string) => {
    const [before, after = ''] = text.split('{name}')
    return <>{before}{name}{after}</>
  }
  let message: React.ReactNode
  switch (state.status) {
    case 'loading':
      message = t('reading from Azure DevOps...')
      break
    case 'no-connections':
      message = t('no Azure DevOps connection configured')
      break
    case 'ambiguous':
      message = withName(t('several Azure DevOps repositories are named {name}: choose the one to use for this folder'))
      break
    case 'none':
      message = state.candidates.length > 0
        ? withName(t('no Azure DevOps repository is named {name}: choose the one to use for this folder'))
        : withName(t('no Azure DevOps repository is named {name} and the connections return no other'))
      break
    case 'error':
      message = t('the Azure DevOps repositories cannot be read')
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
            aria-label={t('Azure DevOps repository')} title={t('Azure DevOps repository')}
            data-tip-desc={t('Azure DevOps repository used by this folder (work, PBI, pull requests, release)')}
            style={selectStyle}>
            <option value="">{t('choose a repository…')}</option>
            {groups.map(({ c, refs }) => (
              <optgroup key={c.id} label={`${c.organization} / ${c.project}`}>
                {refs.map(r => <option key={encodeRef(r)} value={encodeRef(r)}>{r.repository}</option>)}
              </optgroup>
            ))}
          </select>
          <button onClick={() => void choose()} disabled={!chosen || saving}
            title={t('use and remember')} data-tip-desc={t('use this repository for the folder and remember it (Settings › Azure DevOps › Repositories by folder)')}
            style={btnStyle(true, !!chosen && !saving)}>
            {saving && <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />}
            {t('use and remember')}
          </button>
        </>
      )}
      {showRetry && (
        <button onClick={retry} disabled={catalogLoading} title={t('retry')} data-tip-desc={t('read the repositories from Azure DevOps again')}
          style={btnStyle(false, !catalogLoading)}>
          {catalogLoading ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <RotateCw size={10} />}
          {t('retry')}
        </button>
      )}
      {showSettings && (
        <button onClick={openConnections}
          title={t('configure in Settings')} data-tip-desc={t('open Settings › Azure DevOps › Connections')}
          style={btnStyle(state.status === 'no-connections' && !compact)}>
          <Settings size={10} /> {t('configure in Settings')}
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
            {t('organization, project and PAT are set once in Settings › Azure DevOps; each folder uses the repository with its own name')}
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
