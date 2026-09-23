import { useEffect, useState } from 'react'
import { Sparkles, RefreshCw, Check, X, Loader2, Plug, Trash2, TerminalSquare } from 'lucide-react'
import { useClaudeStore, useTerminalStore, CLAUDE_MODELS, CLAUDE_EFFORTS, CLAUDE_PERMISSION_MODES } from '../../store'

const label: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '4px',
  fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)'
}

const control: React.CSSProperties = {
  background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)', fontSize: 'calc(10px * var(--ui-text-scale, 1))',
  fontFamily: 'var(--font-mono)', padding: '3px 8px', outline: 'none'
}

// Claude is not an MCP server: it is the IDE's own AI provider, either through
// the `claude` CLI (existing subscription login, no key to manage) or through
// the Anthropic API with a key stored encrypted by the OS keystore.
export function ClaudeSettings({ onRemove }: { onRemove?: () => void } = {}) {
  const claude = useClaudeStore()
  const [auth, setAuth] = useState<ClaudeAuthStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [key, setKey] = useState('')
  const [saved, setSaved] = useState('')
  const [testing, setTesting] = useState(false)
  const [verdict, setVerdict] = useState<{ ok: boolean; msg: string } | null>(null)

  const refresh = () => {
    setChecking(true)
    setVerdict(null)
    window.electronAPI.ai.status().then(setAuth).catch(() => setAuth(null)).finally(() => setChecking(false))
  }

  useEffect(refresh, [])

  // presence of credentials ≠ working credentials: `claude auth status` and an
  // MCP tools/list both succeed on an expired token. One cheap real turn is the
  // only thing that actually proves the connection.
  const runTest = async () => {
    setTesting(true)
    setVerdict(null)
    try {
      const res = await window.electronAPI.ai.test(claude.backend)
      setVerdict(res.ok
        ? { ok: true, msg: `connessione verificata — risposta ricevuta${res.costUsd ? ` ($${res.costUsd.toFixed(4)})` : ''}` }
        : { ok: false, msg: res.error || 'fallita senza messaggio' })
    } catch (e) {
      setVerdict({ ok: false, msg: (e as Error).message })
    } finally {
      setTesting(false)
    }
  }

  const saveKey = async () => {
    try {
      await window.electronAPI.ai.setApiKey(key.trim() || null)
      setKey('')
      setSaved(key.trim() ? 'API key salvata (cifrata dal sistema)' : 'API key rimossa')
      refresh()
    } catch (e) {
      setSaved(`Errore: ${(e as Error).message}`)
    }
  }

  // credentials present — NOT proof they still work, hence the separate test
  const present = claude.backend === 'api' ? !!auth?.hasApiKey : !!auth?.loggedIn
  const ok = verdict ? verdict.ok : present
  const statusText = verdict ? verdict.msg
    : claude.backend === 'api'
      ? (auth?.hasApiKey ? 'API key configurata — non ancora verificata' : 'nessuna API key')
      : !auth?.cli ? "CLI 'claude' non trovata nel PATH"
        : auth.loggedIn ? `${auth.subscriptionType || 'account'} · ${auth.email || auth.authMethod || ''} — non ancora verificato`.trim()
          : "non autenticato — esegui 'claude auth login' in un terminale"

  return (
    <div style={{
      border: `1px solid ${ok ? 'var(--success-color)' : 'var(--border-color)'}`,
      borderRadius: 'var(--radius-md)', background: 'var(--bg-card)', padding: '10px',
      display: 'flex', flexDirection: 'column', gap: '8px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Sparkles size={13} style={{ color: 'var(--accent-color)' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontWeight: 600, color: 'var(--text-primary)' }}>
            Claude <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· anche Claude Code</span>
          </div>
          <div style={{
            fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
            color: verdict ? (verdict.ok ? 'var(--success-color)' : 'var(--error-color)') : 'var(--text-muted)'
          }}>
            {statusText}
          </div>
        </div>
        <button onClick={() => useTerminalStore.getState().runCommand('claude auth login')}
          title="accedi con la CLI claude" data-tip-desc="apre il terminale su 'claude auth login' (subscription) e apre il browser"
          style={{
            display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 10px', height: '22px',
            background: 'var(--accent-color)', border: 'none', borderRadius: 'var(--radius-sm)',
            color: 'var(--text-inverse)', cursor: 'pointer',
            fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
          }}>
          <TerminalSquare size={10} />
          accedi
        </button>
        <button onClick={runTest} disabled={testing} title="prova la connessione con un turno reale"
          data-tip-desc="credenziali presenti non vuol dire funzionanti: manda un prompt minimo su haiku e riporta l'esito"
          style={{
            display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 10px', height: '22px',
            background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
            color: 'var(--text-secondary)', cursor: testing ? 'wait' : 'pointer',
            fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
          }}>
          {testing ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Plug size={10} />}
          verifica
        </button>
        <button onClick={refresh} disabled={checking} title="ricontrolla le credenziali presenti"
          data-tip-desc="rilegge lo stato di login della CLI e la presenza della API key (non prova la connessione)"
          style={{ display: 'flex', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}>
          <RefreshCw size={12} style={checking ? { animation: 'spin 1s linear infinite' } : undefined} />
        </button>
        {onRemove && (
          <button onClick={onRemove} title="rimuovi agente" data-tip-desc="remove this agent from the IDE configuration"
            style={{ display: 'flex', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
            <Trash2 size={12} />
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '6px' }}>
        {(['subscription', 'api'] as ClaudeBackend[]).map(b => (
          <button key={b} onClick={() => claude.setConfig({ backend: b })}
            title={b === 'subscription' ? 'usa la CLI claude e il tuo abbonamento' : 'usa le API Anthropic con una key'}
            data-tip-desc={b === 'subscription'
              ? 'nessuna key da gestire, accesso agli strumenti di Claude Code sul worktree'
              : 'chat diretta con le API, fatturata a consumo sulla tua key'}
            style={{
              flex: 1, padding: '4px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600,
              background: claude.backend === b ? 'var(--accent-color)' : 'var(--bg-card)',
              border: `1px solid ${claude.backend === b ? 'var(--accent-color)' : 'var(--border-color)'}`,
              color: claude.backend === b ? 'var(--text-inverse)' : 'var(--text-secondary)'
            }}>
            {b === 'subscription' ? 'subscription' : 'API key'}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <label style={label}>
          modello
          <select value={claude.model} onChange={(e) => claude.setConfig({ model: e.target.value })} style={{ ...control, cursor: 'pointer' }}>
            {CLAUDE_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <label style={label}>
          effort
          <select value={claude.effort} onChange={(e) => claude.setConfig({ effort: e.target.value as ClaudeEffort })} style={{ ...control, cursor: 'pointer' }}>
            {CLAUDE_EFFORTS.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </label>
        {claude.backend === 'subscription' && (
          <label style={label} title="in modalità headless nessun prompt è interattivo: con 'default' Claude non può modificare file"
            data-tip-desc="usa acceptEdits se vuoi che Claude applichi davvero le modifiche sul worktree">
            permessi
            <select value={claude.permissionMode} onChange={(e) => claude.setConfig({ permissionMode: e.target.value })} style={{ ...control, cursor: 'pointer' }}>
              {CLAUDE_PERMISSION_MODES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        )}
      </div>

      {claude.backend === 'api' && (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} spellCheck={false}
            placeholder={auth?.hasApiKey ? 'key salvata — incolla per sostituirla, vuoto per rimuoverla' : 'sk-ant-…'}
            style={{ ...control, flex: 1 }} />
          <button onClick={saveKey} style={{
            display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 10px', height: '24px',
            background: 'var(--accent-color)', border: 'none', borderRadius: 'var(--radius-sm)',
            color: 'var(--text-inverse)', cursor: 'pointer',
            fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
          }}>
            {auth?.hasApiKey ? <Check size={10} /> : <X size={10} />}
            salva
          </button>
        </div>
      )}

      <div style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>
        {saved || (claude.backend === 'subscription'
          ? 'usa la sessione di `claude auth login`: nessuna key da gestire e la conversazione resta lato CLI, così ogni turno invia solo il nuovo messaggio.'
          : 'la key è cifrata dal keystore di sistema e non lascia mai il processo principale. Il prefisso della conversazione viaggia in cache: i turni successivi costano ~90% in meno.')}
      </div>
    </div>
  )
}
