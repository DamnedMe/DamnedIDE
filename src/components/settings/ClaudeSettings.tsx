import { useEffect, useState } from 'react'
import { Sparkles, RefreshCw, Check, X, Loader2, Plug, Trash2, TerminalSquare } from '@/components/icons'
import { useClaudeStore, useTerminalStore, CLAUDE_MODELS, CLAUDE_EFFORTS, CLAUDE_PERMISSION_MODES } from '../../store'
import { useI18n, tr } from '../../i18n'

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
export function ClaudeSettings({ onRemove, refreshSignal = 0, onLoginStarted }: {
  onRemove?: () => void
  // bumped by the parent ("aggiorna" / login watch) to re-read the auth state
  refreshSignal?: number
  onLoginStarted?: () => void
} = {}) {
  const t = useI18n()
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

  useEffect(refresh, [refreshSignal])

  // presence of credentials ≠ working credentials: `claude auth status` and an
  // MCP tools/list both succeed on an expired token. One cheap real turn is the
  // only thing that actually proves the connection.
  const runTest = async () => {
    setTesting(true)
    setVerdict(null)
    try {
      const res = await window.electronAPI.ai.test(claude.backend)
      setVerdict(res.ok
        ? { ok: true, msg: `${tr('connection verified — reply received')}${res.costUsd ? ` ($${res.costUsd.toFixed(4)})` : ''}` }
        : { ok: false, msg: res.error || tr('failed without a message') })
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
      setSaved(key.trim() ? tr('API key saved (encrypted by the system)') : tr('API key removed'))
      refresh()
    } catch (e) {
      setSaved(tr('Error: {message}', { message: (e as Error).message }))
    }
  }

  // credentials present — NOT proof they still work, hence the separate test
  const present = claude.backend === 'api' ? !!auth?.hasApiKey : !!auth?.loggedIn
  const ok = verdict ? verdict.ok : present
  const statusText = verdict ? verdict.msg
    : claude.backend === 'api'
      ? (auth?.hasApiKey ? t('API key configured — not verified yet') : t('no API key'))
      : !auth?.cli ? t("'claude' CLI not found in PATH")
        : auth.loggedIn ? t('{account} · {who} — not verified yet', { account: auth.subscriptionType || 'account', who: auth.email || auth.authMethod || '' }).trim()
          : t("not signed in — run 'claude auth login' in a terminal")

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
            Claude <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {t('also Claude Code')}</span>
          </div>
          <div style={{
            fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
            color: verdict ? (verdict.ok ? 'var(--success-color)' : 'var(--error-color)') : 'var(--text-muted)'
          }}>
            {statusText}
          </div>
        </div>
        <button onClick={() => { useTerminalStore.getState().runCommand('claude auth login'); onLoginStarted?.() }}
          title={t('sign in with the claude CLI')} data-tip-desc={t("open the terminal on 'claude auth login' (subscription) and open the browser")}
          style={{
            display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 10px', height: '22px',
            background: 'var(--accent-color)', border: 'none', borderRadius: 'var(--radius-sm)',
            color: 'var(--text-inverse)', cursor: 'pointer',
            fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
          }}>
          <TerminalSquare size={10} />
          {t('sign in')}
        </button>
        <button onClick={runTest} disabled={testing} title={t('test the connection with a real turn')}
          data-tip-desc={t('credentials present does not mean working: send a minimal prompt on haiku and report the result')}
          style={{
            display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 10px', height: '22px',
            background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
            color: 'var(--text-secondary)', cursor: testing ? 'wait' : 'pointer',
            fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
          }}>
          {testing ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Plug size={10} />}
          {t('verify')}
        </button>
        <button onClick={refresh} disabled={checking} title={t('recheck the stored credentials')}
          data-tip-desc={t('re-read the CLI login state and whether the API key is present (does not test the connection)')}
          style={{ display: 'flex', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}>
          <RefreshCw size={12} style={checking ? { animation: 'spin 1s linear infinite' } : undefined} />
        </button>
        {onRemove && (
          <button onClick={onRemove} title={t('remove agent')} data-tip-desc={t('remove this agent from the IDE configuration')}
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
            title={b === 'subscription' ? t('use the claude CLI and your subscription') : t('use the Anthropic API with a key')}
            data-tip-desc={b === 'subscription'
              ? t('no key to manage, access to the Claude Code tools on the worktree')
              : t('direct chat with the API, billed per use on your key')}
            style={{
              flex: 1, padding: '4px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600,
              background: claude.backend === b ? 'var(--accent-color)' : 'var(--bg-card)',
              border: `1px solid ${claude.backend === b ? 'var(--accent-color)' : 'var(--border-color)'}`,
              color: claude.backend === b ? 'var(--text-inverse)' : 'var(--text-secondary)'
            }}>
            {b === 'subscription' ? t('subscription') : 'API key'}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <label style={label}>
          {t('model')}
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
          <label style={label} title={t("in headless mode no prompt is interactive: with 'default' Claude cannot edit files")}
            data-tip-desc={t('use acceptEdits if you want Claude to really apply the changes on the worktree')}>
            {t('permissions')}
            <select value={claude.permissionMode} onChange={(e) => claude.setConfig({ permissionMode: e.target.value })} style={{ ...control, cursor: 'pointer' }}>
              {CLAUDE_PERMISSION_MODES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        )}
      </div>

      {claude.backend === 'api' && (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} spellCheck={false}
            placeholder={auth?.hasApiKey ? t('key saved — paste to replace it, empty to remove it') : 'sk-ant-…'}
            style={{ ...control, flex: 1 }} />
          <button onClick={saveKey} style={{
            display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 10px', height: '24px',
            background: 'var(--accent-color)', border: 'none', borderRadius: 'var(--radius-sm)',
            color: 'var(--text-inverse)', cursor: 'pointer',
            fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
          }}>
            {auth?.hasApiKey ? <Check size={10} /> : <X size={10} />}
            {t('save')}
          </button>
        </div>
      )}

      <div style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>
        {saved || (claude.backend === 'subscription'
          ? t('uses the `claude auth login` session: no key to manage and the conversation stays on the CLI side, so each turn sends only the new message.')
          : t('the key is encrypted by the system keystore and never leaves the main process. The conversation prefix travels in the cache: later turns cost ~90% less.'))}
      </div>
    </div>
  )
}
