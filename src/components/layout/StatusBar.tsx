import { GitBranch, AlertCircle, CheckCircle2, Sun, Moon, TerminalSquare, Bot } from '@/components/icons'
import logo from '../../assets/logo.png'
import { useAgentConfigStore, useMcpStore } from '../../store'
import { useI18n } from '../../i18n'

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

/** Labelled dock toggle: accent background while its dock is open. */
function DockToggle({ open, onClick, title, tipDesc, icon, label }: {
  open?: boolean; onClick: () => void; title: string; tipDesc: string; icon: React.ReactNode; label: string
}) {
  return (
    <button onClick={onClick} title={title} data-tip={title} data-tip-desc={tipDesc}
      style={{
        display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0,
        padding: '1px 8px', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
        background: open ? 'var(--accent-bg)' : 'transparent',
        color: open ? 'var(--accent-color)' : 'var(--text-secondary)',
        fontFamily: 'inherit', fontSize: 'inherit'
      }}
      onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent' }}
    >
      {icon}
      {label}
    </button>
  )
}

export function StatusBar({ repoPath, currentBranch, modifiedCount = 0, theme, onToggleTheme, onToggleTerminal, terminalOpen, onToggleAi, aiOpen }: StatusBarProps) {
  const t = useI18n()
  const hasMcp = useMcpStore(s => s.custom.length > 0 || Object.keys(s.connected).length > 0)
  // the chat is not MCP-only anymore: it also hosts the configured AI agents,
  // so the button must show up as soon as there is something to talk to
  const hasAgents = useAgentConfigStore(s => s.configured.length > 0)
  const canChat = hasMcp || hasAgents
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      // grows with the text and icon size settings instead of clipping them
      height: 'max(24px, calc(10px * var(--ui-text-scale, 1) + 12px))',
      padding: '0 8px', background: 'var(--bg-statusbar)',
      borderTop: '1px solid var(--border-color)', fontSize: 'calc(10px * var(--ui-text-scale, 1))',
      fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
      userSelect: 'none', flexShrink: 0, gap: '12px', whiteSpace: 'nowrap'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
        <img src={logo} alt="logo" style={{ width: '15px', height: '15px', flexShrink: 0, objectFit: 'contain', marginRight: '2px' }} />
        {onToggleTerminal && (
          <DockToggle open={terminalOpen} onClick={onToggleTerminal}
            title={terminalOpen ? 'hide terminal' : 'show terminal'} tipDesc="integrated terminal (cmd, powershell, npm)"
            icon={<TerminalSquare size={11} strokeWidth={1.6} />} label={t('terminal')} />
        )}
        {onToggleAi && canChat && (
          <DockToggle open={aiOpen} onClick={onToggleAi}
            title={aiOpen ? 'hide AI chat' : 'open AI chat'} tipDesc="chat with the configured agents (and MCP tools)"
            icon={<Bot size={11} strokeWidth={1.6} />} label="AI" />
        )}
        {repoPath ? (
          <>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-secondary)', marginLeft: '6px' }}>
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
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '6px' }}>
            <AlertCircle size={10} />
            no repository
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
        {onToggleTheme && (
          <button onClick={onToggleTheme}
            title={`switch to ${theme === 'dark' ? 'light' : 'dark'}`} data-tip-desc="toggle between the dark and light theme"
            style={{
              display: 'flex', alignItems: 'center', background: 'none', flexShrink: 0,
              border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
              padding: '1px', borderRadius: 'var(--radius-sm)'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            {theme === 'dark' ? <Sun size={11} /> : <Moon size={11} />}
          </button>
        )}
        <span title={repoPath || undefined} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', direction: 'rtl', textAlign: 'left' }}>
          {repoPath || 'DamnedIDE'}
        </span>
      </div>
    </div>
  )
}
