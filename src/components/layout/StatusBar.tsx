import { GitBranch, AlertCircle, CheckCircle2, Sun, Moon, TerminalSquare, Bot } from 'lucide-react'
import logo from '../../assets/logo.png'
import { useMcpStore } from '../../store'

interface StatusBarProps {
  repoPath: string | null
  currentBranch?: string
  modifiedCount?: number
  theme?: string
  onToggleTheme?: () => void
  onToggleTerminal?: () => void
  terminalOpen?: boolean
  onToggleAi?: () => void
  aiOpen?: boolean
}

export function StatusBar({ repoPath, currentBranch, modifiedCount = 0, theme, onToggleTheme, onToggleTerminal, terminalOpen, onToggleAi, aiOpen }: StatusBarProps) {
  const hasMcp = useMcpStore(s => s.custom.length > 0 || Object.keys(s.connected).length > 0)
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      height: '22px', padding: '0 10px', background: 'var(--bg-statusbar)',
      borderTop: '1px solid var(--border-color)', fontSize: 'calc(10px * var(--ui-text-scale, 1))',
      fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
      userSelect: 'none', flexShrink: 0, gap: '12px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <img src={logo} alt="logo" style={{ width: '15px', height: '15px', flexShrink: 0, objectFit: 'contain' }} />
        {onToggleAi && hasMcp && (
          <button onClick={onToggleAi}
            title={aiOpen ? 'hide AI chat' : 'open AI chat'}
            data-tip={aiOpen ? 'hide AI chat' : 'open AI chat'}
            data-tip-desc="chat with the agent using the configured MCP server"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: aiOpen ? 'var(--accent-bg)' : 'none',
              border: 'none', color: 'var(--accent-color)', cursor: 'pointer',
              padding: '2px', borderRadius: '3px'
            }}
            onMouseEnter={(e) => { if (!aiOpen) e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={(e) => { if (!aiOpen) e.currentTarget.style.background = 'none' }}
          >
            <Bot size={12} strokeWidth={1.6} />
          </button>
        )}
        {onToggleTerminal && (
          <button onClick={onToggleTerminal}
            title={terminalOpen ? 'hide terminal' : 'show terminal'}
            data-tip={terminalOpen ? 'hide terminal' : 'show terminal'}
            data-tip-desc="integrated terminal (cmd, powershell, npm)"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: terminalOpen ? 'var(--accent-bg)' : 'none',
              border: 'none', color: 'var(--accent-color)', cursor: 'pointer',
              padding: '2px', borderRadius: '3px'
            }}
            onMouseEnter={(e) => { if (!terminalOpen) e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={(e) => { if (!terminalOpen) e.currentTarget.style.background = 'none' }}
          >
            <TerminalSquare size={12} strokeWidth={1.6} />
          </button>
        )}
        {repoPath ? (
          <>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-secondary)' }}>
              <GitBranch size={10} />
              {currentBranch || '—'}
            </span>
            {modifiedCount > 0 ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: 'var(--warning-color)' }}>
                <AlertCircle size={10} />
                {modifiedCount} modified
              </span>
            ) : (
              <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: 'var(--success-color)' }}>
                <CheckCircle2 size={10} />
                clean
              </span>
            )}
          </>
        ) : (
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <AlertCircle size={10} />
            no repository
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {onToggleTheme && (
          <button onClick={onToggleTheme}
            title={`switch to ${theme === 'dark' ? 'light' : 'dark'}`} data-tip-desc="toggle between the dark and light theme"
            style={{
              display: 'flex', alignItems: 'center', background: 'none',
              border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
              padding: '1px', borderRadius: '2px'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            {theme === 'dark' ? <Sun size={11} /> : <Moon size={11} />}
          </button>
        )}
        <span>{repoPath || 'DamnedIDE'}</span>
      </div>
    </div>
  )
}
