import { useEffect, useState } from 'react'
import { Plug, PlugZap, Plus, X, Trash2, Loader2, ChevronDown, ChevronUp, TerminalSquare } from 'lucide-react'
import { useMcpStore, MCP_PRESETS } from '../../store'
import { ClaudeSettings } from './ClaudeSettings'

const PRESET_ICONS: Record<string, React.ReactNode> = {
  opencode: <TerminalSquare size={12} />,
  cursor: <Plug size={12} />,
  codex: <PlugZap size={12} />
}

export function McpPanel() {
  const { custom, connected, status, errors, tools, addServer, removeServer, setConnected, setStatus, setError, setTools } = useMcpStore()
  const [showAdd, setShowAdd] = useState(false)
  const [newCfg, setNewCfg] = useState({ name: '', command: '', args: [] as string[] })
  const [callArgs, setCallArgs] = useState<Record<string, string>>({})
  const [results, setResults] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  // reconnect servers that were connected before (restart / tab persistence)
  useEffect(() => {
    const all = [...MCP_PRESETS.map(p => p.config), ...custom]
    for (const cfg of all) {
      if (connected[cfg.name] && status[cfg.name] !== 'connected' && status[cfg.name] !== 'connecting') {
        connect(cfg)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const unsubTools = window.electronAPI.mcp.onTools(({ name, tools }) => {
      setTools(name, tools)
      setStatus(name, 'connected')
      setConnected(name, true)
    })
    const unsubLog = window.electronAPI.mcp.onLog(() => { /* logs in console */ })
    return () => { unsubTools(); unsubLog() }
  }, [setTools, setStatus, setConnected])

  const connect = async (config: { name: string; command: string; args: string[]; env?: Record<string, string> }) => {
    setStatus(config.name, 'connecting')
    setError(config.name)
    const res = await window.electronAPI.mcp.connect(config)
    if (res.ok) {
      setStatus(config.name, 'connected')
      setConnected(config.name, true)
      setTools(config.name, res.tools)
    } else {
      setStatus(config.name, 'error')
      setConnected(config.name, false)
      setError(config.name, res.error)
    }
  }

  const disconnect = async (name: string) => {
    await window.electronAPI.mcp.disconnect(name)
    setConnected(name, false)
    setStatus(name, 'idle')
    setTools(name, [])
    setError(name)
  }

  const callTool = async (name: string, tool: string, args: Record<string, unknown>) => {
    try {
      const text = await window.electronAPI.mcp.callTool(name, tool, args)
      setResults(prev => ({ ...prev, [`${name}:${tool}`]: text }))
    } catch (e) {
      setResults(prev => ({ ...prev, [`${name}:${tool}`]: (e as Error).message }))
    }
  }

  const addCustom = () => {
    if (!newCfg.name.trim() || !newCfg.command.trim()) return
    addServer({ name: newCfg.name.trim(), command: newCfg.command.trim(), args: newCfg.args })
    setShowAdd(false)
    setNewCfg({ name: '', command: '', args: [] })
  }

  const allServers = [...MCP_PRESETS.map(p => p.config), ...custom]

  const renderServer = (config: { name: string; command: string; args: string[] }, presetLabel?: string, presetIcon?: React.ReactNode) => {
    const st = status[config.name] || 'idle'
    const isConn = st === 'connected'
    const connecting = st === 'connecting'
    const failed = st === 'error'
    const cmdLine = `${config.command} ${config.args.join(' ')}`.trim()
    return (
      <div key={config.name} style={{
        border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
        background: 'var(--bg-card)', overflow: 'hidden'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 10px' }}>
          <span style={{ color: isConn ? 'var(--success-color)' : 'var(--text-muted)', display: 'flex' }}>
            {presetIcon || (PRESET_ICONS[config.name] || <Plug size={12} />)}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontWeight: 600, color: 'var(--text-primary)' }}>
              {presetLabel || config.name}
            </div>
            <div style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {cmdLine}
            </div>
          </div>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
            background: isConn ? 'var(--success-color)' : failed ? 'var(--error-color)' : connecting ? 'var(--warning-color)' : 'var(--border-color)' }} />
          {isConn && (
            <button onClick={() => setExpanded(prev => ({ ...prev, [config.name]: !prev[config.name] }))}
              title={expanded[config.name] ? 'collapse tools' : 'show tools'} data-tip-desc="show or hide the tools exposed by this server"
              style={{ display: 'flex', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}>
              {expanded[config.name] ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          )}
          {!MCP_PRESETS.some(p => p.config.name === config.name) && (
            <button onClick={() => removeServer(config.name)} title="remove server" data-tip-desc="remove this MCP server configuration"
              style={{ display: 'flex', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-color)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
              <Trash2 size={11} />
            </button>
          )}
          {isConn ? (
            <button onClick={() => disconnect(config.name)} title="disconnect" data-tip-desc="disconnect from this MCP server"
              style={{
                display: 'flex', alignItems: 'center', padding: '3px 10px', height: '22px',
                background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
                color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 'calc(9px * var(--ui-text-scale, 1))',
                fontFamily: 'var(--font-mono)', fontWeight: 600
              }}>disconnect</button>
          ) : (
            <button onClick={() => connect(config)} disabled={connecting}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 10px', height: '22px',
                background: connecting ? 'var(--bg-disabled)' : 'var(--accent-color)',
                border: 'none', borderRadius: 'var(--radius-sm)', color: connecting ? 'var(--text-muted)' : 'var(--text-inverse)',
                cursor: connecting ? 'not-allowed' : 'pointer', fontSize: 'calc(9px * var(--ui-text-scale, 1))',
                fontFamily: 'var(--font-mono)', fontWeight: 600
              }}>
              {connecting ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : 'connect'}
            </button>
          )}
        </div>
        {failed && (
          <div style={{ padding: '5px 10px', background: 'var(--error-bg)', color: 'var(--error-color)', fontSize: 'calc(9px * var(--ui-text-scale, 1))', borderTop: '1px solid var(--error-color)', fontFamily: 'var(--font-mono)' }}>
            {errors[config.name]}
          </div>
        )}
        {isConn && expanded[config.name] && (
          <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '6px 10px' }}>
            {!tools[config.name] || tools[config.name].length === 0 ? (
              <div style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                no tools exposed
              </div>
            ) : (
              tools[config.name].map((tool) => {
                const key = `${config.name}:${tool.name}`
                const showArgs = !!tool.inputSchema
                return (
                  <div key={key} style={{ padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontWeight: 600, color: 'var(--accent-color)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                        {tool.name}
                      </span>
                      <span style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {tool.description}
                      </span>
                      {showArgs && (
                        <input placeholder="json args {..}" value={callArgs[key] || ''} spellCheck={false}
                          onChange={(e) => setCallArgs(prev => ({ ...prev, [key]: e.target.value }))}
                          style={{
                            background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
                            color: 'var(--text-primary)', fontSize: 'calc(9px * var(--ui-text-scale, 1))',
                            fontFamily: 'var(--font-mono)', padding: '2px 6px', width: '140px'
                          }} />
                      )}
                      <button onClick={() => {
                        let args: Record<string, unknown> = {}
                        try { args = callArgs[key] ? JSON.parse(callArgs[key]) : {} } catch { /* invalid json */ }
                        callTool(config.name, tool.name, args)
                      }} title="call tool" data-tip-desc="invoke this tool with the given arguments"
                        style={{
                          display: 'flex', alignItems: 'center', padding: '2px 8px', height: '20px',
                          background: 'var(--bg-tag)', border: '1px solid var(--accent-color)', borderRadius: 'var(--radius-sm)',
                          color: 'var(--accent-color)', cursor: 'pointer', fontSize: 'calc(9px * var(--ui-text-scale, 1))',
                          fontFamily: 'var(--font-mono)', fontWeight: 600
                        }}>call</button>
                    </div>
                    {results[key] && (
                      <pre style={{
                        margin: '4px 0 0', padding: '6px 8px', background: 'var(--bg-primary)',
                        border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
                        fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
                        color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                        maxHeight: '140px', overflow: 'auto'
                      }}>{results[key]}</pre>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '8px', overflow: 'auto', padding: '4px' }}>
      <ClaudeSettings />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)' }}>
          <PlugZap size={13} style={{ color: 'var(--accent-color)' }} />
          MCP servers
        </div>
        <button onClick={() => setShowAdd(v => !v)} title="add custom MCP server" data-tip-desc="add a custom MCP server configuration"
          style={{
            display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 10px', height: '22px',
            background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
            color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 'calc(9px * var(--ui-text-scale, 1))',
            fontFamily: 'var(--font-mono)', fontWeight: 600
          }}>
          <Plus size={10} />
          add server
        </button>
      </div>

      <div style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>
        generic MCP client: launch any MCP server over stdio and inspect/invoke its tools. The chat agents (Claude, opencode, Codex, Cursor) are configured in the AI panel, not here. Config is kept across restarts.
      </div>

      {showAdd && (
        <div style={{ border: '1px solid var(--accent-color)', borderRadius: 'var(--radius-md)', padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px', background: 'var(--bg-card)' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input placeholder="name" value={newCfg.name} onChange={(e) => setNewCfg({ ...newCfg, name: e.target.value })} style={inputStyle} />
            <input placeholder="command (e.g. npx)" value={newCfg.command} onChange={(e) => setNewCfg({ ...newCfg, command: e.target.value })} style={{ ...inputStyle, flex: 2 }} />
          </div>
          <input placeholder="args (space separated)" value={newCfg.args.join(' ')}
            onChange={(e) => setNewCfg({ ...newCfg, args: e.target.value.split(/\s+/).filter(Boolean) })} style={inputStyle} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
            <button onClick={() => setShowAdd(false)} style={smallBtn('var(--text-secondary)')}>cancel</button>
            <button onClick={addCustom} disabled={!newCfg.name.trim() || !newCfg.command.trim()} style={{
              ...smallBtn('var(--accent-color)'), background: newCfg.name.trim() && newCfg.command.trim() ? 'var(--accent-color)' : 'var(--bg-disabled)',
              color: newCfg.name.trim() && newCfg.command.trim() ? 'var(--text-inverse)' : 'var(--text-muted)'
            }}>add</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {MCP_PRESETS.map((p, i) => renderServer(p.config, p.label, PRESET_ICONS[p.config.name]))}
        {custom.map(c => renderServer(c))}
        {allServers.length === 0 && (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)' }}>
            no MCP servers configured
          </div>
        )}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)', fontSize: 'calc(10px * var(--ui-text-scale, 1))',
  fontFamily: 'var(--font-mono)', padding: '4px 8px', outline: 'none', flex: 1
}

function smallBtn(color: string): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 10px', height: '22px',
    background: 'var(--bg-card)', border: `1px solid ${color}`, borderRadius: 'var(--radius-sm)',
    color, cursor: 'pointer', fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
  }
}
