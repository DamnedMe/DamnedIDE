import { useEffect, useRef, useState, useCallback } from 'react'
import { Send, Bot, User, Loader2, Trash2, ChevronDown, Square, Sparkles, Plus, X, Cpu, AlertCircle } from 'lucide-react'
import {
  useAgentChatStore, useWorktreeStore, useTerminalStore, useClaudeStore, useAiChatStore,
  type AgentSession, type AiChatMessage
} from '../../store'

function formatMeta(r: ClaudeResult): string {
  const u = r.usage
  const bits: string[] = []
  if (u?.inputTokens != null) bits.push(`${u.inputTokens} in`)
  if (u?.outputTokens != null) bits.push(`${u.outputTokens} out`)
  if (u?.cacheReadTokens) bits.push(`${u.cacheReadTokens} da cache`)
  if (r.costUsd) bits.push(`$${r.costUsd.toFixed(4)}`)
  return bits.join(' · ')
}

function shortPath(p: string | null): string {
  if (!p) return 'general'
  return p.split(/[\\/]/).slice(-2).join('/')
}

// Provider toggles: Claude drives its own service (subscription CLI or API),
// the others are headless CLIs. Each session is independent, so several chats
// (even on different providers) can be open and stream concurrently.
export function AiChatPanel() {
  const sessions = useAgentChatStore(s => s.sessions)
  const activeId = useAgentChatStore(s => s.activeId)
  const createSession = useAgentChatStore(s => s.createSession)
  const closeSession = useAgentChatStore(s => s.closeSession)
  const setActive = useAgentChatStore(s => s.setActive)
  const updateSession = useAgentChatStore(s => s.updateSession)

  const worktree = useWorktreeStore(s => s.selectedWorktree)
  const worktreeEntries = useWorktreeStore(s => s.entries)
  const rules = useAiChatStore(s => s.rules)
  const claude = useClaudeStore()

  const [providers, setProviders] = useState<AgentProviderInfo[]>([])
  const [models, setModels] = useState<Record<string, { id: string; label: string }[]>>({})
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [streaming, setStreaming] = useState<Record<string, string>>({})
  const [activity, setActivity] = useState<Record<string, string>>({})
  const [meta, setMeta] = useState<Record<string, string>>({})
  const [auth, setAuth] = useState<ClaudeAuthStatus | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const active = sessions.find(s => s.id === activeId) || null
  const providerInfo = active ? providers.find(p => p.id === active.provider) || null : null
  const activeBusy = active ? !!busy[active.id] : false
  const activeStreaming = active ? (streaming[active.id] || '') : ''
  const messages: AiChatMessage[] = active?.messages || []
  const providerModels = active ? (models[active.provider] || providerInfo?.models || []) : []

  // ─── load providers + availability ──────────────────────────────────────────
  const loadProviders = useCallback(async () => {
    try {
      const list = await window.electronAPI.ai.providers()
      setProviders(list)
      setModels(prev => {
        const next = { ...prev }
        for (const p of list) next[p.id] = prev[p.id] || p.models
        return next
      })
    } catch { /* main not ready */ }
  }, [])

  useEffect(() => {
    loadProviders()
    window.electronAPI.ai.status().then(setAuth).catch(() => setAuth(null))
  }, [loadProviders])

  // dynamic catalog for opencode (its `models` command lists the configured ones)
  useEffect(() => {
    if (!active || active.provider !== 'opencode') return
    window.electronAPI.ai.models('opencode').then(list => {
      if (list.length) setModels(prev => ({ ...prev, opencode: list }))
    }).catch(() => { /* keep static list */ })
  }, [active?.provider])

  // ─── streaming listeners: route chunks by chatKey (session id) ──────────────
  useEffect(() => {
    const offChunk = window.electronAPI.ai.onChunk(p => {
      setStreaming(prev => ({ ...prev, [p.chatKey]: (prev[p.chatKey] || '') + p.text }))
    })
    const offTool = window.electronAPI.ai.onTool(p => {
      setActivity(prev => ({ ...prev, [p.chatKey]: p.name }))
    })
    return () => { offChunk(); offTool() }
  }, [])

  // ─── fill sensible defaults when providers arrive / provider changes ────────
  const defaultsFor = (providerId: AgentProviderId) => {
    const info = providers.find(p => p.id === providerId)
    return {
      model: info?.models[0]?.id || '',
      effort: providerId === 'claude' ? 'high' : '',
      permissionMode: 'default'
    }
  }

  useEffect(() => {
    if (!active || providers.length === 0) return
    const info = providers.find(p => p.id === active.provider)
    if (!info) return
    const knownModels = models[active.provider] || info.models
    if (!active.model && knownModels[0]) updateSession(active.id, { model: knownModels[0].id })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, active?.id, active?.provider])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight })
  }, [messages, activeStreaming, activeId])

  // ─── session lifecycle ──────────────────────────────────────────────────────
  const newSession = () => {
    const d = defaultsFor('claude')
    createSession({
      title: shortPath(worktree),
      provider: 'claude',
      worktree,
      backend: claude.backend,
      ...d
    })
  }

  const changeProvider = (provider: AgentProviderId) => {
    if (!active) return
    const info = providers.find(p => p.id === provider)
    const firstModel = (models[provider] || info?.models || [])[0]?.id || ''
    updateSession(active.id, {
      provider,
      // opencode enumerates its models asynchronously: leave it empty so the
      // defaults effect picks the first one from the real catalog
      model: provider === 'opencode' ? '' : firstModel,
      effort: provider === 'claude' ? 'high' : '',
      permissionMode: 'default'
    })
  }

  // auto-create the first session so the panel is usable immediately
  useEffect(() => {
    if (sessions.length === 0 && providers.length > 0) newSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.length, providers.length])

  const applyRules = (s: AgentSession) =>
    rules
      .map(r => r.replace(/\{worktree\}/g, s.worktree || 'cartella corrente'))
      .filter(Boolean)
      .join('\n')

  const send = async () => {
    const session = useAgentChatStore.getState().sessions.find(s => s.id === useAgentChatStore.getState().activeId)
    if (!session) return
    const text = input.trim()
    if (!text || busy[session.id]) return
    const id = session.id
    const isClaude = session.provider === 'claude'
    const next: AiChatMessage[] = [...session.messages, { role: 'user', text }]
    useAgentChatStore.getState().setMessages(id, next)
    const patch: Partial<AgentSession> = {}
    if (session.title === 'new chat') patch.title = text.slice(0, 32)
    if (Object.keys(patch).length) updateSession(id, patch)
    setInput('')
    setBusy(prev => ({ ...prev, [id]: true }))
    setStreaming(prev => ({ ...prev, [id]: '' }))
    setActivity(prev => ({ ...prev, [id]: '' }))
    setMeta(prev => ({ ...prev, [id]: '' }))

    const rulesText = applyRules(session)
    try {
      const res = await window.electronAPI.ai.send({
        chatKey: id,
        provider: session.provider,
        prompt: isClaude ? text : (rulesText ? `${rulesText}\n\n${text}` : text),
        system: isClaude ? (rulesText || undefined) : undefined,
        cwd: session.worktree || undefined,
        model: session.model || undefined,
        effort: session.effort || undefined,
        permissionMode: session.permissionMode || undefined,
        backend: isClaude ? session.backend : undefined,
        resume: session.sessionId,
        history: (isClaude && session.backend === 'api') ? next.slice(0, -1).map(m => ({ role: m.role, text: m.text })) : undefined
      })
      if (res.ok) {
        if (res.sessionId) updateSession(id, { sessionId: res.sessionId })
        useAgentChatStore.getState().setMessages(id, [...next, { role: 'assistant', text: res.text?.trim() || '(nessuna risposta)' }])
        setMeta(prev => ({ ...prev, [id]: formatMeta(res) }))
      } else {
        useAgentChatStore.getState().setMessages(id, [...next, { role: 'assistant', text: `Errore: ${res.error}` }])
      }
    } catch (e) {
      useAgentChatStore.getState().setMessages(id, [...next, { role: 'assistant', text: `Errore: ${(e as Error).message}` }])
    } finally {
      setBusy(prev => ({ ...prev, [id]: false }))
      setStreaming(prev => ({ ...prev, [id]: '' }))
      setActivity(prev => ({ ...prev, [id]: '' }))
    }
  }

  const selectStyle: React.CSSProperties = {
    background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
    color: 'var(--text-primary)', fontSize: 'calc(9px * var(--ui-text-scale, 1))',
    fontFamily: 'var(--font-mono)', padding: '2px 6px', cursor: 'pointer', outline: 'none'
  }

  const miniSelect = (label: string, value: string, options: [string, string][], onChange: (v: string) => void) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'calc(8px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...selectStyle, maxWidth: '160px' }}>
        {value && !options.some(o => o[0] === value) && <option value={value}>{value}</option>}
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )

  const claudeAuthTip = !auth?.cli
    ? (auth?.hasApiKey ? 'API key Anthropic configurata' : "CLI 'claude' non trovata nel PATH")
    : auth.loggedIn
      ? `subscription ${auth.subscriptionType || ''} — ${auth.email || auth.authMethod || ''}`.trim()
      : "non autenticato: esegui 'claude auth login' in un terminale"

  const canSend = !!input.trim() && !activeBusy && !!active && !!providerInfo?.available

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-card)' }}>
      {/* session tabs */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '2px', padding: '3px 6px',
        borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, overflowX: 'auto'
      }}>
        <Bot size={12} style={{ color: 'var(--accent-color)', flexShrink: 0, marginRight: '2px' }} />
        {sessions.map(s => {
          const isActiveTab = s.id === activeId
          const isBusy = !!busy[s.id]
          return (
            <div key={s.id} onClick={() => setActive(s.id)}
              title={s.worktree || 'general'} data-tip-desc="switch to this conversation"
              style={{
                display: 'flex', alignItems: 'center', gap: '5px', padding: '2px 6px', flexShrink: 0,
                borderRadius: 'var(--radius-sm)', cursor: 'pointer', maxWidth: '190px',
                background: isActiveTab ? 'var(--bg-active)' : 'transparent',
                border: `1px solid ${isActiveTab ? 'var(--accent-color)' : 'var(--border-subtle)'}`,
                fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
                color: isActiveTab ? 'var(--accent-color)' : 'var(--text-secondary)'
              }}>
              {isBusy ? <Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} /> : <Cpu size={9} />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
              <button onClick={(e) => { e.stopPropagation(); closeSession(s.id) }} title="close chat" data-tip-desc="close this conversation"
                style={{ display: 'flex', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}>
                <X size={9} />
              </button>
            </div>
          )
        })}
        <button onClick={newSession} title="new chat" data-tip-desc="open a new independent conversation"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '18px',
            background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
            color: 'var(--accent-color)', cursor: 'pointer', flexShrink: 0
          }}>
          <Plus size={11} />
        </button>
      </div>

      {/* controls for the active session */}
      {active && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, flexWrap: 'wrap' }}>
          <select value={active.provider} onChange={(e) => changeProvider(e.target.value as AgentProviderId)}
            title="provider" data-tip-desc="choose the agent that answers this conversation"
            style={{ ...selectStyle, maxWidth: '160px' }}>
            {providers.map(p => (
              <option key={p.id} value={p.id}>{p.label}{p.available ? '' : ' — non disponibile'}</option>
            ))}
          </select>

          <select value={active.worktree || ''} onChange={(e) => updateSession(active.id, { worktree: e.target.value || null })}
            title="worktree" data-tip-desc="the worktree this conversation works on"
            style={{ ...selectStyle, maxWidth: '170px' }}>
            <option value="">general</option>
            {worktreeEntries.map(w => (
              <option key={w.path} value={w.path}>{w.branch || shortPath(w.path)}</option>
            ))}
          </select>

          {providerInfo && !providerInfo.available && (
            <span title={providerInfo.detail} data-tip-desc={providerInfo.detail}
              style={{ display: 'flex', alignItems: 'center', gap: '3px', color: 'var(--error-color)', fontSize: 'calc(8px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)' }}>
              <AlertCircle size={10} /> {providerInfo.detail}
            </span>
          )}

          {active.provider === 'claude' && (
            <>
              <span title={claudeAuthTip} data-tip-desc={claudeAuthTip}
                style={{ width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, background: (active.backend === 'api' ? auth?.hasApiKey : auth?.loggedIn) ? 'var(--success-color)' : 'var(--error-color)' }} />
              {miniSelect('auth', active.backend, [['subscription', 'subscription'], ['api', 'API']], (v) => updateSession(active.id, { backend: v as ClaudeBackend }))}
            </>
          )}

          {providerModels.length > 0
            ? miniSelect('model', active.model, providerModels.map(m => [m.id, m.label]), (v) => updateSession(active.id, { model: v }))
            : (
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'calc(8px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                model
                <input value={active.model} onChange={(e) => updateSession(active.id, { model: e.target.value })} spellCheck={false}
                  style={{ ...selectStyle, width: '130px', cursor: 'text' }} />
              </label>
            )}

          {providerInfo && providerInfo.efforts.length > 0 &&
            miniSelect('effort', active.effort, providerInfo.efforts.map(e => [e, e]), (v) => updateSession(active.id, { effort: v }))}

          {providerInfo && providerInfo.permissionModes.length > 0 &&
            miniSelect('perm', active.permissionMode, providerInfo.permissionModes.map(p => [p, p]), (v) => updateSession(active.id, { permissionMode: v }))}

          <button onClick={() => { useAgentChatStore.getState().clearMessages(active.id); setMeta(prev => ({ ...prev, [active.id]: '' })) }}
            title="clear this conversation" data-tip-desc="delete all messages of this conversation"
            style={{ display: 'flex', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px', marginLeft: 'auto' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
            <Trash2 size={11} />
          </button>
          <button onClick={() => useTerminalStore.getState().setOpen(false)} title="minimize"
            data-tip-desc="minimize the panel back to the status bar icon"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '20px', height: '18px', background: 'none', border: 'none',
              color: 'var(--text-muted)', cursor: 'pointer', borderRadius: 'var(--radius-sm)'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
            <ChevronDown size={12} />
          </button>
        </div>
      )}

      {/* messages */}
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {active && messages.length === 0 && (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)' }}>
            {active.provider === 'claude'
              ? <>Claude {active.backend === 'api' ? 'via API Anthropic' : 'con la tua subscription'} — {active.model || 'modello predefinito'}{active.effort ? ` / ${active.effort}` : ''}.<br />{claudeAuthTip}<br /></>
              : <>{providerInfo?.label || active.provider} — {providerInfo?.detail || 'in attesa'}.<br />Provider CLI in modalità headless, con i suoi strumenti sul worktree.<br /></>}
            {active.worktree ? `Conversazione su ${shortPath(active.worktree)}.` : 'Nessun worktree: conversazione generica.'}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            display: 'flex', gap: '6px', alignItems: 'flex-start',
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%'
          }}>
            <span style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '18px', height: '18px', borderRadius: '50%', flexShrink: 0,
              background: m.role === 'user' ? 'var(--accent-bg)' : 'var(--bg-tag)',
              color: m.role === 'user' ? 'var(--accent-color)' : 'var(--text-secondary)'
            }}>
              {m.role === 'user' ? <User size={10} /> : <Bot size={10} />}
            </span>
            <div style={{
              padding: '6px 10px', borderRadius: 'var(--radius-md)',
              background: m.role === 'user' ? 'var(--accent-bg)' : 'var(--bg-subtle)',
              border: `1px solid ${m.role === 'user' ? 'var(--accent-color)' : 'var(--border-color)'}`,
              color: 'var(--text-primary)', fontSize: 'calc(10px * var(--ui-text-scale, 1))',
              fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5
            }}>
              {m.text}
            </div>
          </div>
        ))}
        {activeStreaming && (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', alignSelf: 'flex-start', maxWidth: '88%' }}>
            <span style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', width: '18px', height: '18px',
              borderRadius: '50%', flexShrink: 0, background: 'var(--bg-tag)', color: 'var(--text-secondary)'
            }}>
              <Sparkles size={10} />
            </span>
            <div style={{
              padding: '6px 10px', borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)',
              border: '1px solid var(--border-color)', color: 'var(--text-primary)',
              fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5
            }}>
              {activeStreaming}
            </div>
          </div>
        )}
        {active && activeBusy && !activeStreaming && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)' }}>
            <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
            {activity[active.id] ? `${activity[active.id]}…` : 'lavorando...'}
          </div>
        )}
        {active && !activeBusy && meta[active.id] && (
          <div style={{ alignSelf: 'flex-start', color: 'var(--text-muted)', fontSize: 'calc(8px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)' }}>
            {meta[active.id]}
          </div>
        )}
      </div>

      {/* input */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', borderTop: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder={providerInfo?.available ? `scrivi un messaggio a ${providerInfo.label}…` : 'seleziona un provider disponibile nelle impostazioni'}
          disabled={!providerInfo?.available || activeBusy}
          spellCheck={false}
          style={{
            flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
            color: 'var(--text-primary)', fontSize: 'calc(10px * var(--ui-text-scale, 1))',
            fontFamily: 'var(--font-mono)', padding: '4px 8px', outline: 'none'
          }}
        />
        {activeBusy ? (
          <button onClick={() => active && window.electronAPI.ai.cancel(active.id)}
            title="stop" data-tip-desc="interrompe il turno in corso"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', width: '26px', height: '24px',
              background: 'var(--error-bg)', border: '1px solid var(--error-color)', borderRadius: 'var(--radius-sm)',
              color: 'var(--error-color)', cursor: 'pointer'
            }}>
            <Square size={10} />
          </button>
        ) : (
          <button onClick={send} disabled={!canSend}
            title="send to the agent" data-tip-desc="send the message to the agent"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', width: '26px', height: '24px',
              background: canSend ? 'var(--accent-color)' : 'var(--bg-disabled)',
              border: 'none', borderRadius: 'var(--radius-sm)',
              color: canSend ? 'var(--text-inverse)' : 'var(--text-muted)',
              cursor: canSend ? 'pointer' : 'not-allowed'
            }}>
            <Send size={11} />
          </button>
        )}
      </div>
    </div>
  )
}
