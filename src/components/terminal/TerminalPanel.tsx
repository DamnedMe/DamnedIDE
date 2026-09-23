import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { PanelContainer } from '../layout/PanelContainer'
import { useUIStore, useSettingsStore, useTerminalStore } from '../../store'
import { hexToRgba } from '../../utils/color'
import { Monitor, ExternalLink, Plus, X, ChevronDown } from 'lucide-react'

type ShellType = 'cmd' | 'powershell' | 'pwsh' | 'npm'

interface Tab {
  id: string
  type: ShellType
  title: string
}

// xterm theme derived from the IDE theme + primary color (accent)
function buildTermTheme(accent: string, dark: boolean) {
  const fg = dark ? '#f0f0f0' : '#111122'
  const bg = dark ? '#0a0a0a' : '#ffffff'
  return {
    background: bg,
    foreground: fg,
    cursor: accent,
    cursorAccent: bg,
    selectionBackground: hexToRgba(accent, 0.3),
    selectionForeground: fg,
    black: dark ? '#1a1a1a' : '#333344',
    red: dark ? '#ff5566' : '#cc2244',
    green: dark ? '#00ff77' : '#008855',
    yellow: dark ? '#ffbb00' : '#bb7700',
    blue: dark ? '#44bbff' : '#0055dd',
    magenta: dark ? '#aa55ff' : '#7722ee',
    cyan: accent,
    white: fg,
    brightBlack: dark ? '#666677' : '#8899aa',
    brightRed: dark ? '#ff7788' : '#dd4455',
    brightGreen: dark ? '#33ff99' : '#22aa66',
    brightYellow: dark ? '#ffcc33' : '#cc9922',
    brightBlue: dark ? '#66ccff' : '#2266dd',
    brightMagenta: dark ? '#cc77ff' : '#9944ee',
    brightCyan: accent,
    brightWhite: dark ? '#ffffff' : '#000000'
  }
}

interface TerminalPanelProps {
  repoPath?: string | null
}

