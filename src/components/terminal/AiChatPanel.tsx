import { useEffect, useRef, useState } from 'react'
import { Send, Bot, User, Loader2, Trash2, ChevronDown } from 'lucide-react'
import { useMcpStore, MCP_PRESETS, useAiChatStore, useWorktreeStore, useTerminalStore, type AiChatMessage } from '../../store'
import { discoverChatOptions, buildChatArgs, type ChatOptions, type ChatOptionField } from '../../utils/mcp-chat'

const CHAT_TOOL_RE = /agent|chat|message|prompt|session|conversation/i

function findChatTool(tools: McpTool[]): McpTool | null {
  return tools.find(t => CHAT_TOOL_RE.test(t.name)) || null
}

export function AiChatPanel() {
  const { connected, tools, chatSel, setChatSel } = useMcpStore()
  const rules = useAiChatStore(s => s.rules)
  const chats = useAiChatStore(s => s.chats)
  const setMessages = useAiChatStore(s => s.setMessages)
  const clearChat = useAiChatStore(s => s.clearChat)
  // each worktree has its own dedicated conversation with the agent
  const worktree = useWorktreeStore(s => s.selectedWorktree)
  const chatKey = worktree || '__default__'

  const [server, setServer] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [chatOpts, setChatOpts] = useState<ChatOptions | null>(null)
  const [sel, setSel] = useState({ mode: '', model: '', effort: '' })
  const scrollRef = useRef<HTMLDivElement>(null)

  const messages = chats[chatKey] || []

  const connectedServers = (Object.entries(connected) as [string, boolean][])
    .filter(([, v]) => v)
    .map(([name]) => name)

  useEffect(() => {
    if (!server && connectedServers.length > 0) setServer(connectedServers[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (server && !connected[server]) setServer(null)
  }, [connected, server])

  useEffect(() => {
    if (!server) { setChatOpts(null); return }
    const tool = findChatTool(tools[server] || [])
    const opts = discoverChatOptions(tool, server)
    setChatOpts(opts)
    const prev = chatSel[server] || {}
    const restore = (field: ChatOptionField, saved: string | undefined): string => {
      if (!field.path) return ''
      if (field.values.length > 0) return saved && field.values.includes(saved) ? saved : (field.values[0] || '')
      return saved || ''
    }
    setSel({
      mode: restore(opts.mode, prev.mode),
      model: restore(opts.model, prev.model),
      effort: restore(opts.effort, prev.effort)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, tools])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  const persistSel = (patch: Partial<typeof sel>) => {
    const next = { ...sel, ...patch }
    setSel(next)
    if (server) setChatSel(server, next)
  }

  // IDE-level generic rules: applied to ANY agent, regardless of the MCP server.
  const applyRules = () =>
    rules
      .map(r => r.replace(/\{worktree\}/g, worktree || 'cartella corrente'))
      .filter(Boolean)
      .join('\n')

  const send = async () => {
    const text = input.trim()
    const target = server || connectedServers[0]
    if (!text || !target || busy) return
    const tool = findChatTool(tools[target] || [])
    const next: AiChatMessage[] = [...messages, { role: 'user', text }]
    setMessages(chatKey, next)
    setInput('')
    if (!tool) {
      setMessages(chatKey, [...next, { role: 'assistant', text: `Nessun tool di chat esposto dal server "${target}" (tool disponibili: ${(tools[target] || []).map(t => t.name).join(', ') || 'nessuno'}).` }])
      return
    }
    setBusy(true)
    try {
      const rulesText = applyRules()
      const prompt = rulesText ? `${rulesText}\n\n${text}` : text
      const args = buildChatArgs(tool, prompt, sel)
      const res = await window.electronAPI.mcp.callTool(target, tool.name, args)
      setMessages(chatKey, [...next, { role: 'assistant', text: res }])
    } catch (e) {
      setMessages(chatKey, [...next, { role: 'assistant', text: `Errore: ${(e as Error).message}` }])
    } finally {
      setBusy(false)
    }
  }

  const presetLabel = (name: string) => MCP_PRESETS.find(p => p.config.name === name)?.label || name

  const selectStyle: React.CSSProperties = {
    background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
    color: 'var(--text-primary)', fontSize: 'calc(9px * var(--ui-text-scale, 1))',
    fontFamily: 'var(--font-mono)', padding: '2px 6px', cursor: 'pointer', outline: 'none'
  }

  // Renders a chat option field: a select when the values are a closed set
  // (schema enum or agent effort levels), otherwise a free-text field with
  // suggestions (datalist) so the specific model id can always be picked.
  const fieldRow = (label: string, field: ChatOptionField, value: string, onChange: (v: string) => void, listId: string) => {
    if (!field.path) return null
    const options = field.values.length > 0 ? field.values : field.suggestions
    if (field.values.length > 0 || field.closed) {
      const opts = value && !options.includes(value) ? [...options, value] : options
      return (
        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'calc(8px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {label}
          <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...selectStyle, maxWidth: '130px' }}>
            {opts.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
      )
    }
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'calc(8px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        {label}
        <input
          list={listId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.suggestions[0] || '…'}
          spellCheck={false}
          style={{
            width: '110px', background: 'var(--bg-input)', border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
            fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
            padding: '2px 6px', outline: 'none'
          }}
        />
        <datalist id={listId}>
          {field.suggestions.map(s => <option key={s} value={s} />)}
        </datalist>
      </label>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-card)' }}>
      {/* header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px',
        borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, flexWrap: 'wrap'
      }}>
        <Bot size={12} style={{ color: 'var(--accent-color)' }} />
        <span style={{ fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'var(--font-mono)' }}>
          AI agent
        </span>
        {worktree && (
          <span title="this chat belongs to the selected worktree" data-tip-desc="this conversation is dedicated to the selected worktree"
            style={{
              padding: '1px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-tag)',
              color: 'var(--accent-color)', fontSize: 'calc(8px * var(--ui-text-scale, 1))',
              fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px'
            }}>
            {worktree.split(/[\\/]/).slice(-2).join('/')}
          </span>
        )}
        <select value={server || ''} onChange={(e) => setServer(e.target.value)}
          title="choose the connected MCP server" data-tip-desc="select which connected MCP server the agent uses"
          style={{ ...selectStyle, flex: 1, maxWidth: '220px' }}>
          {connectedServers.length === 0 && <option value="">no connected server</option>}
          {connectedServers.map(name => <option key={name} value={name}>{presetLabel(name)}</option>)}
        </select>
        {chatOpts && fieldRow('mode', chatOpts.mode, sel.mode, (v) => persistSel({ mode: v }), 'dl-mode')}
        {chatOpts && fieldRow('model', chatOpts.model, sel.model, (v) => persistSel({ model: v }), 'dl-model')}
        {chatOpts && fieldRow('effort', chatOpts.effort, sel.effort, (v) => persistSel({ effort: v }), 'dl-effort')}
        {messages.length > 0 && (
          <button onClick={() => clearChat(chatKey)} title="clear this worktree chat" data-tip-desc="delete all messages of this chat conversation"
            style={{ display: 'flex', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
            <Trash2 size={11} />
          </button>
        )}
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

      {/* messages */}
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {messages.length === 0 && (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)' }}>
            scegli un server MCP connesso e scrivi un messaggio.<br />
            L'agente userà il tool di chat esposto dal server.<br />
            {worktree ? 'Questa conversazione è dedicata al worktree selezionato.' : 'Nessun worktree selezionato: conversazione generica.'}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            display: 'flex', gap: '6px', alignItems: 'flex-start',
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '85%'
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
        {busy && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)' }}>
            <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
            lavorando...
          </div>
        )}
      </div>

      {/* input */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px',
        borderTop: '1px solid var(--border-subtle)', flexShrink: 0
      }}>
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder={connectedServers.length > 0 ? 'scrivi un messaggio all\'agente…' : 'configura e connetti un server MCP nelle impostazioni'}
          disabled={connectedServers.length === 0 || busy}
          spellCheck={false}
          style={{
            flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
            color: 'var(--text-primary)', fontSize: 'calc(10px * var(--ui-text-scale, 1))',
            fontFamily: 'var(--font-mono)', padding: '4px 8px', outline: 'none'
          }}
        />
        <button onClick={send} disabled={!input.trim() || connectedServers.length === 0 || busy}
          title="send to the agent" data-tip-desc="send the message to the agent"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', width: '26px', height: '24px',
            background: input.trim() && connectedServers.length > 0 && !busy ? 'var(--accent-color)' : 'var(--bg-disabled)',
            border: 'none', borderRadius: 'var(--radius-sm)',
            color: input.trim() && connectedServers.length > 0 && !busy ? 'var(--text-inverse)' : 'var(--text-muted)',
            cursor: input.trim() && connectedServers.length > 0 && !busy ? 'pointer' : 'not-allowed'
          }}>
          {busy ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={11} />}
        </button>
      </div>
    </div>
  )
}
