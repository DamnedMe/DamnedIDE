import { useEffect, useRef, useState } from 'react'
import { Bot, Plus, Trash2, Loader2, Check, AlertCircle, RefreshCw, ExternalLink, TerminalSquare } from 'lucide-react'
import { Modal } from '../layout/Modal'
import { useAgentConfigStore, useClaudeStore, useToastStore, useTerminalStore, ALL_AGENT_PROVIDERS } from '../../store'
import { ClaudeSettings } from '../mcp/ClaudeSettings'
import { useI18n } from '../../i18n'

// AI agents are CLI tools with their own subscription/login: this panel is where
// they are added, signed in (the login runs in the IDE terminal) and removed.
export function AgentSettings() {
  const t = useI18n()
  const { configured, addAgent, removeAgent, setModel, models: agentModels } = useAgentConfigStore()
  const [providers, setProviders] = useState<AgentProviderInfo[]>([])
  const [models, setModels] = useState<Record<string, { id: string; label: string }[]>>({})
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, { ok: boolean; msg: string }>>({})
  const [removeTarget, setRemoveTarget] = useState<AgentProviderId | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  // bumped on every load so the provider cards (Claude has its own state) re-read
  const [refreshTick, setRefreshTick] = useState(0)
  const pollRef = useRef<number | null>(null)
  const showToast = useToastStore(s => s.showToast)

  const load = async (refresh = false): Promise<AgentProviderInfo[]> => {
    setLoading(true)
    try {
      const list = await window.electronAPI.ai.providers(refresh)
      setProviders(list)
      setRefreshTick(t => t + 1)
      return list
    } catch {
      showToast('impossibile leggere lo stato degli agenti', 'error')
      return []
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(false)
    return () => { if (pollRef.current) window.clearInterval(pollRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // After a login command is launched the credentials appear when the user
  // finishes in the terminal: poll until a configured agent is authenticated
  // (or ~40s), so the card updates by itself.
  const startLoginWatch = () => {
    if (pollRef.current) window.clearInterval(pollRef.current)
    let attempts = 0
    const stop = () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
      pollRef.current = null
    }
    pollRef.current = window.setInterval(async () => {
      attempts++
      const list = await load(true)
      if (list.some(p => configured.includes(p.id) && p.loggedIn === true) || attempts >= 10) stop()
    }, 4000)
  }

  const info = (id: AgentProviderId): AgentProviderInfo | undefined => providers.find(p => p.id === id)
  const label = (id: AgentProviderId): string => info(id)?.label || id
  // catalog per provider: opencode enumerates the models it is actually configured for
  const providerModels = (id: AgentProviderId): { id: string; label: string }[] => models[id] || info(id)?.models || []
  const selectedModel = (id: AgentProviderId): string => agentModels[id] || providerModels(id)[0]?.id || ''

  useEffect(() => {
    window.electronAPI.ai.models('opencode')
      .then(list => { if (list.length) setModels(prev => ({ ...prev, opencode: list })) })
      .catch(() => { /* keep the static list */ })
  }, [])

  const signIn = (p: AgentProviderInfo) => {
    if (!p.loginCommand) return
    // the provider CLI runs its own OAuth/TUI: give it the IDE terminal
    useTerminalStore.getState().runCommand(p.loginCommand)
    showToast(`completa l'accesso a ${p.label} nel terminale`, 'info')
    startLoginWatch()
  }

  const test = async (p: AgentProviderInfo) => {
    setTesting(p.id)
    try {
      const res = await window.electronAPI.ai.test(
        p.id,
        p.id === 'claude' ? useClaudeStore.getState().backend : undefined,
        p.id === 'claude' ? undefined : selectedModel(p.id)
      )
      setResults(prev => ({
        ...prev,
        [p.id]: res.ok
          ? { ok: true, msg: (res.text || '').trim().slice(0, 160) || 'connessione verificata' }
          : { ok: false, msg: res.error || 'verifica fallita' }
      }))
      await load(true)
    } catch (e) {
      setResults(prev => ({ ...prev, [p.id]: { ok: false, msg: (e as Error).message } }))
    } finally {
      setTesting(null)
    }
  }

  const confirmRemove = async () => {
    if (!removeTarget) return
    // the IDE-stored Anthropic key is ours to clean up; CLI logins stay on the system
    if (removeTarget === 'claude') await window.electronAPI.ai.setApiKey(null).catch(() => {})
    removeAgent(removeTarget)
    setRemoveTarget(null)
    showToast('agente rimosso dalla configurazione')
  }

  const availableToAdd = ALL_AGENT_PROVIDERS.filter(id => !configured.includes(id))

  const renderAgent = (id: AgentProviderId) => {
    if (id === 'claude') {
      return (
        <ClaudeSettings
          key={id}
          onRemove={() => setRemoveTarget('claude')}
          refreshSignal={refreshTick}
          onLoginStarted={startLoginWatch}
        />
      )
    }

    const p = info(id)
    const ready = !!p?.available && p?.loggedIn !== false
    const statusColor = p?.available ? (p.loggedIn === false ? 'var(--warning-color)' : 'var(--success-color)') : 'var(--text-disabled)'
    const result = results[id]
    return (
      <div key={id} style={{
        border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
        background: 'var(--bg-card)', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Bot size={13} style={{ color: ready ? 'var(--accent-color)' : 'var(--text-muted)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontWeight: 600, color: 'var(--text-primary)' }}>
              {p?.label || id}
            </div>
            <div style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: statusColor, fontFamily: 'var(--font-mono)' }}>
              {p ? p.detail : 'stato non disponibile'}
            </div>
          </div>
          <button onClick={() => setRemoveTarget(id)} title="rimuovi agente" data-tip-desc="remove this agent from the IDE configuration"
            style={{ display: 'flex', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
            <Trash2 size={12} />
          </button>
        </div>

        {p && !p.available && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--warning-color)', fontFamily: 'var(--font-mono)' }}>
            <AlertCircle size={11} />
            CLI non trovata. {p.installHint && <>installa con <span style={{ color: 'var(--text-secondary)' }}>{p.installHint}</span></>}
            {p.docsUrl && (
              <button onClick={() => window.electronAPI.shell.openExternal(p.docsUrl!)}
                style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'none', border: 'none', color: 'var(--accent-color)', cursor: 'pointer', fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', padding: 0 }}>
                <ExternalLink size={10} /> docs
              </button>
            )}
          </div>
        )}

        {p?.available && p.loggedIn === false && (
          <div style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--warning-color)', fontFamily: 'var(--font-mono)' }}>
            non configurato: accedi con {p.loginCommand}
          </div>
        )}

        {p && providerModels(id).length > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            modello
            <select
              value={selectedModel(id)}
              onChange={(e) => setModel(id, e.target.value)}
              title="modello usato per la verifica e per le nuove chat" data-tip-desc="model used by 'verifica' and by new chats with this agent"
              style={{
                flex: 1, minWidth: 0, background: 'var(--bg-input)', border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)', fontSize: 'calc(9px * var(--ui-text-scale, 1))', padding: '2px 6px', outline: 'none'
              }}>
              {providerModels(id).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <button onClick={() => signIn(p!)} disabled={!p?.available}
            title={p?.loginCommand} data-tip-desc="apre il terminale con il comando di login del provider"
            style={actionBtn(!!p?.available, 'var(--accent-color)')}>
            <TerminalSquare size={11} /> accedi
          </button>
          <button onClick={() => test(p!)} disabled={!p?.available || testing === id}
            title="prova un turno reale" data-tip-desc="manda un prompt minimo all'agente e riporta l'esito"
            style={actionBtn(!!p?.available && testing !== id, 'var(--text-secondary)')}>
            {testing === id ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={11} />}
            verifica
          </button>
        </div>

        {result && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '5px', fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: result.ok ? 'var(--success-color)' : 'var(--error-color)' }}>
            {result.ok ? <Check size={11} style={{ flexShrink: 0, marginTop: 1 }} /> : <AlertCircle size={11} style={{ flexShrink: 0, marginTop: 1 }} />}
            <span style={{ wordBreak: 'break-word' }}>{result.msg}</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '8px', overflow: 'auto', padding: '4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)' }}>
          <Bot size={13} style={{ color: 'var(--accent-color)' }} />
          {t('AI agents')}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={() => load(true)} disabled={loading} title="aggiorna lo stato" data-tip-desc="ricontrolla CLI e credenziali dei provider"
            style={actionBtn(!loading, 'var(--text-secondary)')}>
            <RefreshCw size={11} style={loading ? { animation: 'spin 1s linear infinite' } : undefined} />
            aggiorna
          </button>
          <button onClick={() => setShowAdd(true)} disabled={availableToAdd.length === 0}
            title="aggiungi agente" data-tip-desc="scegli un altro provider da configurare"
            style={actionBtn(availableToAdd.length > 0, 'var(--accent-color)')}>
            <Plus size={11} /> aggiungi agente
          </button>
        </div>
      </div>

      <div style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>
        ogni agente usa la CLI e l'abbonamento (o la API key) del provider: "accedi" apre il terminale con il comando di login,
        "verifica" manda un turno reale per controllare che risponda. Gli agenti configurati compaiono nella chat AI.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {configured.length === 0 && (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)' }}>
            nessun agente configurato — usa "aggiungi agente"
          </div>
        )}
        {configured.map(renderAgent)}
      </div>

      {showAdd && (
        <Modal onClose={() => setShowAdd(false)} width={460} label="add agent">
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ fontSize: 'calc(13px * var(--ui-text-scale, 1))', fontWeight: 700, color: 'var(--text-primary)' }}>
              aggiungi agente
            </div>
            <div style={{ fontSize: 'calc(10px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>
              scegli il provider: potrai accedere con la sua CLI o inserire la API key.
            </div>
            {availableToAdd.map(id => {
              const p = info(id)
              const ok = !!p?.available
              return (
                <button key={id} onClick={() => { addAgent(id); setShowAdd(false); showToast(`${p?.label || id} aggiunto`) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px', textAlign: 'left',
                    padding: '10px 12px', background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)', cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent-color)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)' }}>
                  <Bot size={13} style={{ color: ok ? 'var(--accent-color)' : 'var(--text-muted)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {p?.label || id} {id === 'claude' && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· anche Claude Code</span>}
                    </div>
                    <div style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: ok ? 'var(--text-muted)' : 'var(--warning-color)', fontFamily: 'var(--font-mono)' }}>
                      {p ? p.detail : 'CLI non trovata'}
                    </div>
                  </div>
                  <Plus size={12} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />
                </button>
              )
            })}
          </div>
        </Modal>
      )}

      {removeTarget && (
        <Modal onClose={() => setRemoveTarget(null)} width={440} label="remove agent">
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Trash2 size={15} style={{ color: 'var(--error-color)', flexShrink: 0 }} />
              <span style={{ fontSize: 'calc(13px * var(--ui-text-scale, 1))', fontWeight: 700, color: 'var(--text-primary)' }}>
                rimuovi {label(removeTarget)}
              </span>
            </div>
            <div style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              l'agente non comparirà più nella chat AI.{removeTarget === 'claude' ? ' Verrà rimossa anche la API key Anthropic salvata nell\'IDE, se presente.' : ''}
              {' '}Le credenziali restano sul sistema e sono gestite dalla CLI del provider: potrai riaggiungerlo quando vuoi.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setRemoveTarget(null)} style={actionBtn(true, 'var(--text-secondary)')}>annulla</button>
              <button onClick={confirmRemove}
                style={{ ...actionBtn(true, 'var(--error-color)'), background: 'var(--error-color)', color: 'var(--text-inverse)', border: 'none' }}>
                <Trash2 size={11} /> rimuovi
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function actionBtn(enabled: boolean, color: string): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 10px', height: '24px',
    background: 'var(--bg-card)', border: `1px solid ${enabled ? 'var(--border-color)' : 'var(--border-subtle)'}`,
    borderRadius: 'var(--radius-sm)', color: enabled ? color : 'var(--text-disabled)',
    cursor: enabled ? 'pointer' : 'not-allowed',
    fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
  }
}