export function TerminalPanel({ repoPath }: TerminalPanelProps) {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [showTypeMenu, setShowTypeMenu] = useState(false)
  const termRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sessionRef = useRef<string | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)
  const disposedRef = useRef(false)
  let pendingBuffer = ''
  const accentColor = useSettingsStore(s => s.settings.accentColor)
  const uiTheme = useUIStore(s => s.theme)

  // keep the terminal theme in sync with the IDE primary color / theme
  useEffect(() => {
    const t = xtermRef.current
    if (t) t.options.theme = buildTermTheme(accentColor, uiTheme === 'dark')
  }, [accentColor, uiTheme])

  const disposeTerm = () => {
    unsubRef.current?.()
    unsubRef.current = null
    if (sessionRef.current) {
      window.electronAPI.terminal.destroy(sessionRef.current)
      sessionRef.current = null
    }
    disposedRef.current = true
    xtermRef.current?.dispose()
    xtermRef.current = null
    fitRef.current = null
  }

  const createTerm = async (type: ShellType) => {
    disposeTerm()
    disposedRef.current = false // reset: this is a brand-new terminal

    if (!termRef.current) return

    const term = new Terminal({
      fontSize: 12,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      theme: buildTermTheme(accentColor, uiTheme === 'dark'),
      allowProposedApi: true
    })

    const fit = new FitAddon()
    term.loadAddon(fit)

    term.open(termRef.current)
    fit.fit()

    // Real PTY (ConPTY): the shell echoes, handles backspace/arrows and renders TUI
    // apps natively, so input is passed straight through to the pty and output is
    // written straight from the pty.
    const cwd = repoPath || ''

    xtermRef.current = term
    fitRef.current = fit

    term.onResize(({ cols, rows }) => {
      if (sessionRef.current) {
        window.electronAPI.terminal.resize(sessionRef.current, cols, rows)
      }
    })

    const unsub = window.electronAPI.terminal.onData((id, data) => {
      if (disposedRef.current) return
      if (id === sessionRef.current) {
        try { term.write(data) } catch { /* disposed */ }
      } else if (sessionRef.current === null) {
        // the shell prints before the session id is known → buffer and flush after
        pendingBuffer += data
      }
    })
    unsubRef.current = unsub

    const id = await window.electronAPI.terminal.create(cwd, type)
    if (disposedRef.current) {
      window.electronAPI.terminal.destroy(id)
      return
    }
    sessionRef.current = id
    if (pendingBuffer) {
      try { term.write(pendingBuffer) } catch { /* disposed */ }
      pendingBuffer = ''
    }
    // a command requested while the terminal was closed (agent login)
    const pending = useTerminalStore.getState().takePendingCommand()
    if (pending) {
      try { window.electronAPI.terminal.write(id, `${pending}\r`) } catch { /* closed */ }
    }

    // xterm's native input event → forward the bytes to the pty (the pty echoes)
    term.onData((data) => {
      if (sessionRef.current) {
        window.electronAPI.terminal.write(sessionRef.current, data)
      }
    })

    // focus so typing works immediately, like VS
    try { term.focus() } catch { /* ignore */ }
  }

  const addTab = (type: ShellType) => {
    const labels: Record<ShellType, string> = {
      cmd: 'CMD',
      powershell: 'PS',
      pwsh: 'PW7',
      npm: 'NPM'
    }
    const tab: Tab = { id: `tab_${Date.now()}`, type, title: labels[type] }
    setTabs(prev => [...prev, tab])
    setActiveTabId(tab.id)
    setShowTypeMenu(false)
  }

  const removeTab = (id: string) => {
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id)
      if (id === activeTabId) {
        disposeTerm()
        setActiveTabId(next.length > 0 ? next[next.length - 1].id : null)
      }
      return next
    })
  }

  const switchTab = (tab: Tab) => {
    setActiveTabId(tab.id)
  }

  // a command requested while this terminal is already running (agent login from
  // the settings) is typed into the current shell
  const pendingCommand = useTerminalStore(s => s.pendingCommand)
  useEffect(() => {
    if (!pendingCommand || !sessionRef.current) return
    const command = useTerminalStore.getState().takePendingCommand()
    if (command) {
      try { window.electronAPI.terminal.write(sessionRef.current, `${command}\r`) } catch { /* closed */ }
    }
  }, [pendingCommand])

  // auto-open a default shell when the terminal mounts (dock open / panel), so it's
  // usable immediately without picking a shell type
  const defaultTabAddedRef = useRef(false)
  useEffect(() => {
    if (defaultTabAddedRef.current) return
    defaultTabAddedRef.current = true
    addTab('cmd')
  }, [])

  // keep the terminal textarea focused so keystrokes reach the shell
  useEffect(() => {
    if (!activeTabId) return
    let tries = 0
    const focusTerm = () => {
      const ta = xtermRef.current?.textarea as HTMLTextAreaElement | undefined
      if (ta) { ta.focus(); return }
      if (tries++ < 25) setTimeout(focusTerm, 150)
    }
    const t = setTimeout(focusTerm, 50)
    return () => clearTimeout(t)
  }, [activeTabId])

  useEffect(() => {
    if (activeTabId) {
      const tab = tabs.find(t => t.id === activeTabId)
      if (tab) createTerm(tab.type)
    }
    return () => disposeTerm()
  }, [activeTabId])

  useEffect(() => {
    const handler = () => {
      try { fitRef.current?.fit() } catch { /* */ }
    }
    const obs = new ResizeObserver(handler)
    if (termRef.current) obs.observe(termRef.current)
    return () => obs.disconnect()
  }, [activeTabId])

  return (
    <PanelContainer>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a', overflow: 'hidden' }}>
        {/* Tabs bar */}
        <div style={{
          display: 'flex', alignItems: 'center', flexShrink: 0,
          background: 'var(--bg-primary)', borderBottom: '1px solid var(--border-subtle)',
          overflow: 'visible'
        }}>
          <div style={{ display: 'flex', overflow: 'auto', flex: 1, minWidth: 0 }}>
            {tabs.map(t => {
              const active = t.id === activeTabId
              return (
                <div key={t.id}
                  onClick={() => switchTab(t)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '5px',
                    padding: '4px 10px', cursor: 'pointer',
                    fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
                    background: active ? '#0a0a0a' : 'transparent',
                    color: active ? 'var(--accent-color)' : 'var(--text-muted)',
                    borderRight: '1px solid var(--border-subtle)',
                    borderBottom: active ? '1px solid var(--accent-color)' : '1px solid transparent',
                    whiteSpace: 'nowrap', userSelect: 'none',
                    flexShrink: 0
                  }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-secondary)' }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-muted)' }}
                >
                  <Monitor size={9} />
                  {t.title}
                  <button onClick={(e) => { e.stopPropagation(); removeTab(t.id) }} title="close tab" data-tip-desc="close this terminal session"
                    style={{ display: 'flex', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}>
                    <X size={9} />
                  </button>
                </div>
              )
            })}
          </div>

          <div style={{ display: 'flex', gap: '2px', flexShrink: 0, paddingRight: '4px' }}>
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowTypeMenu(!showTypeMenu)}
                title="new terminal" data-tip-desc="open a new terminal tab and pick the shell"
                style={{
                  display: 'flex', alignItems: 'center', gap: '2px',
                  padding: '3px 6px', background: 'var(--bg-card)',
                  border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
                  color: 'var(--accent-color)', cursor: 'pointer',
                  fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
                }}>
                <Plus size={10} />
                <ChevronDown size={8} />
              </button>
              {showTypeMenu && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 98 }} onClick={() => setShowTypeMenu(false)} />
                  <div style={{
                    position: 'absolute', top: '100%', right: 0, zIndex: 99, marginTop: '2px',
                    background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                    padding: '4px 0', minWidth: '160px'
                  }}>
                    {(['cmd', 'powershell', 'pwsh', 'npm'] as ShellType[]).map(t => (
                      <div key={t} onClick={() => addTab(t)} style={{
                        padding: '5px 14px', fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
                        cursor: 'pointer', color: 'var(--text-primary)',
                        transition: 'background 0.1s ease'
                      }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
                        {t === 'cmd' ? 'CMD' : t === 'powershell' ? 'PowerShell' : t === 'pwsh' ? 'PowerShell Dev' : 'NPM'}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button
              onClick={() => window.electronAPI.window.openDetached('terminal')}
              title="open in new window" data-tip-desc="open this panel in a separate window"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '24px', height: '22px', background: 'none',
                border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
                color: 'var(--text-muted)', cursor: 'pointer'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}>
              <ExternalLink size={11} />
            </button>
          </div>
        </div>

        {/* Terminal area */}
        <div ref={termRef} style={{ flex: 1, minHeight: 0, padding: '4px' }} />
      </div>
    </PanelContainer>
  )
}
